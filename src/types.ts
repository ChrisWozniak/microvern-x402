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

/**
 * Explicit, per-request consent to read public Algorand account state related
 * to the submitted group. It is intentionally opt-in: MicroVern does not
 * query accounts merely because an unsigned group was submitted.
 */
export interface AccountStateChecks {
  consent: true;
}

export interface ObservedAccountState {
  address: string;
  /** True only when the configured Algod node returned a ledger record. */
  active: boolean;
  /** Atomic ALGO balance returned by Algod; absent when no record was found. */
  balanceMicroAlgos?: string;
  assetOptIns: Array<{ assetId: number; optedIn: boolean }>;
}

/**
 * Public-state observations are facts reported by the configured Algod node,
 * not a prediction or a reservation. They can change after the reported round.
 */
export interface AccountStateContext {
  status: "observed" | "not-configured" | "unavailable";
  source: "algod";
  observedRound?: number;
  observedAt?: string;
  accounts: ObservedAccountState[];
  notice: string;
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
  /** Explicit consent to obtain current public account-state observations. */
  accountStateChecks?: AccountStateChecks;
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
  /** Machine-readable explanation when this is an Algorand application call. */
  application?: {
    registryVersion: string;
    applicationId: number;
    recognition: "recognized" | "known-application-unknown-method" | "unknown";
    name?: string;
    method?: string;
    referenceUrl?: string;
  };
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
  /** Present only when the caller explicitly consented to public state reads. */
  accountState?: AccountStateContext;
  rulesetVersion: typeof RULESET_VERSION;
  disclaimer: string;
}

export interface InspectionReport extends InspectionAnalysis {
  /** Lowercase SHA-256 of the canonical unsigned transaction request and policy. */
  requestHash: string;
  /** Lowercase SHA-256 binding the report content to requestHash. */
  reportChecksum: string;
}
