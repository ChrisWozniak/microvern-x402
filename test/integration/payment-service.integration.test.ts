import { once } from "node:events";
import type { Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import algosdk from "algosdk";
import { serve } from "@hono/node-server";
import type { FacilitatorClient } from "@x402/core/server";
import { createPaymentProtectedService } from "../../src/app.js";
import { GOPLAUSIBLE_ALGORAND_TESTNET_CAIP2, requireTestnetPaymentConfig } from "../../src/config.js";

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

function unsignedTestnetRequest() {
  const transaction = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: sender.addr,
    receiver: receiver.addr,
    amount: 1,
    suggestedParams,
  });
  return {
    network: "algorand-testnet",
    unsignedTransactionGroup: Buffer.from(algosdk.encodeUnsignedTransaction(transaction)).toString("base64"),
  };
}

async function withLoopbackService<T>(
  fetchHandler: (request: Request) => Response | Promise<Response>,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = serve({ fetch: fetchHandler, hostname: "127.0.0.1", port: 0 }) as Server;
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Loopback service did not expose a TCP address.");
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }
}

describe("payment-protected service HTTP integration", () => {
  it("serves health, readiness, free validation, and x402 rejections over loopback HTTP without payment", async () => {
    const verify = vi.fn(async () => { throw new Error("A payment proof must not reach verification in this test."); });
    const settle = vi.fn(async () => { throw new Error("A payment proof must not reach settlement in this test."); });
    const facilitator: FacilitatorClient = {
      getSupported: async () => ({
        kinds: [{ x402Version: 2, scheme: "exact", network: GOPLAUSIBLE_ALGORAND_TESTNET_CAIP2 }],
        extensions: [],
        signers: {},
      }),
      verify,
      settle,
    };
    const service = createPaymentProtectedService(
      requireTestnetPaymentConfig({ AVM_ADDRESS: receiver.addr.toString() }),
      facilitator,
    );
    await service.initialize();

    await withLoopbackService(service.app.fetch, async (baseUrl) => {
      expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);
      expect((await fetch(`${baseUrl}/readyz`)).status).toBe(200);

      const freeValidation = await fetch(`${baseUrl}/v1/validate-transaction`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(unsignedTestnetRequest()),
      });
      expect(freeValidation.status).toBe(200);
      expect(await freeValidation.json()).toEqual({ valid: true });

      const quote = await fetch(`${baseUrl}/v1/inspect-transaction`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "integration-quote-key" },
        body: JSON.stringify(unsignedTestnetRequest()),
      });
      expect(quote.status).toBe(402);
      expect(quote.headers.get("payment-required")).not.toBeNull();

      const malformedPayment = await fetch(`${baseUrl}/v1/inspect-transaction`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "integration-malformed-key",
          "payment-signature": "malformed-proof",
        },
        body: JSON.stringify(unsignedTestnetRequest()),
      });
      expect(malformedPayment.status).toBe(402);
      expect(malformedPayment.headers.get("payment-required")).not.toBeNull();
    });

    expect(verify).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });
});
