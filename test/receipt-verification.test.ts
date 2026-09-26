import algosdk from "algosdk";
import { describe, expect, it } from "vitest";
import { inspectUnsignedTransaction } from "../src/analyze.js";
import { verifyInspectionReportBinding } from "../src/binding.js";
import { verifyMicrovernReceipt } from "../docs/assets/microvern-verification.js";

const sender = algosdk.generateAccount();
const receiver = algosdk.generateAccount();
const suggestedParams = { fee: 1_000, minFee: 1_000, flatFee: true, firstValid: 1, lastValid: 1_000, genesisHash: Buffer.from("SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=", "base64") };

describe("browser receipt verification", () => {
  it("matches the server's request hash and report checksum for the exact request", async () => {
    const transaction = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1_000_000, suggestedParams });
    const request = {
      network: "algorand-testnet" as const,
      unsignedTransactionGroup: Buffer.from(algosdk.encodeUnsignedTransaction(transaction)).toString("base64"),
      policy: { allowedApplicationIds: [9, 3, 9], allowRekey: false },
    };
    const report = inspectUnsignedTransaction(request.unsignedTransactionGroup, request.network, request.policy);
    await expect(verifyMicrovernReceipt(request, report)).resolves.toMatchObject({ requestHashMatches: true, reportChecksumMatches: true });
    expect(verifyInspectionReportBinding(request, report)).toBe(true);
  });

  it("detects a changed request or modified report", async () => {
    const transaction = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1_000_000, suggestedParams });
    const request = { network: "algorand-testnet" as const, unsignedTransactionGroup: Buffer.from(algosdk.encodeUnsignedTransaction(transaction)).toString("base64") };
    const report = inspectUnsignedTransaction(request.unsignedTransactionGroup, request.network);
    await expect(verifyMicrovernReceipt({ ...request, policy: { maxAlgoSend: 1 } }, report)).resolves.toMatchObject({ requestHashMatches: false, reportChecksumMatches: true });
    await expect(verifyMicrovernReceipt(request, { ...report, summary: "modified after delivery" })).resolves.toMatchObject({ requestHashMatches: true, reportChecksumMatches: false });
    expect(verifyInspectionReportBinding(request, { ...report, summary: "modified after delivery" })).toBe(false);
  });
});
