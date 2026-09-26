import { randomUUID } from "node:crypto";
import { inspectUnsignedTransaction } from "./analyze.js";
import { verifyInspectionReportBinding } from "./binding.js";
import { isTrustedMicrovernPaymentRequirement, type PaymentRequirementLike } from "./agent-client.js";
import { resolvePolicyProfile } from "./policy-profiles.js";
import type { InspectionReport, InspectionRequest, Network } from "./types.js";

const ADDRESS_PATTERN = /^[A-Z2-7]{58}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export interface McpInspectionInput {
  serviceUrl: string;
  network: Network;
  unsignedTransactionGroup: string;
  policyProfile: string;
  /** Explicit caller transaction caps, applied locally in addition to the profile. */
  transactionLimits: { maxAlgoSend: number; maxUsdcSend: number };
  /** Exact transaction recipients the caller is willing to consider. */
  allowedRecipients: string[];
}

export interface McpPaymentTrust {
  /** Exact Algorand CAIP-2 payment network. */
  paymentNetwork: string;
  /** Official USDC ASA expected in the quote. */
  usdcAssetId: string;
  /** Exact x402 receiver address expected in the quote. */
  payTo: string;
  /** Explicit maximum x402 spend, in atomic USDC units. */
  maxAmountAtomic: string;
}

