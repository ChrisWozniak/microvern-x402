import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import algosdk from "algosdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalAnalysisApp } from "../../src/app.js";
import { PostgresIdempotencyStore } from "../../src/idempotency.js";

const postgresUrl = process.env.MICROVERN_TEST_POSTGRES_URL;
const describeWithPostgres = postgresUrl === undefined ? describe.skip : describe;
const sender = algosdk.generateAccount();
const receiver = algosdk.generateAccount();
const suggestedParams = {
  fee: 1_000,
  minFee: 1_000,
  flatFee: true,
  firstValid: 1,
  lastValid: 1_000,
  genesisHash: Buffer.from("SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=", "base64"),
};

function unsignedTestnetRequest(amount = 1) {
  const transaction = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: sender.addr,
    receiver: receiver.addr,
    amount,
    suggestedParams,
  });
  return {
    network: "algorand-testnet",
    unsignedTransactionGroup: Buffer.from(algosdk.encodeUnsignedTransaction(transaction)).toString("base64"),
  };
}

async function withLoopbackApp<T>(
  fetchHandler: (request: Request) => Response | Promise<Response>,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = serve({ fetch: fetchHandler, hostname: "127.0.0.1", port: 0 }) as Server;
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Loopback test server did not expose a TCP address.");
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }
}

describeWithPostgres("Postgres idempotency integration", () => {
  const store = new PostgresIdempotencyStore(postgresUrl ?? "postgresql://not-used");

  beforeAll(async () => {
    await store.initialize();
  });

  afterAll(async () => {
    await store.close();
  });

  it("atomically reserves, conflicts, completes, replays, and releases against PostgreSQL", async () => {
    const key = `postgres-integration-${randomUUID()}`;
    const requestHash = "a".repeat(64);
    const concurrent = await Promise.all(Array.from({ length: 10 }, () => store.acquire(key, requestHash, 60_000)));
    expect(concurrent.filter((result) => result.state === "acquired")).toHaveLength(1);
    expect(concurrent.filter((result) => result.state === "in-progress")).toHaveLength(9);
    expect(await store.acquire(key, "b".repeat(64), 60_000)).toEqual({ state: "conflict" });

    const response = { status: 200 as const, body: { verdict: "allow", source: "postgres-integration" }, paymentResponse: "payment-receipt" };
    await store.complete(key, response, 60_000);
    expect(await store.acquire(key, requestHash, 60_000)).toEqual({ state: "completed", response });

    const releasedKey = `postgres-release-${randomUUID()}`;
    expect(await store.acquire(releasedKey, requestHash, 60_000)).toEqual({ state: "acquired" });
    await store.release(releasedKey);
    expect(await store.acquire(releasedKey, requestHash, 60_000)).toEqual({ state: "acquired" });
  });

  it("persists local API idempotency and replay behavior through PostgreSQL over loopback HTTP", async () => {
    const app = createLocalAnalysisApp(store);
    const key = `postgres-api-${randomUUID()}`;
    const requestBody = JSON.stringify(unsignedTestnetRequest());

    await withLoopbackApp(app.fetch, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/v1/inspect-transaction`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: requestBody,
      });
      expect(first.status).toBe(200);
      const firstReport = await first.json();

      const replay = await fetch(`${baseUrl}/v1/inspect-transaction`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: requestBody,
      });
      expect(replay.status).toBe(200);
      expect(replay.headers.get("x-idempotent-replay")).toBe("true");
      expect(await replay.json()).toEqual(firstReport);

      const conflict = await fetch(`${baseUrl}/v1/inspect-transaction`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify(unsignedTestnetRequest(2)),
      });
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toEqual({ error: "This Idempotency-Key is already bound to a different inspection request." });
    });
  });
});
