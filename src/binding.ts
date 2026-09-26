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
  const allowedAssetIds = policy.allowedAssetIds === undefined
    ? undefined
    : [...new Set(policy.allowedAssetIds)].sort((left, right) => left - right);
  return {
    ...(policy.maxAlgoSend === undefined ? {} : { maxAlgoSend: policy.maxAlgoSend }),
    ...(policy.maxUsdcSend === undefined ? {} : { maxUsdcSend: policy.maxUsdcSend }),
    ...(policy.allowRekey === undefined ? {} : { allowRekey: policy.allowRekey }),
    ...(policy.allowCloseOut === undefined ? {} : { allowCloseOut: policy.allowCloseOut }),
    ...(policy.allowUnknownApps === undefined ? {} : { allowUnknownApps: policy.allowUnknownApps }),
    ...(allowedApplicationIds === undefined ? {} : { allowedApplicationIds }),
    ...(allowedAssetIds === undefined ? {} : { allowedAssetIds }),
    ...(policy.prohibitAdminActions === undefined ? {} : { prohibitAdminActions: policy.prohibitAdminActions }),
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
    ...(request.policyProfile === undefined ? {} : { policyProfile: request.policyProfile }),
  });
}

export function bindInspectionReport(request: InspectionRequest, analysis: InspectionAnalysis): InspectionReport {
  const requestHash = hashInspectionRequest(request);
  const reportChecksum = sha256(`${MICROVERN_BINDING_FORMAT}:report`, { requestHash, analysis: analysis as unknown as CanonicalValue });
  return { ...analysis, requestHash, reportChecksum };
}

/** Verifies that an inspection report is intact and bound to this exact request. */
export function verifyInspectionReportBinding(request: InspectionRequest, report: InspectionReport): boolean {
  const requestHash = hashInspectionRequest(request);
  if (report.requestHash !== requestHash) return false;
  const analysis: InspectionAnalysis = {
    verdict: report.verdict,
    riskScore: report.riskScore,
    summary: report.summary,
    reviewSummary: report.reviewSummary,
    actions: report.actions,
    findings: report.findings,
    policyEvaluation: report.policyEvaluation,
    ...(report.policyProfile === undefined ? {} : { policyProfile: report.policyProfile }),
    rulesetVersion: report.rulesetVersion,
    disclaimer: report.disclaimer,
  };
  const checksum = sha256(`${MICROVERN_BINDING_FORMAT}:report`, { requestHash, analysis: analysis as unknown as CanonicalValue });
  return report.reportChecksum === checksum;
}
