import { ValidationError } from "./errors.js";
import type { InspectionPolicy, InspectionRequest, Network } from "./types.js";

const MAX_ENCODED_BYTES = 64 * 1024;
const REQUEST_FIELDS = new Set(["network", "unsignedTransactionGroup", "policy"]);
const POLICY_FIELDS = new Set(["maxAlgoSend", "maxUsdcSend", "allowRekey", "allowCloseOut", "allowUnknownApps", "allowedApplicationIds"]);

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

  if (candidate.policy !== undefined && (typeof candidate.policy !== "object" || candidate.policy === null || Array.isArray(candidate.policy))) {
    throw new ValidationError("policy must be an object when provided.");
  }

  if (candidate.policy === undefined) {
    return { network: candidate.network, unsignedTransactionGroup: candidate.unsignedTransactionGroup };
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
  if (policy.allowedApplicationIds !== undefined && (!Array.isArray(policy.allowedApplicationIds) || policy.allowedApplicationIds.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id < 0))) {
    throw new ValidationError("allowedApplicationIds must be an array of non-negative integer application IDs.");
  }

  return {
    network: candidate.network,
    unsignedTransactionGroup: candidate.unsignedTransactionGroup,
    policy: policy as InspectionPolicy,
  };
}
