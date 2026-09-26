export const RULESET_VERSION = "2026-09-mvp";

export type Network = "algorand-mainnet" | "algorand-testnet";
export type Verdict = "allow" | "review" | "block";
export type Severity = "low" | "medium" | "high" | "critical";

export interface InspectionPolicy {
  maxAlgoSend?: number;
  maxUsdcSend?: number;
  allowRekey?: boolean;
  allowCloseOut?: boolean;
  allowUnknownApps?: boolean;
  allowedApplicationIds?: number[];
  /** An explicit ASA allowlist. An empty array permits no ASA actions. */
  allowedAssetIds?: number[];
  /** Blocks asset-administration and application-administration actions. */
  prohibitAdminActions?: boolean;
}

export interface AppliedPolicyProfile {
  id: string;
  version: string;
}

export interface InspectionRequest {
  network: Network;
  /** Base64 of concatenated unsigned Algorand transactions encoded with algosdk.encodeUnsignedTransaction. */
  unsignedTransactionGroup: string;
  policy?: InspectionPolicy;
  /** A built-in, versioned profile selected instead of an ad-hoc policy. */
  policyProfile?: string;
}

export interface Finding {
  code: string;
  severity: Severity;
  transactionIndex: number;
  message: string;
}

export interface Action {
  index: number;
  type: string;
  description: string;
  consequences: string[];
}

/** Deterministic totals suitable for a risk-first human review surface. */
export interface ReviewSummary {
  transactionCount: number;
  /** Excludes an ALGO close-out remainder, which is separately flagged as critical. */
  totalAlgoSent: string;
  totalUsdcSent: string;
  totalFeeAlgo: string;
  recipients: string[];
  /** Algorand ASA IDs touched by asset-transfer actions, including opt-ins and opt-outs. */
  assetIds: number[];
}

export interface InspectionAnalysis {
  verdict: Verdict;
  riskScore: number;
  summary: string;
  reviewSummary: ReviewSummary;
  actions: Action[];
  findings: Finding[];
  policyEvaluation: Record<string, "passed" | "failed" | "not-configured">;
  policyProfile?: AppliedPolicyProfile;
  rulesetVersion: typeof RULESET_VERSION;
  disclaimer: string;
}

export interface InspectionReport extends InspectionAnalysis {
  /** Lowercase SHA-256 of the canonical unsigned transaction request and policy. */
  requestHash: string;
  /** Lowercase SHA-256 binding the report content to requestHash. */
  reportChecksum: string;
}
