import { describe, expect, it, vi } from "vitest";
import { initializeWithDatabaseRetry, isTransientDatabaseStartupError } from "../src/startup-retry.js";

describe("database startup retry", () => {
  it("recognizes temporary database connection failures", () => {
    expect(isTransientDatabaseStartupError(Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isTransientDatabaseStartupError({ code: "57P03" })).toBe(true);
    expect(isTransientDatabaseStartupError(new Error("invalid password for database user"))).toBe(false);
  });

  it("retries a temporary startup failure and then succeeds", async () => {
    const initialize = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" }))
      .mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" }))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn(async () => {});
    const onRetry = vi.fn();

    await expect(initializeWithDatabaseRetry(initialize, { maxAttempts: 4, initialDelayMs: 10, maxDelayMs: 20, sleep, onRetry })).resolves.toBeUndefined();
    expect(initialize).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("fails closed after the final temporary startup failure", async () => {
    const failure = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" });
    const initialize = vi.fn().mockRejectedValue(failure);
    const sleep = vi.fn(async () => {});

    await expect(initializeWithDatabaseRetry(initialize, { maxAttempts: 2, sleep })).rejects.toBe(failure);
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-transient configuration failure", async () => {
    const failure = new Error("invalid password for database user");
    const initialize = vi.fn().mockRejectedValue(failure);
    const sleep = vi.fn(async () => {});

    await expect(initializeWithDatabaseRetry(initialize, { sleep })).rejects.toBe(failure);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
