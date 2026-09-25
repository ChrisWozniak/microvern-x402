import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";
import algosdk from "algosdk";
import { ALGORAND_MAINNET_GENESIS_HASH, USDC_MAINNET_ASA_ID } from "@x402/avm";

const MAINNET_CAIP2 = `algorand:${ALGORAND_MAINNET_GENESIS_HASH}`;

function requireHttpsServiceUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("MICROVERN_URL must be an HTTPS URL.");
  return url;
}

export function createHarmlessMainnetInspectionRequest(): {
  network: "algorand-mainnet";
  unsignedTransactionGroup: string;
  policy: { maxAlgoSend: number; allowRekey: boolean; allowCloseOut: boolean };
} {
  const account = algosdk.generateAccount();
  const transaction = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: account.addr,
    receiver: account.addr,
    amount: 0,
    suggestedParams: {
      fee: 1_000,
      minFee: 1_000,
      flatFee: true,
      firstValid: 1,
      lastValid: 1_000,
      genesisHash: Buffer.from(ALGORAND_MAINNET_GENESIS_HASH, "base64"),
    },
  });
  return {
    network: "algorand-mainnet",
    unsignedTransactionGroup: Buffer.from(algosdk.encodeUnsignedTransaction(transaction)).toString("base64"),
    policy: { maxAlgoSend: 1, allowRekey: false, allowCloseOut: false },
  };
}

function decodePaymentRequired(value: string | null): {
  accepts?: Array<{ scheme?: string; network?: string; payTo?: string; extra?: { asset?: string; tag?: string } }>;
  extensions?: { bazaar?: { info?: { body?: { method?: string } } } };
} {
  if (value === null) throw new Error("Expected a Payment-Required header on the 402 response.");
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as ReturnType<typeof decodePaymentRequired>;
  } catch {
    throw new Error("Payment-Required was not valid base64 JSON.");
  }
}

export async function verifyMainnetPreflight(
  serviceUrl: string,
  request: typeof fetch = globalThis.fetch,
): Promise<{
  healthStatus: number;
  readyStatus: number;
  quoteStatus: number;
  network: string;
  usdcAssetId: string;
  tag: string;
  payTo: string;
}> {
  const baseUrl = requireHttpsServiceUrl(serviceUrl);
  const health = await request(new URL("/healthz", baseUrl));
  if (health.status !== 200) throw new Error(`/healthz expected 200, received ${health.status}.`);

  const ready = await request(new URL("/readyz", baseUrl));
  if (ready.status !== 200) throw new Error(`/readyz expected 200, received ${ready.status}.`);
  const readyBody = await ready.json() as { network?: string; scheme?: string };
  if (readyBody.network !== "algorand-mainnet" || readyBody.scheme !== "exact") {
    throw new Error("/readyz did not confirm Algorand MainNet exact payments.");
  }

  const quote = await request(new URL("/v1/inspect-transaction", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "mainnet-preflight-check" },
    body: JSON.stringify(createHarmlessMainnetInspectionRequest()),
  });
  if (quote.status !== 402) throw new Error(`/v1/inspect-transaction expected 402 without payment, received ${quote.status}.`);

  const paymentRequired = decodePaymentRequired(quote.headers.get("payment-required"));
  const payment = paymentRequired.accepts?.find((entry) => (
    entry.scheme === "exact"
    && entry.network === MAINNET_CAIP2
    && entry.extra?.asset === USDC_MAINNET_ASA_ID
    && entry.extra?.tag === "x402-global-challenge"
  ));
  if (payment?.network === undefined || payment.extra?.asset === undefined || payment.extra.tag === undefined || payment.payTo === undefined) {
    throw new Error("402 did not advertise the required MainNet USDC x402 payment metadata.");
  }
  if (paymentRequired.extensions?.bazaar?.info?.body?.method !== "POST") {
    throw new Error("402 did not include Bazaar metadata for the POST inspection endpoint.");
  }

  return {
    healthStatus: health.status,
    readyStatus: ready.status,
    quoteStatus: quote.status,
    network: payment.network,
    usdcAssetId: payment.extra.asset,
    tag: payment.extra.tag,
    payTo: payment.payTo,
  };
}

async function main(): Promise<void> {
  const serviceUrl = process.env.MICROVERN_URL;
  if (serviceUrl === undefined) throw new Error("Set MICROVERN_URL to the deployed MainNet HTTPS service URL.");
  const result = await verifyMainnetPreflight(serviceUrl);
  console.log(JSON.stringify(result, null, 2));
  console.log("MainNet preflight passed. No payment was made.");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "MainNet preflight failed.");
    process.exitCode = 1;
  });
}
