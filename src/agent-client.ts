import { ExactAvmScheme } from "@x402/avm/exact/client";
import type { ClientAvmSigner } from "@x402/avm";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { randomUUID } from "node:crypto";
import type { InspectionReport, InspectionRequest, Network } from "./types.js";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export interface MicrovernAgentTrustPolicy {
  /** Exact HTTPS origin of the MicroVern service; redirects are rejected. */
  serviceUrl: string;
  /** The transaction network being inspected. */
  inspectionNetwork: Network;
  /** Exact Algorand CAIP-2 network accepted for the x402 payment. */
  paymentNetwork: `${string}:${string}`;
  /** Official USDC ASA expected in the payment requirement. */
  usdcAssetId: string;
  /** Exact MicroVern receiver address expected in the payment requirement. */
  payTo: string;
  /** Maximum payment in USDC atomic units (10,000 = $0.01). */
  maxAmountAtomic: bigint;
}

export interface AgentInspectionOptions {
  /** Reuse only for a retry of the same logical inspection request. */
  idempotencyKey?: string;
  /** Optional support correlation value returned by the service. */
  correlationId?: string;
}

export interface AgentInspectionResult {
  idempotencyKey: string;
  requestId: string | null;
  paymentTransactionId: string;
  paymentReceipt: ReturnType<typeof decodePaymentResponseHeader>;
  report: InspectionReport;
}

export type AgentInspectionFailureKind = "payment-required" | "in-progress" | "throttled" | "unavailable" | "rejected";

export class AgentPreflightError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AgentPreflightError";
  }
}

export class AgentInspectionError extends Error {
  readonly kind: AgentInspectionFailureKind;

  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AgentInspectionError";
    this.kind = status === 402
      ? "payment-required"
      : status === 409
        ? "in-progress"
        : status === 429
          ? "throttled"
          : status >= 500
            ? "unavailable"
            : "rejected";
  }
}

export interface PaymentRequirementLike {
  scheme?: unknown;
  network?: unknown;
  asset?: unknown;
  payTo?: unknown;
  amount?: unknown;
}

function parseServiceOrigin(serviceUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(serviceUrl);
  } catch {
    throw new Error("serviceUrl must be an absolute HTTPS URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("serviceUrl must be an HTTPS origin without a path, credentials, query, or fragment.");
  }
  return parsed;
}

function validateTrustPolicy(policy: MicrovernAgentTrustPolicy): URL {
  const origin = parseServiceOrigin(policy.serviceUrl);
  if (!policy.paymentNetwork.startsWith("algorand:") || policy.usdcAssetId.length === 0 || policy.payTo.length === 0) {
    throw new Error("The trust policy must pin an Algorand payment network, USDC asset, and receiver address.");
  }
  if (policy.maxAmountAtomic <= 0n) throw new Error("maxAmountAtomic must be greater than zero.");
  return origin;
}

function responseErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") return body.error;
  return fallback;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function validIdempotencyKey(key: string): boolean {
  return IDEMPOTENCY_KEY_PATTERN.test(key);
}

function assertInspectionRequestNetwork(request: InspectionRequest, policy: MicrovernAgentTrustPolicy): void {
  if (request.network !== policy.inspectionNetwork) {
    throw new Error(`Inspection request network ${request.network} does not match trusted network ${policy.inspectionNetwork}.`);
  }
}

export function isTrustedMicrovernPaymentRequirement(
  requirement: PaymentRequirementLike,
  policy: Pick<MicrovernAgentTrustPolicy, "paymentNetwork" | "usdcAssetId" | "payTo" | "maxAmountAtomic">,
): boolean {
  if (
    requirement.scheme !== "exact"
    || requirement.network !== policy.paymentNetwork
    || requirement.asset !== policy.usdcAssetId
    || requirement.payTo !== policy.payTo
    || typeof requirement.amount !== "string"
  ) return false;
  try {
    const amount = BigInt(requirement.amount);
    return amount > 0n && amount <= policy.maxAmountAtomic;
  } catch {
    return false;
  }
}

