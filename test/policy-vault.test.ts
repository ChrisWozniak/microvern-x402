import { describe, expect, it } from "vitest";
import algosdk from "algosdk";
import {
  BUILT_IN_POLICY_TEMPLATES,
  clearIntentDraft,
  policyToIntentDraft,
  readIntentDraft,
  readPolicyVault,
  removeContact,
  saveIntentDraft,
  upsertContact,
  upsertPolicy,
  writePolicyVault,
} from "../docs/assets/microvern-policy-vault.js";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
}

describe("browser-local policy vault", () => {
  it("provides conservative built-in templates", () => {
    expect(BUILT_IN_POLICY_TEMPLATES.find((template) => template.id === "algo-only")?.assetIds).toEqual([]);
    expect(BUILT_IN_POLICY_TEMPLATES.find((template) => template.id === "mainnet-usdc")?.assetIds).toEqual([31_566_704]);
    expect(BUILT_IN_POLICY_TEMPLATES.find((template) => template.id === "strict-agent")).toMatchObject({ maxAlgoSend: "0", maxUsdcSend: "0.01", network: "algorand-mainnet" });
  });

  it("stores contacts and a policy locally, then creates a bounded intent draft", () => {
    const storage = memoryStorage();
    const address = algosdk.generateAccount().addr.toString();
    let vault = readPolicyVault(storage);
    vault = upsertContact(vault, { id: "contact-1", name: "Inspection merchant", address });
    vault = upsertPolicy(vault, { id: "policy-1", name: "Capped USDC", contactAddresses: [address], assetIds: [31_566_704], maxAlgoSend: "0", maxUsdcSend: "0.01", network: "algorand-mainnet" });
    vault = writePolicyVault(vault, storage);
    expect(readPolicyVault(storage)).toEqual(vault);
    const draft = policyToIntentDraft(vault.policies[0], vault.contacts);
    expect(draft).toEqual({ recipients: [address], assetIds: [31_566_704], maxAlgoSend: "0", maxUsdcSend: "0.01", network: "algorand-mainnet" });
    saveIntentDraft(draft, storage);
    expect(readIntentDraft(storage)).toEqual(draft);
    clearIntentDraft(storage);
    expect(readIntentDraft(storage)).toBeUndefined();
  });

  it("rejects malformed data and removes contacts without touching a saved policy", () => {
    const storage = memoryStorage();
    expect(() => upsertContact(readPolicyVault(storage), { id: "contact-1", name: "Bad", address: "not-an-address" })).toThrow("Algorand addresses");
    const address = algosdk.generateAccount().addr.toString();
    const vault = upsertContact(readPolicyVault(storage), { id: "contact-1", name: "Trusted", address });
    const withoutLabel = removeContact(vault, "contact-1");
    expect(withoutLabel.contacts).toEqual([]);
    expect(policyToIntentDraft({ id: "policy-1", name: "Still bounded", contactAddresses: [address] }, withoutLabel.contacts)).toEqual({ recipients: [address] });
    expect(() => upsertPolicy(vault, { id: "empty", name: "Empty", contactAddresses: [] })).toThrow("at least one policy boundary");
  });
});
