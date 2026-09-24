import { ExactAvmScheme } from "@x402/avm/exact/client";
import type { ClientAvmSigner } from "@x402/avm";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import algosdk from "algosdk";
import {
  GOPLAUSIBLE_ALGORAND_TESTNET_CAIP2,
  MICROVERN_TESTNET_PRICE_USD,
} from "./config.js";

const TESTNET_USDC_ASSET_ID = "10458941";
const MAX_PAYMENT_USDC_ATOMIC = 10_000n;

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export function createTestnetSigner(privateKeyBase64: string): ClientAvmSigner {
  const secretKey = new Uint8Array(Buffer.from(privateKeyBase64, "base64"));
  if (secretKey.length !== 64) {
    throw new Error("AVM_PRIVATE_KEY must be a base64-encoded 64-byte Algorand private key.");
  }

  return {
    address: algosdk.encodeAddress(secretKey.slice(32)),
    signTransactions: async (transactions, indexesToSign) => transactions.map((transaction, index) => {
      if (indexesToSign !== undefined && !indexesToSign.includes(index)) return null;
      return algosdk.signTransaction(algosdk.decodeUnsignedTransaction(transaction), secretKey).blob;
    }),
  };
}

export function createCappedTestnetPaymentFetch(privateKeyBase64: string): typeof fetch {
  const client = new x402Client()
    .register(GOPLAUSIBLE_ALGORAND_TESTNET_CAIP2, new ExactAvmScheme(createTestnetSigner(privateKeyBase64)));

  client.registerPolicy((_version, requirements) => requirements.filter((requirement) => (
    requirement.scheme === "exact"
    && requirement.network === GOPLAUSIBLE_ALGORAND_TESTNET_CAIP2
    && requirement.asset === TESTNET_USDC_ASSET_ID
    && BigInt(requirement.amount ?? "0") <= MAX_PAYMENT_USDC_ATOMIC
  )));

  return wrapFetchWithPayment(fetch, client);
}

async function main(): Promise<void> {
  const paymentFetch = createCappedTestnetPaymentFetch(requiredEnvironmentValue("AVM_PRIVATE_KEY"));
  const apiUrl = new URL("/v1/inspect-transaction", process.env.MICROVERN_URL ?? "http://127.0.0.1:4021");
  const response = await paymentFetch(apiUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      network: "algorand-testnet",
      unsignedTransactionGroup: requiredEnvironmentValue("MICROVERN_UNSIGNED_TRANSACTION_GROUP"),
    }),
  });

  if (!response.ok) {
    throw new Error(`MicroVern returned ${response.status} ${response.statusText}.`);
  }

  const paymentResponse = response.headers.get("payment-response");
  if (paymentResponse === null) {
    throw new Error("MicroVern returned success without an x402 payment receipt.");
  }

  const receipt = decodePaymentResponseHeader(paymentResponse);
  console.log(JSON.stringify({
    paid: MICROVERN_TESTNET_PRICE_USD,
    transaction: receipt.transaction,
    report: await response.json(),
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Paid inspection failed.");
  process.exitCode = 1;
});
