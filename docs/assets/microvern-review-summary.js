const CONTROL_FINDINGS = new Set([
  "REKEY_PRESENT",
  "ALGO_CLOSE_OUT",
  "ASSET_CLOSE_OUT",
  "ASSET_CLAWBACK",
  "ASSET_FREEZE",
  "ASSET_CONFIGURATION",
  "ASSET_CREATE",
  "APPLICATION_ADMIN_ACTION",
]);

const CONTROL_ACTIONS = new Set([
  "rekey",
  "account-close-out",
  "asset-opt-out",
  "asset-configuration",
  "asset-freeze",
  "asset-create",
]);

function validReport(report) {
  return report !== null
    && typeof report === "object"
    && ["allow", "review", "block"].includes(report.verdict)
    && report.reviewSummary !== null
    && typeof report.reviewSummary === "object";
}

function actions(report) {
  return Array.isArray(report.actions)
    ? report.actions.filter((action) => action !== null && typeof action === "object")
      .slice()
      .sort((left, right) => Number(left.index ?? 0) - Number(right.index ?? 0))
    : [];
}

function findings(report) {
  return Array.isArray(report.findings)
    ? report.findings.filter((finding) => finding !== null && typeof finding === "object")
    : [];
}

function controlFinding(report) {
  return findings(report).find((finding) => CONTROL_FINDINGS.has(finding.code));
}

function valueOrNone(value, suffix = "") {
  return value === undefined || value === null || value === "" ? "No limit set" : `${value}${suffix}`;
}

/** Converts an inspection report into conservative, readable decision panels. */
export function createMicrovernReviewSummary(report, request) {
  if (!validReport(report)) throw new Error("A completed MicroVern inspection report is required.");
  const review = report.reviewSummary;
  const policy = request?.policy && typeof request.policy === "object" ? request.policy : {};
  const control = controlFinding(report);
  const recipients = Array.isArray(review.recipients) ? review.recipients : [];

  return {
    decision: report.verdict === "block"
      ? { label: "Do not sign yet", tone: "block" }
      : report.verdict === "review"
        ? { label: "Pause and confirm", tone: "review" }
        : { label: "No configured rule triggered", tone: "allow" },
    movement: [
      { label: "Outgoing ALGO", value: `${review.totalAlgoSent ?? "0"} ALGO` },
      { label: "Outgoing USDC", value: `${review.totalUsdcSent ?? "0"} USDC` },
      { label: "Network fees", value: `${review.totalFeeAlgo ?? "0"} ALGO` },
    ],
    recipients,
    accountControl: control === undefined
      ? { changed: false, label: "No account-control change identified" }
      : { changed: true, label: control.message ?? "An account-control or administrative action needs review." },
    timeline: actions(report).map((action, position) => ({
      step: Number.isInteger(action.index) ? action.index + 1 : position + 1,
      type: typeof action.type === "string" ? action.type : "transaction",
      description: typeof action.description === "string" ? action.description : "Transaction details were not supplied.",
      accountControl: CONTROL_ACTIONS.has(action.type) || control?.transactionIndex === action.index,
    })),
    guardrails: [
      { label: "ALGO maximum", expected: valueOrNone(policy.maxAlgoSend, " ALGO"), actual: `${review.totalAlgoSent ?? "0"} ALGO`, outcome: report.policyEvaluation?.maxAlgoSend },
      { label: "USDC maximum", expected: valueOrNone(policy.maxUsdcSend, " USDC"), actual: `${review.totalUsdcSent ?? "0"} USDC`, outcome: report.policyEvaluation?.maxUsdcSend },
      { label: "Rekey", expected: policy.allowRekey === true ? "Allowed by you" : "Blocked by default", actual: findings(report).some((finding) => finding.code === "REKEY_PRESENT") ? "Present" : "Not identified", outcome: report.policyEvaluation?.allowRekey },
      { label: "Close-out", expected: policy.allowCloseOut === true ? "Allowed by you" : "Blocked by default", actual: findings(report).some((finding) => finding.code === "ALGO_CLOSE_OUT" || finding.code === "ASSET_CLOSE_OUT") ? "Present" : "Not identified", outcome: report.policyEvaluation?.allowCloseOut },
    ],
  };
}
