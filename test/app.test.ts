import algosdk from "algosdk";
import { describe, expect, it } from "vitest";
import { app, createPaymentProtectedService } from "../src/app.js";
import {
  GOPLAUSIBLE_ALGORAND_MAINNET_CAIP2,
  GOPLAUSIBLE_ALGORAND_TESTNET_CAIP2,
  GOPLAUSIBLE_FACILITATOR_URL,
  loadPaymentConfig,
  loadPostgresIdempotencyUrl,
  loadTestnetPaymentConfig,
  MICROVERN_MAINNET_CONFIRMATION,
  MICROVERN_TESTNET_PRICE_USD,
  requireTestnetPaymentConfig,
} from "../src/config.js";
import { InMemoryIdempotencyStore, createIdempotencyStore } from "../src/idempotency.js";
import { hashInspectionRequest } from "../src/binding.js";
import type { FacilitatorClient } from "@x402/core/server";

const sender = algosdk.generateAccount();
const receiver = algosdk.generateAccount();
const suggestedParams = { fee: 1_000, minFee: 1_000, flatFee: true, firstValid: 1, lastValid: 1_000, genesisHash: Buffer.from("SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=", "base64") };

function requestFor(txn: algosdk.Transaction, policy?: object, headers?: Record<string, string>): Request {
  return requestForGroup([txn], policy, headers);
}

function requestForGroup(transactions: algosdk.Transaction[], policy?: object, headers?: Record<string, string>): Request {
  return new Request("http://localhost/v1/inspect-transaction", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      network: "algorand-testnet",
      unsignedTransactionGroup: Buffer.concat(transactions.map((txn) => Buffer.from(algosdk.encodeUnsignedTransaction(txn)))).toString("base64"),
      ...(policy === undefined ? {} : { policy }),
    }),
  });
}

function supportedTestnetFacilitator(): FacilitatorClient {
  return {
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: GOPLAUSIBLE_ALGORAND_TESTNET_CAIP2 }],
      extensions: [],
      signers: {},
    }),
    verify: async () => { throw new Error("verify should not run without a payment header"); },
    settle: async () => { throw new Error("settle should not run without a payment header"); },
  };
}

