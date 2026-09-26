import { PeraWalletConnect } from "@perawallet/connect";
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
  readonly accepts?: readonly BrowserPaymentRequirement[];
}

interface InspectionReport {
  readonly verdict: "allow" | "review" | "block";
  readonly requestHash: string;
  readonly reportChecksum: string;
}

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

function responseError(body: unknown, status: number): Error {
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
    return new Error(body.error);
  }
  return new Error(`Paid inspection returned HTTP ${status}.`);
}

function createPeraSigner(wallet: PeraWalletConnect, address: string): ClientAvmSigner {
  return {
    address,
    signTransactions: async (transactions, indexesToSign) => {
      const requested = transactions.map((transaction, index) => ({
        txn: transaction,
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

export async function payForMicrovernTestnetInspection(
  serviceUrl: string,
  request: InspectionRequest,
  displayedQuote: PaymentRequired,
): Promise<BrowserPaidInspectionResult> {
  if (!isMicrovernTestnetBrowserOrigin(serviceUrl)) {
    throw new Error("Browser wallet payment is available only for MicroVern's pinned TestNet service.");
  }
  if (request.network !== "algorand-testnet") {
    throw new Error("Browser wallet payment is TestNet-only. Select Algorand TestNet before continuing.");
  }

  const displayedRequirement = selectCappedTestnetPaymentRequirement(displayedQuote.accepts);
  const wallet = new PeraWalletConnect({ chainId: 416002, compactMode: true });
  const accounts = await wallet.connect();
  const address = accounts[0];
  if (address === undefined) throw new Error("Pera did not provide an account to use for the TestNet payment.");

  const signer = createPeraSigner(wallet, address);
  const client = new x402Client()
    .register(MICROVERN_TESTNET_CAIP2, new ExactAvmScheme(signer));
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
  if (!response.ok) throw responseError(body, response.status);
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
