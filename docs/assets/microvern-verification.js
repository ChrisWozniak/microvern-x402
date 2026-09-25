const BINDING_FORMAT = "microvern-binding-v1";

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function canonicalBase64(value) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return btoa(binary);
}

function canonicalPolicy(policy) {
  if (policy === undefined || policy === null) return {};
  const appIds = policy.allowedApplicationIds === undefined ? undefined : [...new Set(policy.allowedApplicationIds)].sort((left, right) => left - right);
  return {
    ...(policy.maxAlgoSend === undefined ? {} : { maxAlgoSend: policy.maxAlgoSend }),
    ...(policy.maxUsdcSend === undefined ? {} : { maxUsdcSend: policy.maxUsdcSend }),
    ...(policy.allowRekey === undefined ? {} : { allowRekey: policy.allowRekey }),
    ...(policy.allowCloseOut === undefined ? {} : { allowCloseOut: policy.allowCloseOut }),
    ...(policy.allowUnknownApps === undefined ? {} : { allowUnknownApps: policy.allowUnknownApps }),
    ...(appIds === undefined ? {} : { allowedApplicationIds: appIds }),
  };
}

async function sha256(domain, value) {
  const bytes = new TextEncoder().encode(`${domain}\0${canonicalJson(value)}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function analysisFromReport(report) {
  return {
    verdict: report.verdict,
    riskScore: report.riskScore,
    summary: report.summary,
    reviewSummary: report.reviewSummary,
    actions: report.actions,
    findings: report.findings,
    policyEvaluation: report.policyEvaluation,
    rulesetVersion: report.rulesetVersion,
    disclaimer: report.disclaimer,
  };
}

export async function hashInspectionRequestInBrowser(request) {
  return sha256(BINDING_FORMAT, {
    network: request.network,
    unsignedTransactionGroup: canonicalBase64(request.unsignedTransactionGroup),
    policy: canonicalPolicy(request.policy),
  });
}

export async function verifyMicrovernReceipt(request, report) {
  const computedRequestHash = await hashInspectionRequestInBrowser(request);
  const computedReportChecksum = await sha256(`${BINDING_FORMAT}:report`, {
    requestHash: report.requestHash,
    analysis: analysisFromReport(report),
  });
  return {
    requestHashMatches: computedRequestHash === report.requestHash,
    reportChecksumMatches: computedReportChecksum === report.reportChecksum,
    computedRequestHash,
    computedReportChecksum,
  };
}
