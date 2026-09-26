import algosdk from "algosdk";
import { describe, expect, it } from "vitest";
import { inspectUnsignedTransaction } from "../src/analyze.js";
import { evaluateMicrovernIntent, parseAssetIntent, parseRecipientIntent } from "../docs/assets/microvern-intent.js";

const sender = algosdk.generateAccount();
const receiver = algosdk.generateAccount();
const otherReceiver = algosdk.generateAccount();
const suggestedParams = { fee: 1_000, minFee: 1_000, flatFee: true, firstValid: 1, lastValid: 1_000, genesisHash: Buffer.from("SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=", "base64") };

function fixture() {
  const transaction = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1_500_000, suggestedParams });
  const request = { network: "algorand-testnet", unsignedTransactionGroup: Buffer.from(algosdk.encodeUnsignedTransaction(transaction)).toString("base64") };
  return { request, report: inspectUnsignedTransaction(request.unsignedTransactionGroup, "algorand-testnet") };
}

describe("review intent checks", () => {
  it("matches declared recipients, exact decimal limits, request network, and an unexpired intent", () => {
    const { request, report } = fixture();
    const result = evaluateMicrovernIntent({ recipients: [receiver.addr.toString()], assetIds: [], maxAlgoSend: "1.5", maxUsdcSend: "0", network: "algorand-testnet", expiresAt: "2030-01-01T00:00:00.000Z" }, report, request, new Date("2029-01-01T00:00:00.000Z"));
    expect(result.matches).toBe(true);
    expect(result.checks).toHaveLength(6);
  });

  it("fails closed for an unexpected recipient, exceeded limit, absent request network, or expired intent", () => {
    const { report } = fixture();
    const result = evaluateMicrovernIntent({ recipients: [otherReceiver.addr.toString()], assetIds: [31566704], maxAlgoSend: "1.499999", network: "algorand-mainnet", expiresAt: "2025-01-01T00:00:00.000Z" }, report, undefined, new Date("2026-01-01T00:00:00.000Z"));
    expect(result.matches).toBe(false);
    expect(result.checks.map((check) => check.status)).toEqual(["mismatch", "mismatch", "mismatch", "mismatch", "mismatch"]);
  });

  it("validates recipient intent input and refuses an empty intent", () => {
    expect(parseRecipientIntent(`${receiver.addr.toString()}, ${receiver.addr.toString()}`)).toEqual([receiver.addr.toString()]);
    expect(() => parseRecipientIntent("not-an-address")).toThrow("Algorand addresses");
    expect(parseAssetIntent("31566704, 31566704, 10458941")).toEqual([10458941, 31566704]);
    expect(() => parseAssetIntent("USDC")).toThrow("asset IDs");
    const { report } = fixture();
    expect(() => evaluateMicrovernIntent({}, report)).toThrow("Declare at least one");
  });
});
