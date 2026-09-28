import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { app } from "../src/app.js";

const malformedInspectionBody = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer(),
  fc.array(fc.jsonValue()),
  fc.record({
    network: fc.constantFrom("algorand-mainnet", "algorand-testnet"),
    unsignedTransactionGroup: fc.string({ maxLength: 256 }).map((value) => `!${value}`),
  }),
  fc.record({
    network: fc.constantFrom("algorand-mainnet", "algorand-testnet"),
    unsignedTransactionGroup: fc.constant(""),
  }),
  fc.record({
    network: fc.constant("not-an-algorand-network"),
    unsignedTransactionGroup: fc.constant("AA=="),
  }),
);

describe("inspection API malformed-input fuzzing", () => {
  it("fails closed with a sanitized 400 response for generated malformed request bodies", async () => {
    await fc.assert(fc.asyncProperty(malformedInspectionBody, async (body) => {
      const response = await app.request("/v1/validate-transaction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      const error = await response.json() as { error?: unknown };
      expect(typeof error.error).toBe("string");
      expect(error.error).not.toContain("Error:");
      expect(error.error).not.toContain("stack");
    }), { numRuns: 150 });
  });
});
