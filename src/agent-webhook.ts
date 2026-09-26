import { createHmac } from "node:crypto";
import type { AgentInspectionResult } from "./agent-client.js";
import type { InspectionReport } from "./types.js";

const DEFAULT_TIMEOUT_MS = 5_000;

export interface AgentInspectionWebhookEvent {
  readonly version: 1;
  readonly event: "microvern.inspection.completed";
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly requestId: string | null;
  readonly reportId: string;
  readonly paymentTransactionId: string;
  readonly report: InspectionReport;
}

export interface AgentWebhookDeliveryOptions {
  /** HTTPS URL owned by the agent operator. Query strings and credentials are refused. */
  url: string;
  /** Shared secret used only to produce the HMAC signature. It is never transmitted. */
  secret: string;
  timeoutMilliseconds?: number;
  fetchImplementation?: typeof fetch;
  now?: Date;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== "unsignedTransactionGroup")
      .map(([key, item]) => [key, sanitizeValue(item)]));
  }
  return value;
}

function sanitizeReport(report: InspectionReport): InspectionReport {
  return sanitizeValue({
    verdict: report.verdict,
    riskScore: report.riskScore,
    summary: report.summary,
    reviewSummary: report.reviewSummary,
    actions: report.actions,
    findings: report.findings,
    policyEvaluation: report.policyEvaluation,
    rulesetVersion: report.rulesetVersion,
    disclaimer: report.disclaimer,
    requestHash: report.requestHash,
    reportChecksum: report.reportChecksum,
  }) as InspectionReport;
}

function endpoint(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Agent webhook URL must be an absolute HTTPS URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Agent webhook URL must use HTTPS without credentials, query, or fragment.");
  }
  return parsed;
}

function assertSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < 16) {
    throw new Error("Agent webhook secret must contain at least 16 UTF-8 bytes.");
  }
}

function timeout(value: number | undefined): number {
  const resolved = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(resolved) || resolved < 500 || resolved > 10_000) {
    throw new Error("Agent webhook timeout must be a whole number from 500 to 10000 milliseconds.");
  }
  return resolved;
}

/** Creates a privacy-preserving event. It deliberately excludes the original unsigned request. */
export function createAgentInspectionWebhookEvent(
  result: AgentInspectionResult,
  now: Date = new Date(),
): AgentInspectionWebhookEvent {
  return {
    version: 1,
    event: "microvern.inspection.completed",
    occurredAt: now.toISOString(),
    idempotencyKey: result.idempotencyKey,
    requestId: result.requestId,
    reportId: result.report.requestHash,
    paymentTransactionId: result.paymentTransactionId,
    report: sanitizeReport(result.report),
  };
}

/** Signs the exact UTF-8 body as `v1=<hex HMAC-SHA256(secret, timestamp + '.' + body)>`. */
export function signAgentWebhookBody(secret: string, timestamp: string, body: string): string {
  assertSecret(secret);
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex")}`;
}

/**
 * Delivers one opt-in callback. There is deliberately no automatic retry:
 * callers must decide their own duplicate-delivery and recovery policy.
 */
export async function deliverAgentInspectionWebhook(
  result: AgentInspectionResult,
  options: AgentWebhookDeliveryOptions,
): Promise<AgentInspectionWebhookEvent> {
  const url = endpoint(options.url);
  const event = createAgentInspectionWebhookEvent(result, options.now);
  const body = JSON.stringify(event);
  const timestamp = event.occurredAt;
  const response = await (options.fetchImplementation ?? fetch)(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(timeout(options.timeoutMilliseconds)),
    headers: {
      "content-type": "application/json",
      "x-microvern-webhook-event": event.event,
      "x-microvern-webhook-timestamp": timestamp,
      "x-microvern-webhook-signature": signAgentWebhookBody(options.secret, timestamp, body),
    },
    body,
  });
  if (!response.ok) throw new Error(`Agent webhook returned HTTP ${response.status}.`);
  return event;
}
