import { describe, expect, it, vi } from "vitest";
import { AgentInspectionError, type AgentInspectionResult } from "../src/agent-client.js";
import { inspectWithSafeRecovery, type AgentInspectionRunner } from "../src/agent-integration.js";

const request = { network: "algorand-mainnet" as const, unsignedTransactionGroup: "dGVzdA==" };
const result = {} as AgentInspectionResult;

describe("safe agent inspection recovery", () => {
  it("reuses one idempotency key after an in-progress response", async () => {
    const inspect = vi.fn<AgentInspectionRunner["inspect"]>()
      .mockRejectedValueOnce(new AgentInspectionError(409, "still processing", 1))
      .mockResolvedValueOnce(result);
    const wait = vi.fn(async () => undefined);
    const recovered = await inspectWithSafeRecovery({ inspect }, request, { idempotencyKey: "one-logical-request", correlationId: "support-42", wait });
    expect(recovered).toEqual({ result, attempts: 2 });
    expect(wait).toHaveBeenCalledWith(1_000);
    expect(inspect.mock.calls).toEqual([
      [request, { idempotencyKey: "one-logical-request", correlationId: "support-42" }],
      [request, { idempotencyKey: "one-logical-request", correlationId: "support-42" }],
    ]);
  });

  it("does not retry a changed quote or a rejected request", async () => {
    const inspect = vi.fn<AgentInspectionRunner["inspect"]>().mockRejectedValue(new AgentInspectionError(402, "quote changed"));
    await expect(inspectWithSafeRecovery({ inspect }, request, { idempotencyKey: "one-logical-request", maxAttempts: 3 })).rejects.toMatchObject({ kind: "payment-required" });
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it("limits retries and validates the recovery budget", async () => {
    const inspect = vi.fn<AgentInspectionRunner["inspect"]>().mockRejectedValue(new AgentInspectionError(503, "temporarily unavailable"));
    await expect(inspectWithSafeRecovery({ inspect }, request, { idempotencyKey: "one-logical-request", maxAttempts: 1 })).rejects.toMatchObject({ kind: "unavailable" });
    await expect(inspectWithSafeRecovery({ inspect }, request, { maxAttempts: 4 })).rejects.toThrow("1 to 3");
  });
});