function assertInspectionReport(value: unknown): asserts value is InspectionReport {
  if (
    typeof value !== "object" || value === null
    || !("verdict" in value) || !("requestHash" in value) || !("reportChecksum" in value)
    || typeof value.requestHash !== "string" || !/^[a-f0-9]{64}$/.test(value.requestHash)
    || typeof value.reportChecksum !== "string" || !/^[a-f0-9]{64}$/.test(value.reportChecksum)
  ) throw new Error("MicroVern returned an invalid inspection report.");
}

export class MicrovernAgentClient {
  private readonly serviceOrigin: URL;
  private readonly paymentFetch: typeof fetch;

  constructor(
    private readonly signer: ClientAvmSigner,
    private readonly trustPolicy: MicrovernAgentTrustPolicy,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    this.serviceOrigin = validateTrustPolicy(trustPolicy);
    const client = new x402Client()
      .register(trustPolicy.paymentNetwork, new ExactAvmScheme(signer));
    client.registerPolicy((_version, requirements) => requirements.filter((requirement) => (
      isTrustedMicrovernPaymentRequirement(requirement, trustPolicy)
    )));
    this.paymentFetch = wrapFetchWithPayment(this.lockedFetch.bind(this), client);
  }

  private async lockedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const rawUrl = input instanceof Request ? input.url : input.toString();
    const target = new URL(rawUrl, this.serviceOrigin);
    if (target.origin !== this.serviceOrigin.origin) {
      throw new Error("MicroVern agent client refused a request outside its trusted service origin.");
    }
    return this.fetchImplementation(input, { ...init, redirect: "error" });
  }

  private endpoint(path: string): URL {
    return new URL(path, this.serviceOrigin);
  }

  async validate(request: InspectionRequest): Promise<void> {
    assertInspectionRequestNetwork(request, this.trustPolicy);
    const response = await this.lockedFetch(this.endpoint("/v1/validate-transaction"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new AgentPreflightError(response.status, responseErrorMessage(await responseJson(response), `MicroVern preflight failed with HTTP ${response.status}.`));
    }
  }

  async inspect(request: InspectionRequest, options: AgentInspectionOptions = {}): Promise<AgentInspectionResult> {
    assertInspectionRequestNetwork(request, this.trustPolicy);
    const idempotencyKey = options.idempotencyKey ?? randomUUID().replaceAll("-", "");
    if (!validIdempotencyKey(idempotencyKey)) {
      throw new Error("idempotencyKey must contain 8 to 128 URL-safe characters.");
    }

    await this.validate(request);
    const response = await this.paymentFetch(this.endpoint("/v1/inspect-transaction"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        ...(options.correlationId === undefined ? {} : { "x-request-id": options.correlationId }),
      },
      body: JSON.stringify(request),
      redirect: "error",
    });
    const body = await responseJson(response);
    if (!response.ok) {
      throw new AgentInspectionError(response.status, responseErrorMessage(body, `MicroVern inspection failed with HTTP ${response.status}.`));
    }
    assertInspectionReport(body);
    const paymentResponse = response.headers.get("payment-response");
    if (paymentResponse === null) throw new Error("MicroVern returned a report without an x402 payment receipt.");
    const paymentReceipt = decodePaymentResponseHeader(paymentResponse);
    if (typeof paymentReceipt.transaction !== "string" || paymentReceipt.transaction.length === 0) {
      throw new Error("MicroVern returned an x402 receipt without a settlement transaction ID.");
    }
    return {
      idempotencyKey,
      requestId: response.headers.get("x-request-id"),
      paymentTransactionId: paymentReceipt.transaction,
      paymentReceipt,
      report: body,
    };
  }
}

export function createMicrovernAgentClient(
  signer: ClientAvmSigner,
  trustPolicy: MicrovernAgentTrustPolicy,
  fetchImplementation?: typeof fetch,
): MicrovernAgentClient {
  return new MicrovernAgentClient(signer, trustPolicy, fetchImplementation);
}