export interface McpInspectInput extends McpInspectionInput {
  paymentTrust: McpPaymentTrust;
  /** An externally created x402 Payment-Signature. Never provide a key or seed phrase. */
  paymentProof?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface MicrovernMcpTools {
  validateTransaction(input: McpInspectionInput): Promise<Record<string, unknown>>;
  getQuote(input: McpInspectionInput & { paymentTrust: McpPaymentTrust }): Promise<Record<string, unknown>>;
  inspectTransaction(input: McpInspectInput): Promise<Record<string, unknown>>;
}

function serviceOrigin(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("serviceUrl must be an absolute HTTPS origin.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("serviceUrl must be an HTTPS origin without a path, credentials, query, or fragment.");
  }
  return parsed;
}

function preparedRequest(input: McpInspectionInput): { request: InspectionRequest; preview: InspectionReport } {
  if (!Array.isArray(input.allowedRecipients) || input.allowedRecipients.length === 0 || input.allowedRecipients.some((address) => !ADDRESS_PATTERN.test(address))) {
    throw new Error("allowedRecipients must contain one or more exact Algorand addresses.");
  }
  const selected = resolvePolicyProfile(input.policyProfile, input.network);
  if (!Number.isFinite(input.transactionLimits.maxAlgoSend) || input.transactionLimits.maxAlgoSend < 0 || !Number.isFinite(input.transactionLimits.maxUsdcSend) || input.transactionLimits.maxUsdcSend < 0) {
    throw new Error("transactionLimits must contain explicit non-negative ALGO and USDC caps.");
  }
  const request: InspectionRequest = {
    network: input.network,
    unsignedTransactionGroup: input.unsignedTransactionGroup,
    policyProfile: input.policyProfile,
  };
  const localPolicy = {
    ...selected.policy,
    maxAlgoSend: selected.policy.maxAlgoSend === undefined ? input.transactionLimits.maxAlgoSend : Math.min(selected.policy.maxAlgoSend, input.transactionLimits.maxAlgoSend),
    maxUsdcSend: selected.policy.maxUsdcSend === undefined ? input.transactionLimits.maxUsdcSend : Math.min(selected.policy.maxUsdcSend, input.transactionLimits.maxUsdcSend),
  };
  const localReport = inspectUnsignedTransaction(request.unsignedTransactionGroup, request.network, localPolicy, request, selected.profile);
  if (localReport.verdict === "block") throw new Error(`The selected profile blocks this group locally: ${localReport.summary}`);
  const allowed = new Set(input.allowedRecipients);
  const unexpected = localReport.reviewSummary.recipients.filter((recipient) => !allowed.has(recipient));
  if (unexpected.length) throw new Error(`The group has recipient(s) outside the caller allowlist: ${unexpected.join(", ")}.`);
  return { request, preview: localReport };
}

function paymentTrust(value: McpPaymentTrust): { paymentNetwork: `${string}:${string}`; usdcAssetId: string; payTo: string; maxAmountAtomic: bigint } {
  if (!value.paymentNetwork.startsWith("algorand:") || !/^\d+$/u.test(value.usdcAssetId) || !ADDRESS_PATTERN.test(value.payTo) || !/^\d+$/u.test(value.maxAmountAtomic)) {
    throw new Error("paymentTrust must pin an Algorand CAIP-2 network, numeric USDC asset ID, receiver address, and positive atomic spend cap.");
  }
  const maxAmountAtomic = BigInt(value.maxAmountAtomic);
  if (maxAmountAtomic <= 0n) throw new Error("paymentTrust.maxAmountAtomic must be greater than zero.");
  return { paymentNetwork: value.paymentNetwork as `${string}:${string}`, usdcAssetId: value.usdcAssetId, payTo: value.payTo, maxAmountAtomic };
}

function errorMessage(value: unknown, fallback: string): string {
  return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string" ? value.error : fallback;
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function parseQuote(header: string | null): PaymentRequirementLike {
  if (header === null) throw new Error("MicroVern returned 402 without a PAYMENT-REQUIRED header.");
  try {
    const value = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { accepts?: unknown };
    if (!Array.isArray(value.accepts)) throw new Error("accepts missing");
    return value.accepts[0] as PaymentRequirementLike;
  } catch {
    throw new Error("MicroVern returned an unreadable payment quote.");
  }
}

function assertReport(value: unknown): asserts value is InspectionReport {
  if (typeof value !== "object" || value === null || !("requestHash" in value) || !("reportChecksum" in value)) {
    throw new Error("MicroVern returned an invalid inspection report.");
  }
}

function serializableQuote(quote: PaymentRequirementLike): Record<string, unknown> {
  return {
    scheme: quote.scheme,
    network: quote.network,
    asset: quote.asset,
    payTo: quote.payTo,
    amount: quote.amount,
  };
}

export function createMicrovernMcpTools(fetchImplementation: typeof fetch = fetch): MicrovernMcpTools {
  async function validateRemote(origin: URL, request: InspectionRequest): Promise<void> {
    const response = await fetchImplementation(new URL("/v1/validate-transaction", origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      redirect: "error",
    });
    if (!response.ok) throw new Error(errorMessage(await json(response), `MicroVern validation failed with HTTP ${response.status}.`));
  }

  async function quote(input: McpInspectionInput & { paymentTrust: McpPaymentTrust }): Promise<{ origin: URL; request: InspectionRequest; quote: PaymentRequirementLike }> {
    const origin = serviceOrigin(input.serviceUrl);
    const prepared = preparedRequest(input);
    const request = prepared.request;
    const trust = paymentTrust(input.paymentTrust);
    await validateRemote(origin, request);
    const response = await fetchImplementation(new URL("/v1/inspect-transaction", origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      redirect: "error",
    });
    if (response.status !== 402) throw new Error(`Expected a payment quote (HTTP 402), received HTTP ${response.status}.`);
    const requirement = parseQuote(response.headers.get("payment-required"));
    if (!isTrustedMicrovernPaymentRequirement(requirement, trust)) throw new Error("The payment quote does not match the caller's pinned network, USDC asset, receiver, or spend cap.");
    return { origin, request, quote: requirement };
  }

  return {
    async validateTransaction(input) {
      const origin = serviceOrigin(input.serviceUrl);
      const prepared = preparedRequest(input);
      await validateRemote(origin, prepared.request);
      return { valid: true, request: prepared.request, localVerdict: prepared.preview.verdict, notice: "Validated with the selected versioned profile, explicit caller transaction caps, and recipient allowlist. No payment, wallet, signature, or broadcast occurred." };
    },

    async getQuote(input) {
      const prepared = await quote(input);
      return { paymentRequired: true, quote: serializableQuote(prepared.quote), notice: "Quote verified against explicit caller trust limits. No payment was sent." };
    },

    async inspectTransaction(input) {
      const prepared = await quote(input);
      if (input.paymentProof === undefined || input.paymentProof.length === 0) {
        return { paymentRequired: true, quote: serializableQuote(prepared.quote), notice: "An externally approved Payment-Signature is required to continue. MicroVern MCP never accepts a seed phrase or private key." };
      }
      const idempotencyKey = input.idempotencyKey ?? randomUUID().replaceAll("-", "");
      if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) throw new Error("idempotencyKey must contain 8 to 128 URL-safe characters.");
      const response = await fetchImplementation(new URL("/v1/inspect-transaction", prepared.origin), {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey, "payment-signature": input.paymentProof },
        body: JSON.stringify(prepared.request),
        redirect: "error",
      });
      const body = await json(response);
      if (!response.ok) throw new Error(errorMessage(body, `MicroVern inspection failed with HTTP ${response.status}.`));
      assertReport(body);
      if (!verifyInspectionReportBinding(prepared.request, body)) throw new Error("MicroVern returned a report that is not bound to the exact profile request.");
      return { inspected: true, idempotencyKey, requestId: response.headers.get("x-request-id"), paymentReceipt: response.headers.get("payment-response"), report: body };
    },
  };
}
