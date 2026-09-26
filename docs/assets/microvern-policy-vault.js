const ADDRESS_PATTERN = /^[A-Z2-7]{58}$/;
const DECIMAL_PATTERN = /^\d+(?:\.\d{1,6})?$/u;
const NETWORKS = new Set(["algorand-mainnet", "algorand-testnet"]);

export const POLICY_STORAGE_KEY = "microvern.policy-vault.v1";
export const INTENT_DRAFT_STORAGE_KEY = "microvern.intent-draft.v1";

export const BUILT_IN_POLICY_TEMPLATES = Object.freeze([
  Object.freeze({
    id: "algo-only",
    name: "ALGO only",
    description: "Reject any ASA transfer, including an opt-in or opt-out.",
    assetIds: [],
  }),
  Object.freeze({
    id: "mainnet-usdc",
    name: "MainNet USDC payment",
    description: "Allow only the official MainNet USDC ASA; set a spend cap before saving.",
    network: "algorand-mainnet",
    assetIds: [31_566_704],
  }),
  Object.freeze({
    id: "strict-agent",
    name: "Strict agent limit",
    description: "MainNet USDC only, no outgoing ALGO, capped at $0.01 USDC.",
    network: "algorand-mainnet",
    assetIds: [31_566_704],
    maxAlgoSend: "0",
    maxUsdcSend: "0.01",
  }),
]);

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value, label, maximum = 80) {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maximum) throw new Error(`${label} must be between 1 and ${maximum} characters.`);
  return cleaned;
}

function cleanDecimal(value, label) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) throw new Error(`${label} must be a non-negative decimal with at most 6 places.`);
  return value;
}

function cleanAssetIds(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((assetId) => !Number.isSafeInteger(assetId) || assetId < 0)) {
    throw new Error("Asset IDs must be non-negative integers.");
  }
  return [...new Set(value)].sort((left, right) => left - right);
}

function cleanAddresses(value, label) {
  if (!Array.isArray(value) || value.some((address) => typeof address !== "string" || !ADDRESS_PATTERN.test(address))) {
    throw new Error(`${label} must contain valid Algorand addresses.`);
  }
  return [...new Set(value)];
}

function emptyVault() {
  return { version: 1, contacts: [], policies: [] };
}

function normalizeContact(contact) {
  if (!isObject(contact)) throw new Error("A trusted contact is invalid.");
  return { id: cleanText(contact.id, "Contact ID", 100), name: cleanText(contact.name, "Contact name", 60), address: cleanAddresses([contact.address], "Trusted contacts")[0] };
}

export function normalizePolicy(policy) {
  if (!isObject(policy)) throw new Error("A saved policy is invalid.");
  const normalized = {
    id: cleanText(policy.id, "Policy ID", 100),
    name: cleanText(policy.name, "Policy name", 60),
    contactAddresses: cleanAddresses(policy.contactAddresses ?? [], "Policy contacts"),
  };
  const assetIds = cleanAssetIds(policy.assetIds);
  const maxAlgoSend = cleanDecimal(policy.maxAlgoSend, "Maximum ALGO");
  const maxUsdcSend = cleanDecimal(policy.maxUsdcSend, "Maximum USDC");
  if (assetIds !== undefined) normalized.assetIds = assetIds;
  if (maxAlgoSend !== undefined) normalized.maxAlgoSend = maxAlgoSend;
  if (maxUsdcSend !== undefined) normalized.maxUsdcSend = maxUsdcSend;
  if (policy.network !== undefined) {
    if (!NETWORKS.has(policy.network)) throw new Error("Policy network must be Algorand MainNet or TestNet.");
    normalized.network = policy.network;
  }
  if (assetIds === undefined && maxAlgoSend === undefined && maxUsdcSend === undefined && normalized.contactAddresses.length === 0 && normalized.network === undefined) {
    throw new Error("Save at least one policy boundary or trusted contact.");
  }
  return normalized;
}

export function readPolicyVault(storage = globalThis.localStorage) {
  const raw = storage.getItem(POLICY_STORAGE_KEY);
  if (raw === null) return emptyVault();
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.contacts) || !Array.isArray(parsed.policies)) throw new Error("format");
    const contacts = parsed.contacts.map(normalizeContact);
    const policies = parsed.policies.map(normalizePolicy);
    return { version: 1, contacts, policies };
  } catch {
    throw new Error("Saved safeguards could not be read. They were left unchanged.");
  }
}

export function writePolicyVault(vault, storage = globalThis.localStorage) {
  if (!isObject(vault) || !Array.isArray(vault.contacts) || !Array.isArray(vault.policies)) throw new Error("Saved safeguards are invalid.");
  const normalized = { version: 1, contacts: vault.contacts.map(normalizeContact), policies: vault.policies.map(normalizePolicy) };
  storage.setItem(POLICY_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function upsertContact(vault, contact) {
  const normalized = normalizeContact(contact);
  const contacts = vault.contacts.filter((existing) => existing.id !== normalized.id && existing.address !== normalized.address);
  return { ...vault, contacts: [...contacts, normalized].sort((left, right) => left.name.localeCompare(right.name)) };
}

export function removeContact(vault, contactId) {
  return { ...vault, contacts: vault.contacts.filter((contact) => contact.id !== contactId) };
}

export function upsertPolicy(vault, policy) {
  const normalized = normalizePolicy(policy);
  const policies = vault.policies.filter((existing) => existing.id !== normalized.id);
  return { ...vault, policies: [...policies, normalized].sort((left, right) => left.name.localeCompare(right.name)) };
}

export function removePolicy(vault, policyId) {
  return { ...vault, policies: vault.policies.filter((policy) => policy.id !== policyId) };
}

export function policyToIntentDraft(policy, contacts) {
  const normalizedPolicy = normalizePolicy(policy);
  // A policy retains its recipient boundary even if the user later removes the
  // display-only contact label. Do not silently weaken a saved safeguard.
  contacts.forEach(normalizeContact);
  const recipients = normalizedPolicy.contactAddresses;
  return {
    ...(recipients.length ? { recipients } : {}),
    ...(normalizedPolicy.assetIds === undefined ? {} : { assetIds: normalizedPolicy.assetIds }),
    ...(normalizedPolicy.maxAlgoSend === undefined ? {} : { maxAlgoSend: normalizedPolicy.maxAlgoSend }),
    ...(normalizedPolicy.maxUsdcSend === undefined ? {} : { maxUsdcSend: normalizedPolicy.maxUsdcSend }),
    ...(normalizedPolicy.network === undefined ? {} : { network: normalizedPolicy.network }),
  };
}

export function saveIntentDraft(draft, storage = globalThis.localStorage) {
  if (!isObject(draft)) throw new Error("Intent draft is invalid.");
  storage.setItem(INTENT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

export function readIntentDraft(storage = globalThis.localStorage) {
  const raw = storage.getItem(INTENT_DRAFT_STORAGE_KEY);
  if (raw === null) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) throw new Error("format");
    return parsed;
  } catch {
    throw new Error("Saved intent draft could not be read. It was left unchanged.");
  }
}

export function clearIntentDraft(storage = globalThis.localStorage) {
  storage.removeItem(INTENT_DRAFT_STORAGE_KEY);
}
