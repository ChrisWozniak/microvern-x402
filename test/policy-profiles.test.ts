import { describe, expect, it } from "vitest";
import algosdk from "algosdk";
import { inspectUnsignedTransaction } from "../src/analyze.js";
import { verifyInspectionReportBinding } from "../src/binding.js";
import { listPolicyProfiles, resolvePolicyProfile } from "../src/policy-profiles.js";
import { parseInspectionRequest } from "../src/validation.js";

const suggestedParams = { fee: 1_000, minFee: 1_000, flatFee: true, firstValid: 1, lastValid: 1_000, genesisHash: Buffer.from("SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=", "base64") };
const sender = algosdk.generateAccount();
const receiver = algosdk.generateAccount();
const encoded = (transaction: algosdk.Transaction) => Buffer.from(algosdk.encodeUnsignedTransaction(transaction)).toString("base64");

describe("versioned policy profiles", () => {
  it("publishes the documented, portable profile IDs", () => {
    expect(listPolicyProfiles().map((profile) => profile.id)).toEqual(["strict-usdc-v1", "algo-only-v1", "no-admin-actions-v1"]);
    expect(resolvePolicyProfile("strict-usdc-v1", "algorand-mainnet").policy.allowedAssetIds).toEqual([31_566_704]);
    expect(resolvePolicyProfile("strict-usdc-v1", "algorand-testnet").policy.allowedAssetIds).toEqual([10_458_941]);
  });

  it("binds the selected profile ID and version into a reproducible report", () => {
    const request = parseInspectionRequest({
      network: "algorand-testnet",
      unsignedTransactionGroup: encoded(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 10_000, assetIndex: 10_458_941, suggestedParams })),
      policyProfile: "strict-usdc-v1",
    });
    const selected = resolvePolicyProfile(request.policyProfile!, request.network);
    const report = inspectUnsignedTransaction(request.unsignedTransactionGroup, request.network, selected.policy, request, selected.profile);
    expect(report).toMatchObject({ verdict: "allow", policyProfile: { id: "strict-usdc-v1", version: "1" } });
    expect(verifyInspectionReportBinding(request, report)).toBe(true);
    expect(verifyInspectionReportBinding({ ...request, policyProfile: "algo-only-v1" }, report)).toBe(false);
  });

  it("fails closed for unapproved assets and prohibited administration", () => {
    const assetProfile = resolvePolicyProfile("algo-only-v1", "algorand-testnet");
    const assetReport = inspectUnsignedTransaction(encoded(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, assetIndex: 99, suggestedParams })), "algorand-testnet", assetProfile.policy);
    expect(assetReport.verdict).toBe("block");
    expect(assetReport.findings.map((finding) => finding.code)).toContain("ASSET_NOT_ALLOWLISTED");

    const adminProfile = resolvePolicyProfile("no-admin-actions-v1", "algorand-testnet");
    const adminReport = inspectUnsignedTransaction(encoded(algosdk.makeAssetFreezeTxnWithSuggestedParamsFromObject({ sender: sender.addr, freezeTarget: receiver.addr, frozen: true, assetIndex: 99, suggestedParams })), "algorand-testnet", adminProfile.policy);
    expect(adminReport.verdict).toBe("block");
    expect(adminReport.findings.map((finding) => finding.code)).toContain("ADMIN_ACTION_PROHIBITED");
  });

  it("rejects unknown or mixed policy selection before payment", () => {
    const group = encoded(algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, suggestedParams }));
    expect(() => parseInspectionRequest({ network: "algorand-testnet", unsignedTransactionGroup: group, policyProfile: "unknown-v1" })).toThrow("Unknown policyProfile");
    expect(() => parseInspectionRequest({ network: "algorand-testnet", unsignedTransactionGroup: group, policyProfile: "algo-only-v1", policy: { maxAlgoSend: 1 } })).toThrow("either policy or policyProfile");
  });
});
