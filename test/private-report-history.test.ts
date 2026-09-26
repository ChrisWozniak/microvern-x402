import algosdk from "algosdk";
import { describe, expect, it } from "vitest";
import { inspectUnsignedTransaction } from "../src/analyze.js";
import { clearPrivateReportHistory, readPrivateReportHistory, removePrivateReport, savePrivateReport } from "../docs/assets/microvern-history.js";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
}

function fixture() {
  const account = algosdk.generateAccount();
  const transaction = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: account.addr, receiver: account.addr, amount: 0, suggestedParams: { fee: 1_000, minFee: 1_000, flatFee: true, firstValid: 1, lastValid: 1_000, genesisHash: Buffer.from("SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=", "base64") } });
  return inspectUnsignedTransaction(Buffer.from(algosdk.encodeUnsignedTransaction(transaction)).toString("base64"), "algorand-testnet");
}

describe("private browser report history", () => {
  it("stores a sanitized report under its stable request-hash ID", () => {
    const storage = memoryStorage();
    const baseReport = fixture();
    const report = { ...baseReport, unsignedTransactionGroup: "must-not-be-stored", reviewSummary: { ...baseReport.reviewSummary, unsignedTransactionGroup: "must-not-be-stored-either" } };
    const records = savePrivateReport({ report }, storage, new Date("2026-09-26T00:00:00.000Z"));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ reportId: report.requestHash, savedAt: "2026-09-26T00:00:00.000Z" });
    expect(JSON.stringify(records)).not.toContain("must-not-be-stored");
    expect(records[0]?.report.reviewSummary).not.toHaveProperty("unsignedTransactionGroup");
    expect(readPrivateReportHistory(storage)).toEqual(records);
  });

  it("replaces a repeated report and supports local removal", () => {
    const storage = memoryStorage();
    const report = fixture();
    savePrivateReport({ report }, storage, new Date("2026-09-26T00:00:00.000Z"));
    const records = savePrivateReport({ report }, storage, new Date("2026-09-26T01:00:00.000Z"));
    expect(records).toHaveLength(1);
    expect(records[0]?.savedAt).toBe("2026-09-26T01:00:00.000Z");
    expect(removePrivateReport(report.requestHash, storage)).toEqual([]);
    clearPrivateReportHistory(storage);
    expect(readPrivateReportHistory(storage)).toEqual([]);
  });

  it("rejects incomplete reports and payment IDs that are not Algorand transaction IDs", () => {
    const storage = memoryStorage();
    expect(() => savePrivateReport({ report: { verdict: "allow" } }, storage)).toThrow("complete");
    expect(() => savePrivateReport({ report: fixture(), paymentTransactionId: "not-a-transaction" }, storage)).toThrow("Payment transaction ID");
  });
});