describe("MicroVern Stage 1 API", () => {
  it("reports health and advertised unsigned input format", async () => {
    expect((await app.request("/healthz")).status).toBe(200);
    const capabilities = await app.request("/v1/capabilities");
    expect(capabilities.status).toBe(200);
    expect((await capabilities.json()).payment).toEqual({ enabled: false, configured: false });
  });

  it("loads a validated Testnet USDC payment configuration", () => {
    const config = loadTestnetPaymentConfig({ AVM_ADDRESS: receiver.addr.toString(), MICROVERN_ICON_URL: "https://microvern.example/icon.svg" });
    expect(config).toMatchObject({
      network: "algorand-testnet",
      caip2: GOPLAUSIBLE_ALGORAND_TESTNET_CAIP2,
      payTo: receiver.addr.toString(),
      facilitatorUrl: GOPLAUSIBLE_FACILITATOR_URL,
      priceUsd: MICROVERN_TESTNET_PRICE_USD,
      usdcAssetId: "10458941",
      usdcDecimals: 6,
      iconUrl: "https://microvern.example/icon.svg",
    });
  });

  it("requires an explicit confirmation before loading MainNet USDC payment configuration", () => {
    const baseEnvironment = {
      AVM_ADDRESS: receiver.addr.toString(),
      MICROVERN_PAYMENT_NETWORK: "mainnet",
    };
    expect(() => loadPaymentConfig(baseEnvironment)).toThrow("MICROVERN_MAINNET_CONFIRMATION");

    const config = loadPaymentConfig({
      ...baseEnvironment,
      MICROVERN_MAINNET_CONFIRMATION,
    });
    expect(config).toMatchObject({
      network: "algorand-mainnet",
      caip2: GOPLAUSIBLE_ALGORAND_MAINNET_CAIP2,
      usdcAssetId: "31566704",
      usdcDecimals: 6,
    });
  });

  it("accepts only a PostgreSQL URL for the durable idempotency store", () => {
    expect(loadPostgresIdempotencyUrl({})).toBeUndefined();
    expect(() => loadPostgresIdempotencyUrl({ MICROVERN_POSTGRES_URL: "https://database.example" })).toThrow("MICROVERN_POSTGRES_URL");
    expect(loadPostgresIdempotencyUrl({ MICROVERN_POSTGRES_URL: "postgresql://user:password@database.example:5432/microvern" })).toBe("postgresql://user:password@database.example:5432/microvern");
    expect(createIdempotencyStore("postgresql://user:password@database.example:5432/microvern").durable).toBe(true);
  });

  it("atomically reserves, completes, and replays idempotency keys in memory", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.initialize();
    expect(await store.acquire("durable-fixture-key", "a".repeat(64), 60_000)).toEqual({ state: "acquired" });
    expect(await store.acquire("durable-fixture-key", "a".repeat(64), 60_000)).toEqual({ state: "in-progress" });
    await store.complete("durable-fixture-key", { status: 200, body: { verdict: "allow" }, paymentResponse: "receipt" }, 60_000);
    expect(await store.acquire("durable-fixture-key", "a".repeat(64), 60_000)).toEqual({
      state: "completed",
      response: { status: 200, body: { verdict: "allow" }, paymentResponse: "receipt" },
    });
    expect(await store.acquire("durable-fixture-key", "b".repeat(64), 60_000)).toEqual({ state: "conflict" });
  });

  it("requires a receiver address before starting the payment-protected API", () => {
    expect(() => requireTestnetPaymentConfig({})).toThrow("AVM_ADDRESS");
  });

  it("keeps health public and returns a payment requirement only for transaction inspection", async () => {
    const config = requireTestnetPaymentConfig({ AVM_ADDRESS: receiver.addr.toString() });
    const service = createPaymentProtectedService(config, supportedTestnetFacilitator());
    await service.initialize();

    expect((await service.app.request("/healthz")).status).toBe(200);
    expect((await service.app.request("/readyz")).status).toBe(200);
    expect((await service.app.request("/v1/capabilities")).status).toBe(200);
    expect((await service.app.request(requestFor(algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, suggestedParams })))).status).toBe(402);
  });

  it("reports the facilitator capability failure without exposing its error", async () => {
    const config = requireTestnetPaymentConfig({ AVM_ADDRESS: receiver.addr.toString() });
    const unavailableFacilitator: FacilitatorClient = {
      ...supportedTestnetFacilitator(),
      getSupported: async () => { throw new Error("network details must stay internal"); },
    };
    const service = createPaymentProtectedService(config, unavailableFacilitator);
    const response = await service.app.request("/readyz");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not-ready", reason: "facilitator_unavailable" });
  });

  it("rejects invalid Testnet payment configuration", () => {
    expect(() => loadTestnetPaymentConfig({ AVM_ADDRESS: "invalid" })).toThrow("AVM_ADDRESS");
    expect(() => loadTestnetPaymentConfig({ AVM_ADDRESS: receiver.addr.toString(), FACILITATOR_URL: "http://example.test" })).toThrow("FACILITATOR_URL");
    expect(() => loadTestnetPaymentConfig({ AVM_ADDRESS: receiver.addr.toString(), MICROVERN_PRICE_USD: "free" })).toThrow("MICROVERN_PRICE_USD");
    expect(() => loadTestnetPaymentConfig({ AVM_ADDRESS: receiver.addr.toString(), MICROVERN_ICON_URL: "http://example.test/icon.svg" })).toThrow("MICROVERN_ICON_URL");
  });

  it("declares Bazaar discovery metadata with the challenge tag", async () => {
    const config = requireTestnetPaymentConfig({ AVM_ADDRESS: receiver.addr.toString(), MICROVERN_ICON_URL: "https://microvern.example/icon.svg" });
    const service = createPaymentProtectedService(config, supportedTestnetFacilitator());
    await service.initialize();
    const response = await service.app.request(requestFor(algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, suggestedParams })));
    expect(response.status).toBe(402);

    const required = JSON.parse(Buffer.from(response.headers.get("payment-required")!, "base64").toString("utf8"));
    expect(required.accepts[0].extra).toMatchObject({ asset: "10458941", tag: "x402-global-challenge" });
    expect(required.resource).toMatchObject({
      description: expect.stringContaining("unsigned Algorand transaction group"),
      serviceName: "MicroVern",
      tags: ["algorand", "transaction-safety", "x402-global-challenge"],
      iconUrl: "https://microvern.example/icon.svg",
    });
    expect(required.extensions.bazaar.info).toMatchObject({
      input: {
        method: "POST",
        bodyType: "json",
        body: expect.objectContaining({ network: "algorand-testnet" }),
      },
      output: {
        example: expect.objectContaining({
          requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          reportChecksum: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      },
    });
  });

  it("omits Bazaar icon metadata until a real public icon is configured", async () => {
    const config = requireTestnetPaymentConfig({ AVM_ADDRESS: receiver.addr.toString() });
    const service = createPaymentProtectedService(config, supportedTestnetFacilitator());
    await service.initialize();
    const response = await service.app.request(requestFor(algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, suggestedParams })));
    const required = JSON.parse(Buffer.from(response.headers.get("payment-required")!, "base64").toString("utf8"));
    expect(required.resource.iconUrl).toBeUndefined();
  });

  it("returns a fresh 402 for a malformed payment proof without calling the facilitator", async () => {
    const config = requireTestnetPaymentConfig({ AVM_ADDRESS: receiver.addr.toString() });
    const service = createPaymentProtectedService(config, supportedTestnetFacilitator());
    await service.initialize();
    const response = await service.app.request(requestFor(
      algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, suggestedParams }),
      undefined,
      { "payment-signature": "not-a-valid-payment-proof" },
    ));
    expect(response.status).toBe(402);
    expect(response.headers.get("payment-required")).not.toBeNull();
  });

  it("allows a simple ALGO transfer within policy", async () => {
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1_500_000, suggestedParams });
    const response = await app.request(requestFor(txn, { maxAlgoSend: 2 }));
    expect(response.status).toBe(200);
    const report = await response.json();
    expect(report.verdict).toBe("allow");
    expect(report.actions[0].description).toContain("1.5 ALGO");
    expect(report.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.reportChecksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("offers a free bounded structural preflight without returning a report", async () => {
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, suggestedParams });
    const inspection = requestFor(txn);
    const response = await app.request("/v1/validate-transaction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await inspection.text(),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: true });
  });

  it("rejects fields outside the published discovery schema", async () => {
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, suggestedParams });
    const request = requestFor(txn);
    const validBody = await request.json() as Record<string, unknown>;
    const response = await app.request("/v1/validate-transaction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validBody, unexpected: true }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unsupported request field: unexpected." });
  });

  it("rejects malformed base64 and invalid policy boundary values", async () => {
    const validGroup = Buffer.from(algosdk.encodeUnsignedTransaction(algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, suggestedParams }))).toString("base64");
    const invalidBodies = [
      { network: "algorand-testnet", unsignedTransactionGroup: "A===" },
      { network: "algorand-testnet", unsignedTransactionGroup: validGroup, policy: { maxAlgoSend: -0.001 } },
      { network: "algorand-testnet", unsignedTransactionGroup: validGroup, policy: { allowedApplicationIds: [1.5] } },
      { network: "algorand-testnet", unsignedTransactionGroup: validGroup, policy: { unsupportedRule: true } },
    ];
    for (const body of invalidBodies) {
      expect((await app.request("/v1/validate-transaction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })).status).toBe(400);
    }
  });

  it("replays a successful inspection for the same idempotency key without re-analysis", async () => {
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, suggestedParams });
    const headers = { "idempotency-key": "fixture-replay-key" };
    const first = await app.request(requestFor(txn, undefined, headers));
    const second = await app.request(requestFor(txn, undefined, headers));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get("x-idempotent-replay")).toBe("true");
    expect(await second.json()).toEqual(await first.json());
  });

  it("rejects an idempotency key reused for different unsigned transaction data", async () => {
    const headers = { "idempotency-key": "fixture-bound-key" };
    const first = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, suggestedParams });
    const changed = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 2, suggestedParams });
    expect((await app.request(requestFor(first, undefined, headers))).status).toBe(200);
    const response = await app.request(requestFor(changed, undefined, headers));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This Idempotency-Key is already bound to a different inspection request." });
  });

  it("binds request hashes to normalized policy semantics", () => {
    const transaction = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, suggestedParams });
    const group = Buffer.from(algosdk.encodeUnsignedTransaction(transaction)).toString("base64");
    const first = hashInspectionRequest({ network: "algorand-testnet", unsignedTransactionGroup: group, policy: { allowedApplicationIds: [9, 3, 9] } });
    const samePolicy = hashInspectionRequest({ network: "algorand-testnet", unsignedTransactionGroup: group, policy: { allowedApplicationIds: [3, 9] } });
    const changedPolicy = hashInspectionRequest({ network: "algorand-testnet", unsignedTransactionGroup: group, policy: { allowRekey: true, allowedApplicationIds: [3, 9] } });
    expect(first).toBe(samePolicy);
    expect(first).not.toBe(changedPolicy);
  });

  it("rejects an invalid idempotency key before analysis", async () => {
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, suggestedParams });
    const response = await app.request(requestFor(txn, undefined, { "idempotency-key": "short" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Idempotency-Key must contain 8 to 128 URL-safe characters." });
  });

  it("blocks an explicit rekey", async () => {
    const rekeyTarget = algosdk.generateAccount();
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, rekeyTo: rekeyTarget.addr, suggestedParams });
    const response = await app.request(requestFor(txn));
    const report = await response.json();
    expect(report.verdict).toBe("block");
    expect(report.findings.map((finding: { code: string }) => finding.code)).toContain("REKEY_PRESENT");
  });

  it("requires review, rather than blocking, for an explicitly allowed rekey", async () => {
    const rekeyTarget = algosdk.generateAccount();
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, rekeyTo: rekeyTarget.addr, suggestedParams });
    const response = await app.request(requestFor(txn, { allowRekey: true }));
    expect((await response.json()).verdict).toBe("review");
  });

  it("blocks a Testnet USDC limit breach", async () => {
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 200_000_000, assetIndex: 10_458_941, suggestedParams });
    const response = await app.request(requestFor(txn, { maxUsdcSend: 100 }));
    const report = await response.json();
    expect(report.verdict).toBe("block");
    expect(report.findings.map((finding: { code: string }) => finding.code)).toContain("USDC_LIMIT_EXCEEDED");
  });

  it("allows transfers exactly at configured ALGO and Testnet-USDC limits", async () => {
    const algoTransfer = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1_000_000, suggestedParams });
    const usdcTransfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 100_000_000, assetIndex: 10_458_941, suggestedParams });
    const algoReport = await (await app.request(requestFor(algoTransfer, { maxAlgoSend: 1 }))).json();
    const usdcReport = await (await app.request(requestFor(usdcTransfer, { maxUsdcSend: 100 }))).json();
    expect(algoReport.verdict).toBe("allow");
    expect(algoReport.policyEvaluation.maxAlgoSend).toBe("passed");
    expect(usdcReport.verdict).toBe("allow");
    expect(usdcReport.policyEvaluation.maxUsdcSend).toBe("passed");
  });

  it("labels an asset opt-in without treating it as an outgoing transfer", async () => {
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: sender.addr, amount: 0, assetIndex: 99, suggestedParams });
    const response = await app.request(requestFor(txn));
    const report = await response.json();
    expect(report.verdict).toBe("allow");
    expect(report.actions[0].type).toBe("asset-opt-in");
  });

  it("labels a regular ASA transfer and blocks an ALGO account close-out", async () => {
    const assetTransfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 7, assetIndex: 99, suggestedParams });
    const closeOut = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, closeRemainderTo: algosdk.generateAccount().addr, suggestedParams });
    algosdk.assignGroupID([assetTransfer, closeOut]);
    const report = await (await app.request(requestForGroup([assetTransfer, closeOut]))).json();
    expect(report.verdict).toBe("block");
    expect(report.actions.map((action: { type: string }) => action.type)).toContain("asset-transfer");
    expect(report.findings.map((finding: { code: string }) => finding.code)).toContain("ALGO_CLOSE_OUT");
  });

  it("labels an asset close-out as an opt-out and blocks it by default", async () => {
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, assetIndex: 99, closeRemainderTo: algosdk.generateAccount().addr, suggestedParams });
    const report = await (await app.request(requestFor(txn))).json();
    expect(report.verdict).toBe("block");
    expect(report.actions[0].type).toBe("asset-opt-out");
    expect(report.findings.map((finding: { code: string }) => finding.code)).toContain("ASSET_CLOSE_OUT");
  });

  it("requires review for a clawback transfer and asset-freeze action", async () => {
    const clawback = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, assetSender: algosdk.generateAccount().addr, amount: 1, assetIndex: 99, suggestedParams });
    const freeze = algosdk.makeAssetFreezeTxnWithSuggestedParamsFromObject({ sender: sender.addr, freezeTarget: receiver.addr, frozen: true, assetIndex: 99, suggestedParams });
    algosdk.assignGroupID([clawback, freeze]);
    const report = await (await app.request(requestForGroup([clawback, freeze]))).json();
    expect(report.verdict).toBe("review");
    expect(report.findings.map((finding: { code: string }) => finding.code)).toEqual(expect.arrayContaining(["ASSET_CLAWBACK", "ASSET_FREEZE"]));
  });

  it("explains application completion and safely displayable arguments", async () => {
    const txn = algosdk.makeApplicationCallTxnFromObject({ sender: sender.addr, appIndex: 12345, onComplete: algosdk.OnApplicationComplete.OptInOC, appArgs: [new TextEncoder().encode("swap"), Uint8Array.from([0, 1])], suggestedParams });
    const report = await (await app.request(requestFor(txn, { allowedApplicationIds: [12345] }))).json();
    expect(report.verdict).toBe("allow");
    expect(report.actions[0].description).toContain("OptIn");
    expect(report.actions[0].description).toContain('"swap"');
    expect(report.actions[0].description).toContain("opaque value");
  });

  it("requires review for asset creation and application administration", async () => {
    const assetCreate = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({ sender: sender.addr, total: 1_000, decimals: 0, assetName: "Test", unitName: "TST", suggestedParams });
    const appDelete = algosdk.makeApplicationCallTxnFromObject({ sender: sender.addr, appIndex: 12345, onComplete: algosdk.OnApplicationComplete.DeleteApplicationOC, suggestedParams });
    algosdk.assignGroupID([assetCreate, appDelete]);
    const report = await (await app.request(requestForGroup([assetCreate, appDelete], { allowedApplicationIds: [12345] }))).json();
    expect(report.verdict).toBe("review");
    expect(report.findings.map((finding: { code: string }) => finding.code)).toEqual(expect.arrayContaining(["ASSET_CREATE", "APPLICATION_ADMIN_ACTION"]));
  });

  it("requires review for an existing asset's administrative configuration", async () => {
    const txn = algosdk.makeAssetConfigTxnWithSuggestedParamsFromObject({ sender: sender.addr, assetIndex: 99, manager: sender.addr, reserve: receiver.addr, freeze: sender.addr, clawback: receiver.addr, suggestedParams });
    const report = await (await app.request(requestFor(txn))).json();
    expect(report.verdict).toBe("review");
    expect(report.actions[0].type).toBe("asset-configuration");
    expect(report.findings.map((finding: { code: string }) => finding.code)).toContain("ASSET_CONFIGURATION");
  });

  it("sums a grouped pair of ALGO transfers against the group policy limit", async () => {
    const first = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 600_000, suggestedParams });
    const second = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 600_000, suggestedParams });
    algosdk.assignGroupID([first, second]);
    const response = await app.request(requestForGroup([first, second], { maxAlgoSend: 1 }));
    const report = await response.json();
    expect(report.verdict).toBe("block");
    expect(report.actions).toHaveLength(2);
  });

  it("accepts a 16-transaction group and rejects a 17-transaction group", async () => {
    const groupOf16 = Array.from({ length: 16 }, () => algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 0, suggestedParams }));
    algosdk.assignGroupID(groupOf16);
    expect((await app.request(requestForGroup(groupOf16))).status).toBe(200);

    const groupOf17 = Array.from({ length: 17 }, () => algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 0, suggestedParams }));
    expect((await app.request(requestForGroup(groupOf17))).status).toBe(400);
  });

  it("rejects a multi-transaction input without one shared Algorand group ID", async () => {
    const first = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, suggestedParams });
    const second = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, suggestedParams });
    expect((await app.request(requestForGroup([first, second]))).status).toBe(400);
  });

  it("rejects malformed input without attempting analysis", async () => {
    const response = await app.request("/v1/inspect-transaction", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ network: "algorand-testnet", unsignedTransactionGroup: "not base64!" }) });
    expect(response.status).toBe(400);
  });

  it("rejects a signed transaction blob", async () => {
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: sender.addr, receiver: receiver.addr, amount: 1, suggestedParams });
    const response = await app.request("/v1/inspect-transaction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ network: "algorand-testnet", unsignedTransactionGroup: Buffer.from(txn.signTxn(sender.sk)).toString("base64") }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects an oversized encoded transaction group before analysis", async () => {
    const response = await app.request("/v1/inspect-transaction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ network: "algorand-testnet", unsignedTransactionGroup: Buffer.alloc(65_537).toString("base64") }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects an oversized HTTP request before payment middleware", async () => {
    const response = await app.request("/v1/inspect-transaction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ network: "algorand-testnet", padding: "x".repeat(131_072) }),
    });
    expect(response.status).toBe(413);
  });

  it("throttles repeated unpaid inspection requests without recording payloads", async () => {
    const headers = { "content-type": "application/json", "x-forwarded-for": "fixture-throttle-client" };
    let response: Response | undefined;
    for (let index = 0; index <= 30; index += 1) {
      response = await app.request("/v1/inspect-transaction", {
        method: "POST",
        headers,
        body: JSON.stringify({ network: "algorand-testnet", unsignedTransactionGroup: "not-base64" }),
      });
    }
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).not.toBeNull();
  });
});
