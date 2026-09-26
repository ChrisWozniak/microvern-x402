import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { ExactAvmScheme } from "@x402/avm/exact/server";
import {
  paymentMiddlewareFromHTTPServer,
  x402HTTPResourceServer,
  x402ResourceServer,
} from "@x402/hono";
import { HTTPFacilitatorClient, type FacilitatorClient } from "@x402/core/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { accountStateTargetsForUnsignedGroup, inspectUnsignedTransaction } from "./analyze.js";
import { createAccountStateObserver, type AccountStateObserver } from "./account-state.js";
import { APPLICATION_REGISTRY_VERSION, listRecognizedApplications } from "./application-registry.js";
import { hashInspectionRequest } from "./binding.js";
import { loadPaymentConfig, type PaymentConfig } from "./config.js";
import { ValidationError } from "./errors.js";
import { InMemoryIdempotencyStore, type IdempotencyStore } from "./idempotency.js";
import { listPolicyProfiles, resolvePolicyProfile } from "./policy-profiles.js";
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
const MICROVERN_REVIEW_ORIGIN = "https://chriswozniak.github.io";

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
        allowedAssetIds: {
          type: "array",
          items: { type: "integer", minimum: 0 },
        },
        prohibitAdminActions: { type: "boolean" },
      },
    },
    policyProfile: { type: "string", pattern: "^[a-z0-9-]{3,80}$" },
    accountStateChecks: {
      type: "object",
      additionalProperties: false,
      required: ["consent"],
      properties: { consent: { const: true } },
      description: "Explicit consent for read-only public account-state observations related to this group.",
    },
  },
} as const;

