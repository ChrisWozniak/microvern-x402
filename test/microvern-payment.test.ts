import { describe, expect, it } from "vitest";
import {
  assertDistinctMainnetPayer,
  decodeBazaarDiscoveryOutcome,
  MAINNET_PAYMENT_VALIDITY_ROUNDS,
  payerReadinessError,
  responseError,
  TESTNET_PAYMENT_VALIDITY_ROUNDS,
} from "../docs/assets/microvern-payment.ts";

function paymentRequiredHeader(error: string): string {
  return Buffer.from(JSON.stringify({ x402Version: 2, error, accepts: [] })).toString("base64");
}

describe("browser x402 payment diagnostics", () => {
  it("allows enough time for a Ledger-backed Pera approval", () => {
    expect(TESTNET_PAYMENT_VALIDITY_ROUNDS).toBe(120);
    expect(MAINNET_PAYMENT_VALIDITY_ROUNDS).toBe(120);
  });

  it("reports a facilitator Bazaar result without treating an absent result as success", () => {
    const success = Buffer.from(JSON.stringify({ bazaar: { status: "success" } })).toString("base64url");
    const rejected = Buffer.from(JSON.stringify({ bazaar: { status: "rejected", rejectedReason: "invalid metadata" } })).toString("base64url");
    expect(decodeBazaarDiscoveryOutcome(success)).toEqual({ status: "success" });
    expect(decodeBazaarDiscoveryOutcome(rejected)).toEqual({ status: "rejected", rejectedReason: "invalid metadata" });
    expect(decodeBazaarDiscoveryOutcome(null)).toEqual({ status: "not-reported" });
    expect(decodeBazaarDiscoveryOutcome("not a header")).toEqual({ status: "malformed" });
  });

  it("refuses to use the merchant payment-recipient as the MainNet cataloging payer", () => {
    expect(() => assertDistinctMainnetPayer("GOXRRECIPIENT", "GOXRRECIPIENT"))
      .toThrow("self-payment is not a valid Bazaar cataloging check");
    expect(() => assertDistinctMainnetPayer("KUBSPPAYER", "GOXRRECIPIENT")).not.toThrow();
  });

  it("identifies a selected account that lacks the TestNet USDC opt-in", () => {
    expect(payerReadinessError("GOXRTEST", "not-opted-in").message).toContain("not opted into TestNet USDC");
    expect(payerReadinessError("GOXRTEST", "not-opted-in").message).toContain("No payment was signed.");
  });

  it("shows the server's safe payment-rejection reason", () => {
    const error = responseError({}, 402, new Headers({
      "payment-required": paymentRequiredHeader("invalid_exact_avm_invalid_signature"),
    }));
    expect(error.message).toBe("Payment was not accepted: invalid_exact_avm_invalid_signature. No new payment was settled.");
  });

  it("keeps the generic status when no readable payment diagnostic exists", () => {
    expect(responseError({}, 402, new Headers()).message).toBe("Paid inspection returned HTTP 402.");
  });
});
