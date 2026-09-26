import { ValidationError } from "./errors.js";
import { validatePolicyProfile } from "./policy-profiles.js";
import type { InspectionPolicy, InspectionRequest, Network } from "./types.js";

const MAX_ENCODED_BYTES = 64 * 1024;
const REQUEST_FIELDS = new Set(["network", "unsignedTransactionGroup", "policy", "policyProfile", "accountStateChecks"]);
const POLICY_FIELDS = new Set(["maxAlgoSend", "maxUsdcSend", "allowRekey", "allowCloseOut", "allowUnknownApps", "allowedApplicationIds", "allowedAssetIds", "prohibitAdminActions"]);

function isNetwork(value: unknown): value is Network {
  return value === "algorand-mainnet" || value === "algorand-testnet";
}

export function parseInspectionRequest(value: unknown): InspectionRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError("Request body must be a JSON object.");
  }

  const candidate = value as Record<string, unknown>;
  for (const key of Object.keys(candidate)) {
    if (!REQUEST_FIELDS.has(key)) throw new ValidationError(`Unsupported request field: ${key}.`);
  }
  if (!isNetwork(candidate.network)) {
    throw new ValidationError("network must be algorand-mainnet or algorand-testnet.");
  }
  if (typeof candidate.unsignedTransactionGroup !== "string" || candidate.unsignedTransactionGroup.length === 0) {
    throw new ValidationError("unsignedTransactionGroup must be a non-empty base64 string.");
  }

  const bytes = Buffer.from(candidate.unsignedTransactionGroup, "base64");
  if (bytes.length === 0 || bytes.length > MAX_ENCODED_BYTES) {
    throw new ValidationError("unsignedTransactionGroup must decode to between 1 and 65536 bytes.");
  }
  if (Buffer.from(bytes).toString("base64").replace(/=+$/, "") !== candidate.unsignedTransactionGroup.replace(/=+$/, "")) {
    throw new ValidationError("unsignedTransactionGroup is not valid base64.");
  }

  if (candidate.policy !== undefined && candidate.policyProfile !== undefined) {
    throw new ValidationError("Provide either policy or policyProfile, not both.");
  }
  let accountStateChecks: { consent: true } | undefined;
  if (candidate.accountStateChecks !== undefined) {
    if (
      typeof candidate.accountStateChecks !== "object"
      || candidate.accountStateChecks === null
      || Array.isArray(candidate.accountStateChecks)
      || Object.keys(candidate.accountStateChecks).length !== 1
      || !("consent" in candidate.accountStateChecks)
      || candidate.accountStateChecks.consent !== true
    ) {
      throw new ValidationError("accountStateChecks must be exactly { consent: true } to approve public account-state reads.");
    }
    accountStateChecks = { consent: true };
  }
  if (candidate.policyProfile !== undefined) {
    validatePolicyProfile(candidate.policyProfile, candidate.network);
    return { network: candidate.network, unsignedTransactionGroup: candidate.unsignedTransactionGroup, policyProfile: candidate.policyProfile as string, ...(accountStateChecks === undefined ? {} : { accountStateChecks }) };
  }

  if (candidate.policy !== undefined && (typeof candidate.policy !== "object" || candidate.policy === null || Array.isArray(candidate.policy))) {
    throw new ValidationError("policy must be an object when provided.");
  }

  if (candidate.policy === undefined) {
    return { network: candidate.network, unsignedTransactionGroup: candidate.unsignedTransactionGroup, ...(accountStateChecks === undefined ? {} : { accountStateChecks }) };
  }

  const policy = candidate.policy as Record<string, unknown>;
  for (const key of Object.keys(policy)) {
    if (!POLICY_FIELDS.has(key)) throw new ValidationError(`Unsupported policy field: ${key}.`);
  }
  for (const key of ["maxAlgoSend", "maxUsdcSend"]) {
    const limit = policy[key];
    if (limit !== undefined && (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0)) {
      throw new ValidationError(`${key} must be a non-negative finite number.`);
    }
  }
  for (const key of ["allowRekey", "allowCloseOut", "allowUnknownApps"]) {
    const flag = policy[key];
    if (flag !== undefined && typeof flag !== "boolean") {
      throw new ValidationError(`${key} must be a boolean.`);
    }
  }
  for (const key of ["allowedApplicationIds", "allowedAssetIds"]) {
    if (policy[key] !== undefined && (!Array.isArray(policy[key]) || policy[key].some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id < 0))) {
      throw new ValidationError(`${key} must be an array of non-negative integer IDs.`);
    }
  }
  if (policy.prohibitAdminActions !== undefined && typeof policy.prohibitAdminActions !== "boolean") {
    throw new ValidationError("prohibitAdminActions must be a boolean.");
  }

  return {
    network: candidate.network,
    unsignedTransactionGroup: candidate.unsignedTransactionGroup,
    policy: policy as InspectionPolicy,
    ...(accountStateChecks === undefined ? {} : { accountStateChecks }),
  };
}
