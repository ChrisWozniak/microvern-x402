import { describe, expect, it } from "vitest";
import {
  isMicrovernTestnetBrowserOrigin,
  MICROVERN_TESTNET_BROWSER_ORIGIN,
  MICROVERN_TESTNET_CAIP2,
  MICROVERN_TESTNET_PRICE_ATOMIC,
  MICROVERN_TESTNET_USDC_ASA_ID,
  sameCappedTestnetPaymentRequirement,
  selectCappedTestnetPaymentRequirement,
} from "../src/browser-payment-policy.js";

const receiver = "KUBSPBIUIPE4CH473F6ZVNSRFJT5W6QAW6RJ65AUEDFD4UUFU5IOKE2ERE";
const offer = {
  scheme: "exact",
  network: MICROVERN_TESTNET_CAIP2,
  payTo: receiver,
  amount: MICROVERN_TESTNET_PRICE_ATOMIC,
  extra: { asset: MICROVERN_TESTNET_USDC_ASA_ID },
};

describe("browser TestNet payment boundary", () => {
  it("accepts only the canonical MicroVern TestNet HTTPS origin", () => {
    expect(isMicrovernTestnetBrowserOrigin(MICROVERN_TESTNET_BROWSER_ORIGIN)).toBe(true);
    expect(isMicrovernTestnetBrowserOrigin(`${MICROVERN_TESTNET_BROWSER_ORIGIN}/v1/inspect-transaction`)).toBe(false);
    expect(isMicrovernTestnetBrowserOrigin("https://example.com")).toBe(false);
  });

  it("accepts exactly one fixed TestNet USDC payment option", () => {
    expect(selectCappedTestnetPaymentRequirement([offer])).toEqual(offer);
  });

  it("rejects a changed network, asset, or amount", () => {
    for (const changed of [
      { ...offer, network: "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=" },
      { ...offer, extra: { asset: "31566704" } },
      { ...offer, amount: "10001" },
    ]) {
      expect(() => selectCappedTestnetPaymentRequirement([changed])).toThrow("fixed TestNet USDC boundary");
    }
  });

  it("detects a fresh quote that differs from the displayed quote", () => {
    expect(sameCappedTestnetPaymentRequirement(offer, { ...offer })).toBe(true);
    expect(sameCappedTestnetPaymentRequirement(offer, { ...offer, payTo: "A".repeat(58) })).toBe(false);
  });
});
