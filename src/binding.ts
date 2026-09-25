import { createHash } from "node:crypto";
import type { InspectionAnalysis, InspectionPolicy, InspectionReport, InspectionRequest } from "./types.js";

export const MICROVERN_BINDING_FORMAT = "microvern-binding-v1";

type CanonicalValue = null | boolean | number | string | readonly CanonicalValue[] | { readonly [key: string]: CanonicalValue };

function canonicalJson(value: CanonicalValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as { readonly [key: string]: CanonicalValue };
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key]!)}`).join(",")}}`;
}

function sha256(domain: string, value: CanonicalValue): string {
  return createHash("sha256").update(domain).update("\0").update(canonicalJson(value)).digest("hex");
}

function canonicalPolicy(policy: InspectionPolicy | undefined): CanonicalValue {
  if (policy === undefined) return {};
  const allowedApplicationIds = policy.allowedApplicationIds === undefined
    ? undefined
    : [...new Set(policy.allowedApplicationIds)].sort((left, right) => left - right);
  return {
    ...(policy.maxAlgoSend === undefined ? {} : { maxAlgoSend: policy.maxAlgoSend }),
    ...(policy.maxUsdcSend === undefined ? {} : { maxUsdcSend: policy.maxUsdcSend }),
    ...(policy.allowRekey === undefined ? {} : { allowRekey: policy.allowRekey }),
    ...(policy.allowCloseOut === undefined ? {} : { allowCloseOut: policy.allowCloseOut }),
    ...(policy.allowUnknownApps === undefined ? {} : { allowUnknownApps: policy.allowUnknownApps }),
    ...(allowedApplicationIds === undefined ? {} : { allowedApplicationIds }),
  };
}

/**
 * Hashes only canonical request metadata. The original unsigned transaction
 * payload is never persisted by the idempotency implementation.
 */
export function hashInspectionRequest(request: InspectionRequest): string {
  return sha256(MICROVERN_BINDING_FORMAT, {
    network: request.network,
    unsignedTransactionGroup: Buffer.from(request.unsignedTransactionGroup, "base64").toString("base64"),
    policy: canonicalPolicy(request.policy),
  });
}

export function bindInspectionReport(request: InspectionRequest, analysis: InspectionAnalysis): InspectionReport {
  const requestHash = hashInspectionRequest(request);
  const reportChecksum = sha256(`${MICROVERN_BINDING_FORMAT}:report`, { requestHash, analysis: analysis as unknown as CanonicalValue });
  return { ...analysis, requestHash, reportChecksum };
}
