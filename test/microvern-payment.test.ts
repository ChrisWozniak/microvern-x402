import { describe, expect, it } from "vitest";
import { responseError } from "../docs/assets/microvern-payment.ts";

function paymentRequiredHeader(error: string): string {
  return Buffer.from(JSON.stringify({ x402Version: 2, error, accepts: [] })).toString("base64");
}

describe("browser x402 payment diagnostics", () => {
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
