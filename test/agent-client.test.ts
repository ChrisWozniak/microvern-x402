import type { ClientAvmSigner } from "@x402/avm";
import { describe, expect, it, vi } from "vitest";
import {
  AgentInspectionError,
  AgentPreflightError,
  createMicrovernAgentClient,
  isTrustedMicrovernPaymentRequirement,
  type MicrovernAgentTrustPolicy,
} from "../src/agent-client.js";

const trustPolicy: MicrovernAgentTrustPolicy = {
  serviceUrl: "https://microvern-x402-mainnet.onrender.com",
  inspectionNetwork: "algorand-mainnet",
  paymentNetwork: "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=",
  usdcAssetId: "31566704",
  payTo: "GOXRKDEGYKJTNAJSPFAVUQQHHWMKBI7IW5PJ6G65X32OCYBMN6WYNNOPGE",
  maxAmountAtomic: 10_000n,
};

const signer: ClientAvmSigner = {
  address: "GOXRKDEGYKJTNAJSPFAVUQQHHWMKBI7IW5PJ6G65X32OCYBMN6WYNNOPGE",
  signTransactions: async () => [],
};

const request = {
  network: "algorand-mainnet" as const,
  unsignedTransactionGroup: "dGVzdA==",
};

describe("MicrovernAgentClient", () => {
  it("accepts only the pinned exact Algorand USDC payment requirement within the cap", () => {
    const expected = {
      scheme: "exact",
      network: trustPolicy.paymentNetwork,
      asset: trustPolicy.usdcAssetId,
      payTo: trustPolicy.payTo,
      amount: "10000",
    };
    expect(isTrustedMicrovernPaymentRequirement(expected, trustPolicy)).toBe(true);
    expect(isTrustedMicrovernPaymentRequirement({ ...expected, amount: "10001" }, trustPolicy)).toBe(false);
    expect(isTrustedMicrovernPaymentRequirement({ ...expected, payTo: "UNTRUSTED" }, trustPolicy)).toBe(false);
    expect(isTrustedMicrovernPaymentRequirement({ ...expected, asset: "10458941" }, trustPolicy)).toBe(false);
    expect(isTrustedMicrovernPaymentRequirement({ ...expected, network: "algorand:other" }, trustPolicy)).toBe(false);
  });

  it("validates the group for free before an inspection can reach payment handling", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "unsigned group is malformed" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }));
    const client = createMicrovernAgentClient(signer, trustPolicy, fetchImplementation);
    await expect(client.inspect(request)).rejects.toEqual(new AgentPreflightError(400, "unsigned group is malformed"));
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toBe("https://microvern-x402-mainnet.onrender.com/v1/validate-transaction");
  });

  it("rejects a mismatched inspection network before making a request", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const client = createMicrovernAgentClient(signer, trustPolicy, fetchImplementation);
    await expect(client.validate({ ...request, network: "algorand-testnet" })).rejects.toThrow("does not match trusted network");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("rejects non-HTTPS or path-bearing service URLs", () => {
    expect(() => createMicrovernAgentClient(signer, { ...trustPolicy, serviceUrl: "http://microvern.example" })).toThrow("HTTPS");
    expect(() => createMicrovernAgentClient(signer, { ...trustPolicy, serviceUrl: "https://microvern.example/api" })).toThrow("without a path");
  });

  it("labels retryable and non-retryable inspection responses distinctly", () => {
    expect(new AgentInspectionError(402, "quote changed").kind).toBe("payment-required");
    expect(new AgentInspectionError(409, "processing").kind).toBe("in-progress");
    expect(new AgentInspectionError(429, "slow down").kind).toBe("throttled");
    expect(new AgentInspectionError(503, "offline").kind).toBe("unavailable");
    expect(new AgentInspectionError(400, "invalid").kind).toBe("rejected");
    expect(new AgentInspectionError(429, "slow down", 12).retryAfterSeconds).toBe(12);
  });
});
