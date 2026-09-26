import { describe, expect, it, vi } from "vitest";
import algosdk from "algosdk";
import { inspectUnsignedTransaction } from "../src/analyze.js";
import { createMicrovernMcpTools } from "../src/mcp-tools.js";
import { resolvePolicyProfile } from "../src/policy-profiles.js";

const suggestedParams = { fee: 1_000, minFee: 1_000, flatFee: true, firstValid: 1, lastValid: 1_000, genesisHash: Buffer.from("SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=", "base64") };
const sender = algosdk.generateAccount();
const receiver = algosdk.generateAccount();
const request = {
  serviceUrl: "https://microvern.example",
  network: "algorand-testnet" as const,
  unsignedTransactionGroup: Buffer.from(algosdk.encodeUnsignedTransaction(algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 100_000, suggestedParams }))).toString("base64"),
  policyProfile: "no-admin-actions-v1",
  transactionLimits: { maxAlgoSend: 1, maxUsdcSend: 1 },
  allowedRecipients: [receiver.addr.toString()],
};
const paymentTrust = { paymentNetwork: "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=", usdcAssetId: "10458941", payTo: receiver.addr.toString(), maxAmountAtomic: "10000" };
const quote = { x402Version: 2, accepts: [{ scheme: "exact", network: paymentTrust.paymentNetwork, asset: paymentTrust.usdcAssetId, payTo: paymentTrust.payTo, amount: "10000" }] };
const quoteHeader = Buffer.from(JSON.stringify(quote)).toString("base64url");

function remote(report?: unknown) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(input.toString()).pathname;
    if (path === "/v1/validate-transaction") return new Response(JSON.stringify({ valid: true }), { status: 200, headers: { "content-type": "application/json" } });
    if (init?.headers instanceof Headers ? !init.headers.has("payment-signature") : !(init?.headers as Record<string, string>)?.["payment-signature"]) {
      return new Response(undefined, { status: 402, headers: { "payment-required": quoteHeader } });
    }
    return new Response(JSON.stringify(report), { status: 200, headers: { "content-type": "application/json", "payment-response": "receipt", "x-request-id": "mcp-test" } });
  });
}

describe("MicroVern MCP tools", () => {
  it("validates through a versioned profile and exact recipient allowlist without a payment", async () => {
    const fetchImplementation = remote();
    const result = await createMicrovernMcpTools(fetchImplementation).validateTransaction(request);
    expect(result).toMatchObject({ valid: true, request: { policyProfile: "no-admin-actions-v1" } });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("returns only a quote that matches the caller's explicit payment cap", async () => {
    const fetchImplementation = remote();
    const result = await createMicrovernMcpTools(fetchImplementation).getQuote({ ...request, paymentTrust });
    expect(result).toMatchObject({ paymentRequired: true, quote: { payTo: receiver.addr.toString(), amount: "10000" } });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    await expect(createMicrovernMcpTools(remote()).getQuote({ ...request, paymentTrust: { ...paymentTrust, maxAmountAtomic: "9999" } })).rejects.toThrow("does not match");
  });

  it("requires an externally approved payment proof and verifies the returned report binding", async () => {
    const apiRequest = { network: request.network, unsignedTransactionGroup: request.unsignedTransactionGroup, policyProfile: request.policyProfile };
    const selected = resolvePolicyProfile(request.policyProfile, request.network);
    const report = inspectUnsignedTransaction(apiRequest.unsignedTransactionGroup, apiRequest.network, selected.policy, apiRequest, selected.profile);
    const noProof = await createMicrovernMcpTools(remote(report)).inspectTransaction({ ...request, paymentTrust });
    expect(noProof).toMatchObject({ paymentRequired: true });
    const result = await createMicrovernMcpTools(remote(report)).inspectTransaction({ ...request, paymentTrust, paymentProof: "externally-approved-proof", idempotencyKey: "mcp-inspection-key" });
    expect(result).toMatchObject({ inspected: true, idempotencyKey: "mcp-inspection-key", report: { requestHash: report.requestHash } });
  });

  it("rejects a group whose recipient is outside the caller allowlist before contacting the API", async () => {
    const fetchImplementation = remote();
    await expect(createMicrovernMcpTools(fetchImplementation).validateTransaction({ ...request, allowedRecipients: [sender.addr.toString()] })).rejects.toThrow("outside the caller allowlist");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("enforces explicit caller transaction caps before requesting a quote or payment", async () => {
    const fetchImplementation = remote();
    await expect(createMicrovernMcpTools(fetchImplementation).validateTransaction({ ...request, transactionLimits: { maxAlgoSend: 0.01, maxUsdcSend: 1 } })).rejects.toThrow("blocks this group locally");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
