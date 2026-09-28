import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresIdempotencyStore } from "../../src/idempotency.js";

const postgresUrl = process.env.MICROVERN_TEST_POSTGRES_URL;
const describeWithPostgres = postgresUrl === undefined ? describe.skip : describe;

describeWithPostgres("Postgres idempotency integration", () => {
  const store = new PostgresIdempotencyStore(postgresUrl ?? "postgresql://not-used");

  beforeAll(async () => {
    await store.initialize();
  });

  afterAll(async () => {
    await store.close();
  });

  it("atomically reserves, conflicts, completes, replays, and releases against PostgreSQL", async () => {
    const key = "postgres-integration-key";
    const requestHash = "a".repeat(64);
    const concurrent = await Promise.all(Array.from({ length: 10 }, () => store.acquire(key, requestHash, 60_000)));
    expect(concurrent.filter((result) => result.state === "acquired")).toHaveLength(1);
    expect(concurrent.filter((result) => result.state === "in-progress")).toHaveLength(9);
    expect(await store.acquire(key, "b".repeat(64), 60_000)).toEqual({ state: "conflict" });

    const response = { status: 200 as const, body: { verdict: "allow", source: "postgres-integration" }, paymentResponse: "payment-receipt" };
    await store.complete(key, response, 60_000);
    expect(await store.acquire(key, requestHash, 60_000)).toEqual({ state: "completed", response });

    const releasedKey = "postgres-release-key";
    expect(await store.acquire(releasedKey, requestHash, 60_000)).toEqual({ state: "acquired" });
    await store.release(releasedKey);
    expect(await store.acquire(releasedKey, requestHash, 60_000)).toEqual({ state: "acquired" });
  });
});
