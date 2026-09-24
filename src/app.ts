import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { ExactAvmScheme } from "@x402/avm/exact/server";
import {
  paymentMiddlewareFromHTTPServer,
  x402HTTPResourceServer,
  x402ResourceServer,
} from "@x402/hono";
import { HTTPFacilitatorClient, type FacilitatorClient } from "@x402/core/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { inspectUnsignedTransaction } from "./analyze.js";
import { loadTestnetPaymentConfig, type TestnetPaymentConfig } from "./config.js";
import { ValidationError } from "./errors.js";
import { parseInspectionRequest } from "./validation.js";
import { RULESET_VERSION } from "./types.js";

export interface MicrovernService {
  readonly app: Hono;
  readonly initialize: () => Promise<void>;
}

const MAX_REQUEST_BODY_BYTES = 128 * 1024;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const UNPAID_REQUEST_LIMIT = 30;
const UNPAID_REQUEST_WINDOW_MS = 60 * 1000;
const MICROVERN_DISCOVERY_TAGS = ["algorand", "transaction-safety", "x402-global-challenge"];

const INSPECTION_REQUEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["network", "unsignedTransactionGroup"],
  properties: {
    network: { type: "string", enum: ["algorand-mainnet", "algorand-testnet"] },
    unsignedTransactionGroup: {
      type: "string",
      minLength: 1,
      maxLength: 87384,
      pattern: "^[A-Za-z0-9+/]*={0,2}$",
      description: "Base64-encoded, concatenated unsigned Algorand transactions.",
    },
    policy: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxAlgoSend: { type: "number", minimum: 0 },
        maxUsdcSend: { type: "number", minimum: 0 },
        allowRekey: { type: "boolean" },
        allowCloseOut: { type: "boolean" },
        allowUnknownApps: { type: "boolean" },
        allowedApplicationIds: {
          type: "array",
          items: { type: "integer", minimum: 0 },
        },
      },
    },
  },
} as const;

const INSPECTION_RESPONSE_SCHEMA = {
  type: "object",
  required: ["verdict", "riskScore", "summary", "actions", "findings", "policyEvaluation", "rulesetVersion", "disclaimer"],
  properties: {
    verdict: { type: "string", enum: ["allow", "review", "block"] },
    riskScore: { type: "number", minimum: 0 },
    summary: { type: "string" },
    actions: { type: "array" },
    findings: { type: "array" },
    policyEvaluation: { type: "object" },
    rulesetVersion: { type: "string" },
    disclaimer: { type: "string" },
  },
} as const;

const INSPECTION_DISCOVERY_EXTENSION = declareDiscoveryExtension({
  bodyType: "json",
  input: {
    network: "algorand-testnet",
    unsignedTransactionGroup: "haNmZWXNA+iiZnYBomdoxCBIY7UYpLPITsgQ8i1PEIHLD3HwWaesIN7GL39w5Qk6IqJsds0D6KR0eXBlo3BheQ==",
    policy: { maxAlgoSend: 1, allowRekey: false },
  },
  inputSchema: INSPECTION_REQUEST_SCHEMA,
  output: {
    example: {
      verdict: "allow",
      riskScore: 0,
      summary: "1 action analyzed; no configured policy violation found.",
      actions: [{ index: 0, type: "algo-transfer", description: "Sends 0 ALGO.", consequences: [] }],
      findings: [],
      policyEvaluation: { maxAlgoSend: "passed", allowRekey: "passed" },
      rulesetVersion: RULESET_VERSION,
      disclaimer: "Deterministic, best-effort decision support; verify all transaction details before signing.",
    },
    schema: INSPECTION_RESPONSE_SCHEMA,
  },
});

interface CachedInspection {
  readonly body: unknown;
  readonly expiresAt: number;
  readonly paymentResponse: string | null;
}

interface RateLimitWindow {
  count: number;
  resetAt: number;
}

function requestIdentity(c: Context): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    || c.req.header("x-real-ip")
    || "unattributed";
}

function hasPaymentProof(c: Context): boolean {
  return c.req.header("payment-signature") !== undefined || c.req.header("x-payment") !== undefined;
}