const INSPECTION_RESPONSE_SCHEMA = {
  type: "object",
  required: ["verdict", "riskScore", "summary", "reviewSummary", "actions", "findings", "policyEvaluation", "rulesetVersion", "disclaimer", "requestHash", "reportChecksum"],
  properties: {
    verdict: { type: "string", enum: ["allow", "review", "block"] },
    riskScore: { type: "number", minimum: 0 },
    summary: { type: "string" },
    reviewSummary: {
      type: "object",
      required: ["transactionCount", "totalAlgoSent", "totalUsdcSent", "totalFeeAlgo", "recipients", "assetIds"],
      properties: {
        transactionCount: { type: "integer", minimum: 1 },
        totalAlgoSent: { type: "string" },
        totalUsdcSent: { type: "string" },
        totalFeeAlgo: { type: "string" },
        recipients: { type: "array", items: { type: "string" } },
        assetIds: { type: "array", items: { type: "integer", minimum: 0 } },
      },
    },
    actions: { type: "array" },
    findings: { type: "array" },
    policyEvaluation: { type: "object" },
    policyProfile: {
      type: "object",
      required: ["id", "version"],
      properties: { id: { type: "string" }, version: { type: "string" } },
    },
    accountState: {
      type: "object",
      required: ["status", "source", "accounts", "notice"],
      properties: {
        status: { type: "string", enum: ["observed", "not-configured", "unavailable"] },
        source: { const: "algod" },
        observedRound: { type: "integer", minimum: 0 },
        observedAt: { type: "string", format: "date-time" },
        accounts: { type: "array" },
        notice: { type: "string" },
      },
    },
    rulesetVersion: { type: "string" },
    disclaimer: { type: "string" },
    requestHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    reportChecksum: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
} as const;

function inspectionDiscoveryExtension(network: PaymentConfig["network"]) {
  return declareDiscoveryExtension({
    bodyType: "json",
    input: {
      network,
      unsignedTransactionGroup: "haNmZWXNA+iiZnYBomdoxCBIY7UYpLPITsgQ8i1PEIHLD3HwWaesIN7GL39w5Qk6IqJsds0D6KR0eXBlo3BheQ==",
      policy: { maxAlgoSend: 1, allowRekey: false },
    },
    inputSchema: INSPECTION_REQUEST_SCHEMA,
    output: {
      example: {
        verdict: "allow",
        riskScore: 0,
        summary: "1 action analyzed; no configured policy violation found.",
        reviewSummary: { transactionCount: 1, totalAlgoSent: "0", totalUsdcSent: "0", totalFeeAlgo: "0.001", recipients: [], assetIds: [] },
        actions: [{ index: 0, type: "algo-transfer", description: "Sends 0 ALGO.", consequences: [] }],
        findings: [],
        policyEvaluation: { maxAlgoSend: "passed", allowRekey: "passed" },
        rulesetVersion: RULESET_VERSION,
        disclaimer: "Deterministic, best-effort decision support; verify all transaction details before signing.",
        requestHash: "0000000000000000000000000000000000000000000000000000000000000000",
        reportChecksum: "1111111111111111111111111111111111111111111111111111111111111111",
      },
      schema: INSPECTION_RESPONSE_SCHEMA,
    },
  });
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

function reportIdFromBody(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("requestHash" in value) || typeof value.requestHash !== "string") {
    return undefined;
  }
  return /^[a-f0-9]{64}$/.test(value.requestHash) ? value.requestHash : undefined;
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

function addInspectionGuards(
  app: Hono,
  idempotencyStore: IdempotencyStore,
  allowUnpaidIdempotency: boolean,
): void {
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

    if (!allowUnpaidIdempotency && !hasPaymentProof(c)) return next();

    let requestHash: string;
    try {
      requestHash = hashInspectionRequest(parseInspectionRequest(JSON.parse(await c.req.raw.clone().text())));
    } catch (error) {
      if (error instanceof ValidationError) return c.json({ error: error.message }, 400);
      return c.json({ error: "Request body must be valid JSON." }, 400);
    }

    const acquisition = await idempotencyStore.acquire(key, requestHash, IDEMPOTENCY_TTL_MS);
    if (acquisition.state === "completed") {
      c.header("X-Idempotent-Replay", "true");
      const reportId = reportIdFromBody(acquisition.response.body);
      if (reportId !== undefined) c.header("X-MicroVern-Report-Id", reportId);
      if (acquisition.response.paymentResponse !== null) c.header("Payment-Response", acquisition.response.paymentResponse);
      return c.json(acquisition.response.body, acquisition.response.status);
    }
    if (acquisition.state === "in-progress") {
      c.header("Retry-After", "2");
      return c.json({ error: "An inspection with this Idempotency-Key is already being processed." }, 409);
    }
    if (acquisition.state === "conflict") {
      return c.json({ error: "This Idempotency-Key is already bound to a different inspection request." }, 409);
    }

    await next();
    if (c.res.status !== 200 || !c.res.headers.get("content-type")?.includes("application/json")) {
      await idempotencyStore.release(key);
      return;
    }
    try {
      await idempotencyStore.complete(key, {
        status: c.res.status,
        body: await c.res.clone().json(),
        paymentResponse: c.res.headers.get("payment-response"),
      }, IDEMPOTENCY_TTL_MS);
    } catch {
      // Retain the processing lease rather than risking a second paid attempt.
    }
  });
}

function protectedRoutes(paymentConfig: PaymentConfig) {
  return {
    "POST /v1/inspect-transaction": {
      ...(paymentConfig.publicBaseUrl === undefined
        ? {}
        : { resource: new URL("/v1/inspect-transaction", paymentConfig.publicBaseUrl).toString() }),
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
      extensions: inspectionDiscoveryExtension(paymentConfig.network),
    },
  };
}

