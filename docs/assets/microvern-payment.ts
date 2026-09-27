import { PeraWalletConnect } from "@perawallet/connect";
import { AlgorandClient } from "@algorandfoundation/algokit-utils/algorand-client";
import { decodeUnsignedTransaction } from "algosdk";
import { ExactAvmScheme } from "@x402/avm/exact/client";
import type { ClientAvmSigner } from "@x402/avm";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import {
  isMicrovernTestnetBrowserOrigin,
  MICROVERN_TESTNET_CAIP2,
  sameCappedTestnetPaymentRequirement,
  selectCappedTestnetPaymentRequirement,
  type BrowserPaymentRequirement,
} from "../../src/browser-payment-policy.js";

interface InspectionRequest {
  readonly network: "algorand-mainnet" | "algorand-testnet";
  readonly unsignedTransactionGroup: string;
  readonly policy?: Record<string, unknown>;
}

interface PaymentRequired {
  readonly error?: string;
  readonly accepts?: readonly BrowserPaymentRequirement[];
}

interface InspectionReport {
  readonly verdict: "allow" | "review" | "block";
  readonly requestHash: string;
  readonly reportChecksum: string;
}

// AlgoKit's default is only 10 rounds. That is too short for a user who must
// unlock a Ledger-backed Pera wallet, review the payment, and approve it.
// The payment remains an atomic TestNet-only x402 group and still expires.
export const TESTNET_PAYMENT_VALIDITY_ROUNDS = 120;

export interface BrowserPaidInspectionResult {
  readonly report: InspectionReport;
  readonly paymentTransactionId: string;
  readonly payerAddress: string;
}

function decodePaymentRequired(value: string | null): PaymentRequired {
  if (value === null) throw new Error("The service did not provide x402 payment requirements.");
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))) as PaymentRequired;
  } catch {
    throw new Error("The service returned unreadable x402 payment requirements.");
  }
}

export function responseError(body: unknown, status: number, headers?: Headers): Error {
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
    return new Error(body.error);
  }
  if (status === 402 && headers !== undefined) {
    try {
      const reason = decodePaymentRequired(headers.get("payment-required")).error;
      if (reason !== undefined && reason.trim().length > 0) {
        return new Error(`Payment was not accepted: ${reason}. No new payment was settled.`);
      }
    } catch {
      // Keep the generic HTTP status below when an intermediary omits or
      // corrupts the optional diagnostic header.
    }
  }
  return new Error(`Paid inspection returned HTTP ${status}.`);
}

function createPeraSigner(wallet: PeraWalletConnect, address: string): ClientAvmSigner {
  return {
    address,
    signTransactions: async (transactions, indexesToSign) => {
      const requested = transactions.map((transaction, index) => ({
        // x402 supplies encoded bytes; Pera requires the SDK Transaction object
        // so it can apply Algorand's canonical message-pack encoding.
        txn: decodeUnsignedTransaction(transaction),
        signers: indexesToSign !== undefined && !indexesToSign.includes(index) ? [] : [address],
      }));
      const signed = await wallet.signTransaction([requested]);
      let signedIndex = 0;
      return transactions.map((_, index) => {
        if (indexesToSign !== undefined && !indexesToSign.includes(index)) return null;
        const next = signed[signedIndex];
        signedIndex += 1;
        if (next === undefined) throw new Error("Pera did not return every required payment signature.");
        return next;
      });
    },
  };
}

async function restoreOrConnectTestnetSession(wallet: PeraWalletConnect, forceNewPairing: boolean): Promise<string> {
  if (forceNewPairing) {
    // This affects only the saved WalletConnect pairing for this browser. It
    // never touches the wallet, keys, assets, or an on-chain transaction.
    await wallet.reconnectSession().catch(() => [] as string[]);
    await wallet.disconnect().catch(() => undefined);
    const address = (await wallet.connect())[0];
    if (address === undefined) throw new Error("Pera did not provide an account to use for the TestNet payment.");
    return address;
  }

  // A QR scan can establish the WalletConnect session before this browser page
  // receives the account callback. Restore that session first so a second click
  // proceeds to the signing request instead of asking Pera to create it again.
  const restored = await wallet.reconnectSession().catch(() => [] as string[]);
  const accounts = restored.length > 0
    ? restored
    : await wallet.connect().catch(async (error) => {
      const recovered = await wallet.reconnectSession().catch(() => [] as string[]);
      if (recovered.length > 0) return recovered;
      throw error;
    });
  const address = accounts[0];
  if (address === undefined) throw new Error("Pera did not provide an account to use for the TestNet payment.");
  return address;
}

export async function payForMicrovernTestnetInspection(
  serviceUrl: string,
  request: InspectionRequest,
  displayedQuote: PaymentRequired,
  forceNewPairing = false,
): Promise<BrowserPaidInspectionResult> {
  if (!isMicrovernTestnetBrowserOrigin(serviceUrl)) {
    throw new Error("Browser wallet payment is available only for MicroVern's pinned TestNet service.");
  }
  if (request.network !== "algorand-testnet") {
    throw new Error("Browser wallet payment is TestNet-only. Select Algorand TestNet before continuing.");
  }

  const displayedRequirement = selectCappedTestnetPaymentRequirement(displayedQuote.accepts);
  const wallet = new PeraWalletConnect({ chainId: 416002, compactMode: true });
  const address = await restoreOrConnectTestnetSession(wallet, forceNewPairing);

  const signer = createPeraSigner(wallet, address);
  const algorandClient = AlgorandClient.testNet()
    .setDefaultValidityWindow(TESTNET_PAYMENT_VALIDITY_ROUNDS);
  const client = new x402Client()
    .register(MICROVERN_TESTNET_CAIP2, new ExactAvmScheme(signer, { algorandClient }));
  client.registerPolicy((_version, requirements) => requirements.filter((requirement) => {
    try {
      return sameCappedTestnetPaymentRequirement(
        displayedRequirement,
        selectCappedTestnetPaymentRequirement([requirement]),
      );
    } catch {
      return false;
    }
  }));

  const guardedFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (response.status === 402) {
      const freshRequirement = selectCappedTestnetPaymentRequirement(
        decodePaymentRequired(response.headers.get("payment-required")).accepts,
      );
      if (!sameCappedTestnetPaymentRequirement(displayedRequirement, freshRequirement)) {
        throw new Error("The payment terms changed after the quote. No payment was signed; retrieve a new quote.");
      }
    }
    return response;
  };
  const paymentFetch = wrapFetchWithPayment(guardedFetch, client);
  const response = await paymentFetch(new URL("/v1/inspect-transaction", serviceUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID().replaceAll("-", ""),
    },
    body: JSON.stringify(request),
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw responseError(body, response.status, response.headers);
  if (
    typeof body !== "object" || body === null
    || !("verdict" in body) || !("requestHash" in body) || !("reportChecksum" in body)
  ) throw new Error("MicroVern returned an invalid paid inspection report.");

  const receiptHeader = response.headers.get("payment-response");
  if (receiptHeader === null) throw new Error("MicroVern returned a report without an x402 settlement receipt.");
  const receipt = decodePaymentResponseHeader(receiptHeader);
  if (typeof receipt.transaction !== "string" || receipt.transaction.length === 0) {
    throw new Error("MicroVern returned an x402 receipt without a settlement transaction ID.");
  }
  return {
    report: body as InspectionReport,
    paymentTransactionId: receipt.transaction,
    payerAddress: address,
  };
}