function validIdempotencyKey(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function bodyLengthWithinLimit(c: Context): boolean {
  const header = c.req.header("content-length");
  return header === undefined || (Number.isSafeInteger(Number(header)) && Number(header) <= MAX_REQUEST_BODY_BYTES);
}

async function readRequestJson(c: Context): Promise<unknown> {
  if (!bodyLengthWithinLimit(c)) throw new ValidationError("Request body must not exceed 131072 bytes.");
  const text = await c.req.raw.text();
  if (Buffer.byteLength(text, "utf8") > MAX_REQUEST_BODY_BYTES) {
    throw new ValidationError("Request body must not exceed 131072 bytes.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
}

function addInspectionGuards(app: Hono): void {
  const responses = new Map<string, CachedInspection>();
  const unpaidWindows = new Map<string, RateLimitWindow>();

  app.use("/v1/inspect-transaction", async (c, next) => {
    if (!bodyLengthWithinLimit(c)) return c.json({ error: "Request body must not exceed 131072 bytes." }, 413);
    const body = await c.req.raw.clone().arrayBuffer();
    if (body.byteLength > MAX_REQUEST_BODY_BYTES) return c.json({ error: "Request body must not exceed 131072 bytes." }, 413);
    return next();
  });

  app.use("/v1/inspect-transaction", async (c, next) => {
    if (!hasPaymentProof(c)) {
      const now = Date.now();
      const identity = requestIdentity(c);
      const window = unpaidWindows.get(identity);
      const activeWindow = window === undefined || window.resetAt <= now
        ? { count: 0, resetAt: now + UNPAID_REQUEST_WINDOW_MS }
        : window;
      activeWindow.count += 1;
      unpaidWindows.set(identity, activeWindow);
      if (activeWindow.count > UNPAID_REQUEST_LIMIT) {
        c.header("Retry-After", String(Math.ceil((activeWindow.resetAt - now) / 1000)));
        return c.json({ error: "Too many unpaid inspection requests. Try again later." }, 429);
      }
    }
    return next();
  });

  app.use("/v1/inspect-transaction", async (c, next) => {
    const key = c.req.header("idempotency-key");
    if (key === undefined) return next();
    if (!validIdempotencyKey(key)) return c.json({ error: "Idempotency-Key must contain 8 to 128 URL-safe characters." }, 400);

    const now = Date.now();
    const cached = responses.get(key);
    if (cached !== undefined && cached.expiresAt > now) {
      c.header("X-Idempotent-Replay", "true");
      if (cached.paymentResponse !== null) c.header("Payment-Response", cached.paymentResponse);
      return c.json(cached.body);
    }
    if (cached !== undefined) responses.delete(key);

    await next();
    if (c.res.status !== 200 || !c.res.headers.get("content-type")?.includes("application/json")) return;
    try {
      responses.set(key, {
        body: await c.res.clone().json(),
        expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
        paymentResponse: c.res.headers.get("payment-response"),
      });
    } catch {
      // Only a complete JSON report is eligible for replay.
    }
  });
}

function protectedRoutes(paymentConfig: TestnetPaymentConfig) {
  return {
    "POST /v1/inspect-transaction": {
      accepts: {
        scheme: "exact",
        network: paymentConfig.caip2,
        payTo: paymentConfig.payTo,
        price: paymentConfig.priceUsd,
        extra: { asset: paymentConfig.usdcAssetId, tag: "x402-global-challenge" },
      },
      description: "Inspect an unsigned Algorand transaction group before signing and return deterministic policy findings.",
      mimeType: "application/json",
      serviceName: "MicroVern",
      tags: MICROVERN_DISCOVERY_TAGS,
      ...(paymentConfig.iconUrl === undefined ? {} : { iconUrl: paymentConfig.iconUrl }),
      extensions: INSPECTION_DISCOVERY_EXTENSION,
    },
  };
}

function supportsConfiguredPayment(
  paymentConfig: TestnetPaymentConfig,
  kinds: Awaited<ReturnType<FacilitatorClient["getSupported"]>>["kinds"],
): boolean {
  return kinds.some((kind) => (
    kind.x402Version === 2
    && kind.scheme === "exact"
    && kind.network === paymentConfig.caip2
  ));
}

function addRoutes(
  app: Hono,
  paymentConfig: TestnetPaymentConfig | undefined,
  facilitatorClient: FacilitatorClient | undefined,
  paymentEnabled: boolean,
): void {
  const advertisedConfig = paymentConfig ?? loadTestnetPaymentConfig();

  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/readyz", async (c) => {
    if (paymentConfig === undefined || facilitatorClient === undefined) {
      return c.json({ status: "not-ready", reason: "payment_not_configured" }, 503);
    }

    try {
      const supported = await facilitatorClient.getSupported();
      if (!supportsConfiguredPayment(paymentConfig, supported.kinds)) {
        return c.json({ status: "not-ready", reason: "facilitator_missing_testnet_exact" }, 503);
      }
      return c.json({ status: "ready", network: paymentConfig.network, scheme: "exact" });
    } catch {
      return c.json({ status: "not-ready", reason: "facilitator_unavailable" }, 503);
    }
  });

  app.get("/v1/capabilities", (c) => {
    return c.json({
      rulesetVersion: RULESET_VERSION,
      supportedNetworks: ["algorand-mainnet", "algorand-testnet"],
      input: "Base64 of one or more concatenated unsigned Algorand transactions encoded with algosdk.encodeUnsignedTransaction. Multi-transaction inputs must share one group ID.",
      payment: advertisedConfig === undefined
        ? { enabled: false, configured: false }
        : {
            enabled: paymentEnabled,
            configured: true,
            network: advertisedConfig.network,
            caip2: advertisedConfig.caip2,
            payTo: advertisedConfig.payTo,
            facilitatorUrl: advertisedConfig.facilitatorUrl,
            priceUsd: advertisedConfig.priceUsd,
            usdcAssetId: advertisedConfig.usdcAssetId,
            usdcDecimals: advertisedConfig.usdcDecimals,
          },
    });
  });

  app.post("/v1/validate-transaction", async (c) => {
    try {
      parseInspectionRequest(await readRequestJson(c));
      return c.json({ valid: true }, 200);
    } catch (error) {
      if (error instanceof ValidationError) return c.json({ error: error.message }, 400);
      return c.json({ error: "Unable to validate request." }, 500);
    }
  });

  app.post("/v1/inspect-transaction", async (c) => {
    try {
      const request = parseInspectionRequest(await readRequestJson(c));
      return c.json(inspectUnsignedTransaction(request.unsignedTransactionGroup, request.network, request.policy));
    } catch (error) {
      if (error instanceof ValidationError) return c.json({ error: error.message }, 400);
      return c.json({ error: "Internal analysis error." }, 500);
    }
  });
}

export function createPaymentProtectedService(
  paymentConfig: TestnetPaymentConfig,
  facilitatorClient: FacilitatorClient = new HTTPFacilitatorClient({ url: paymentConfig.facilitatorUrl }),
): MicrovernService {
  const resourceServer = new x402ResourceServer(facilitatorClient)
    .register(paymentConfig.caip2, new ExactAvmScheme())
    .registerExtension(bazaarResourceServerExtension);
  const paymentServer = new x402HTTPResourceServer(resourceServer, protectedRoutes(paymentConfig));
  const app = new Hono();

  app.use(async (c, next) => {
    c.header("X-Request-Id", c.req.header("x-request-id") ?? randomUUID());
    await next();
  });
  addInspectionGuards(app);
  app.use(paymentMiddlewareFromHTTPServer(paymentServer, undefined, undefined, false));
  addRoutes(app, paymentConfig, facilitatorClient, true);

  return { app, initialize: () => paymentServer.initialize() };
}

export function createLocalAnalysisApp(): Hono {
  const localApp = new Hono();
  localApp.use(async (c, next) => {
    c.header("X-Request-Id", c.req.header("x-request-id") ?? randomUUID());
    await next();
  });
  addInspectionGuards(localApp);
  addRoutes(localApp, undefined, undefined, false);
  return localApp;
}

export const app = createLocalAnalysisApp();