function supportsConfiguredPayment(
  paymentConfig: PaymentConfig,
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
  paymentConfig: PaymentConfig | undefined,
  facilitatorClient: FacilitatorClient | undefined,
  paymentEnabled: boolean,
  accountStateObserver: AccountStateObserver,
): void {
  const advertisedConfig = paymentConfig ?? loadPaymentConfig();

  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/readyz", async (c) => {
    if (paymentConfig === undefined || facilitatorClient === undefined) {
      return c.json({ status: "not-ready", reason: "payment_not_configured" }, 503);
    }

    try {
      const supported = await facilitatorClient.getSupported();
      if (!supportsConfiguredPayment(paymentConfig, supported.kinds)) {
        const networkName = paymentConfig.network === "algorand-mainnet" ? "mainnet" : "testnet";
        return c.json({ status: "not-ready", reason: `facilitator_missing_${networkName}_exact` }, 503);
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
      policyProfiles: listPolicyProfiles(),
      accountStateChecks: {
        supported: true,
        explicitConsentRequired: true,
        configuredNetworks: accountStateObserver.configuredNetworks,
        notice: "When requested, observations are labeled with the Algod-reported round and are not guarantees of current or future state.",
      },
      applicationRegistry: {
        version: APPLICATION_REGISTRY_VERSION,
        recognizedApplications: listRecognizedApplications(),
        notice: "Only exact registry matches receive plain-language method explanations. All other application calls remain visibly unknown.",
      },
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
      const selectedProfile = request.policyProfile === undefined ? undefined : resolvePolicyProfile(request.policyProfile, request.network);
      const accountState = request.accountStateChecks === undefined
        ? undefined
        : await accountStateObserver.observe(request.network, accountStateTargetsForUnsignedGroup(request.unsignedTransactionGroup));
      const report = inspectUnsignedTransaction(
        request.unsignedTransactionGroup,
        request.network,
        selectedProfile?.policy ?? request.policy,
        request,
        selectedProfile?.profile,
        accountState,
      );
      c.header("X-MicroVern-Report-Id", report.requestHash);
      return c.json(report);
    } catch (error) {
      if (error instanceof ValidationError) return c.json({ error: error.message }, 400);
      return c.json({ error: "Internal analysis error." }, 500);
    }
  });
}

function addBrowserReviewCors(app: Hono): void {
  // The x402 middleware can short-circuit with a 402 before route handlers run.
  // Set these headers before it so the public GitHub Pages console can read a
  // quote and retry with its user-approved payment proof.
  app.use("*", async (c, next) => {
    if (c.req.header("origin") === MICROVERN_REVIEW_ORIGIN) {
      c.header("Access-Control-Allow-Origin", MICROVERN_REVIEW_ORIGIN);
      c.header("Access-Control-Expose-Headers", "Payment-Required, Payment-Response, Retry-After, X-Idempotent-Replay, X-MicroVern-Report-Id, X-Request-Id");
      c.header("Vary", "Origin");
    }
    await next();
  });
  app.use("*", cors({
    origin: MICROVERN_REVIEW_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Idempotency-Key", "X-Request-Id", "Payment-Signature", "X-Payment"],
    exposeHeaders: ["Payment-Required", "Payment-Response", "Retry-After", "X-Idempotent-Replay", "X-MicroVern-Report-Id", "X-Request-Id"],
    maxAge: 86_400,
  }));
}

export function createPaymentProtectedService(
  paymentConfig: PaymentConfig,
  facilitatorClient: FacilitatorClient = new HTTPFacilitatorClient({ url: paymentConfig.facilitatorUrl }),
  idempotencyStore: IdempotencyStore = new InMemoryIdempotencyStore(),
  accountStateObserver: AccountStateObserver = createAccountStateObserver(),
): MicrovernService {
  const resourceServer = new x402ResourceServer(facilitatorClient)
    .register(paymentConfig.caip2, new ExactAvmScheme())
    .registerExtension(bazaarResourceServerExtension);
  const paymentServer = new x402HTTPResourceServer(resourceServer, protectedRoutes(paymentConfig));
  const app = new Hono();

  addBrowserReviewCors(app);
  app.use(async (c, next) => {
    c.header("X-Request-Id", c.req.header("x-request-id") ?? randomUUID());
    await next();
  });
  addInspectionGuards(app, idempotencyStore, false);
  app.use(paymentMiddlewareFromHTTPServer(paymentServer, undefined, undefined, false));
  addRoutes(app, paymentConfig, facilitatorClient, true, accountStateObserver);

  return {
    app,
    initialize: async () => {
      await idempotencyStore.initialize();
      await paymentServer.initialize();
    },
  };
}

export function createLocalAnalysisApp(
  idempotencyStore: IdempotencyStore = new InMemoryIdempotencyStore(),
  accountStateObserver: AccountStateObserver = createAccountStateObserver(),
): Hono {
  const localApp = new Hono();
  addBrowserReviewCors(localApp);
  localApp.use(async (c, next) => {
    c.header("X-Request-Id", c.req.header("x-request-id") ?? randomUUID());
    await next();
  });
  addInspectionGuards(localApp, idempotencyStore, true);
  addRoutes(localApp, undefined, undefined, false, accountStateObserver);
  return localApp;
}

export const app = createLocalAnalysisApp();
