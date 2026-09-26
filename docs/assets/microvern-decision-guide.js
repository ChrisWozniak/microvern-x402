const FINDING_GUIDANCE = {
  REKEY_PRESENT: "Confirm the new authorized signer independently. A rekey can change who controls the account in future.",
  ALGO_CLOSE_OUT: "Confirm where the remaining ALGO will go. A close-out transfers the account's remaining ALGO balance.",
  ASSET_CLOSE_OUT: "Confirm where the remaining asset balance will go. An asset close-out transfers the remaining holding.",
  UNKNOWN_APPLICATION: "Do not approve an unfamiliar application call until you have independently confirmed the application and its purpose.",
  APPLICATION_ADMIN_ACTION: "Treat this as an administrative application action. Confirm the application, action, and expected consequence independently.",
  ASSET_CLAWBACK: "Confirm the asset's clawback authority and the account whose asset balance is being moved.",
  ASSET_FREEZE: "Confirm the asset and account affected by this freeze or unfreeze action.",
  ALGO_LIMIT_EXCEEDED: "The requested ALGO amount exceeds a boundary you set. Change the request or your boundary only after independent review.",
  USDC_LIMIT_EXCEEDED: "The requested USDC amount exceeds a boundary you set. Change the request or your boundary only after independent review.",
  UNSUPPORTED_TRANSACTION_TYPE: "MicroVern cannot fully interpret one transaction type in this group. Do not rely on an allow-style conclusion alone.",
};

function isReport(value) {
  return value !== null && typeof value === "object" && ["allow", "review", "block"].includes(value.verdict);
}

function rankedFindings(report) {
  const weight = { critical: 4, high: 3, medium: 2, low: 1 };
  return Array.isArray(report.findings)
    ? [...report.findings].filter((finding) => finding && typeof finding === "object")
      .sort((left, right) => (weight[right.severity] ?? 0) - (weight[left.severity] ?? 0))
    : [];
}

/** Returns plain-language, non-authorizing next steps for a completed inspection report. */
export function createMicrovernDecisionGuide(report) {
  if (!isReport(report)) throw new Error("A MicroVern inspection report is required for decision guidance.");

  const findings = rankedFindings(report);
  const specific = findings.map((finding) => FINDING_GUIDANCE[finding.code]).find(Boolean);
  const common = "Compare every recipient, asset, amount, and fee with your intended transaction before signing.";

  if (report.verdict === "block") {
    return {
      tone: "block",
      title: "Do not sign yet",
      summary: "MicroVern found a high-impact action or a boundary violation that requires resolution before this group should be considered.",
      steps: ["Do not sign this group until the highest-severity finding is resolved.", specific ?? "Read the highest-severity finding and resolve it before considering any signature.", common],
    };
  }

  if (report.verdict === "review") {
    return {
      tone: "review",
      title: "Pause and confirm the details",
      summary: "MicroVern found behavior that needs an explicit, independent check before you decide whether to sign.",
      steps: [specific ?? "Read each finding and confirm that the behavior is intentional.", common, "Do not treat this report as approval from a wallet, counterparty, or application."],
    };
  }

  return {
    tone: "allow",
    title: "No configured rule was triggered",
    summary: "This is not a safety guarantee. It means the completed report did not find a configured policy violation in the analyzed transaction data.",
    steps: [common, "Confirm the counterparty and any off-chain agreement independently before signing.", "If this group changed after review, generate and inspect a new report."],
  };
}
