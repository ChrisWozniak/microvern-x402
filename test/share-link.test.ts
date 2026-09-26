import algosdk from "algosdk";
import { describe, expect, it } from "vitest";
import { inspectUnsignedTransaction } from "../src/analyze.js";
import { createMicrovernShareLink, readMicrovernShareLink } from "../docs/assets/microvern-share.js";

const sender = algosdk.generateAccount();
const receiver = algosdk.generateAccount();
const suggestedParams = { fee: 1_000, minFee: 1_000, flatFee: true, firstValid: 1, lastValid: 1_000, genesisHash: Buffer.from("SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=", "base64") };

function fixture() {
  const transaction = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1_000_000, suggestedParams });
  const request = { network: "algorand-testnet" as const, unsignedTransactionGroup: Buffer.from(algosdk.encodeUnsignedTransaction(transaction)).toString("base64") };
  return { request, report: inspectUnsignedTransaction(request.unsignedTransactionGroup, request.network) };
}

describe("browser share links", () => {
  it("round-trips a complete report, optional original request, and payment evidence without a server", () => {
    const { request, report } = fixture();
    const paymentTransactionId = "W7TKPIJ374F47DVDXGHCPOTGGLXS74PM7YL4G3EZ4TSTXGNWQWRA";
    const url = createMicrovernShareLink({ report, request, paymentTransactionId }, "https://chriswozniak.github.io/microvern-x402/review.html");

    expect(url).toMatch(/^https:\/\/chriswozniak\.github\.io\/microvern-x402\/review\.html#review=/);
    expect(readMicrovernShareLink(url)).toEqual({ version: 1, report, request, paymentTransactionId });
  });

  it("rejects tampered, incomplete, or impractically large share links", () => {
    const { report } = fixture();
    expect(() => readMicrovernShareLink("https://example.test/review.html#review=not+base64")).toThrow("not valid");
    expect(() => createMicrovernShareLink({ report: { ...report, reportChecksum: "changed" } }, "https://example.test/review.html")).toThrow("complete");
    expect(() => createMicrovernShareLink({ report: { ...report, summary: "x".repeat(20_000) } }, "https://example.test/review.html")).toThrow("too large");
  });
});
