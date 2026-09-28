import { PeraWalletConnect } from "@perawallet/connect";
import { AlgorandClient } from "@algorandfoundation/algokit-utils/algorand-client";
import { decodeUnsignedTransaction } from "algosdk";
import { ExactAvmScheme } from "@x402/avm/exact/client";
import type { ClientAvmSigner } from "@x402/avm";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import {
  isMicrovernMainnetBrowserOrigin,
  isMicrovernTestnetBrowserOrigin,
  MICROVERN_MAINNET_CAIP2,
  MICROVERN_TESTNET_CAIP2,
  sameCappedPaymentRequirement,
  sameCappedTestnetPaymentRequirement,
  selectCappedMainnetPaymentRequirement,
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
export const MAINNET_PAYMENT_VALIDITY_ROUNDS = 120;
const TESTNET_USDC_ASSET_ID = 10_458_941n;
const TESTNET_PAYMENT_AMOUNT = 10_000n;
const MAINNET_USDC_ASSET_ID = 31_566_704n;
const MAINNET_PAYMENT_AMOUNT = 10_000n;

export interface BrowserPaidInspectionResult {
  readonly report: InspectionReport;
  readonly paymentTransactionId: string;
  readonly payerAddress: string;
  readonly bazaarDiscovery: BazaarDiscoveryOutcome;
}

export interface BazaarDiscoveryOutcome {
  readonly status: "success" | "processing" | "rejected" | "not-reported" | "malformed";
  readonly rejectedReason?: string;
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

export function decodeBazaarDiscoveryOutcome(value: string | null): BazaarDiscoveryOutcome {
  if (value === null || value.trim() === "") return { status: "not-reported" };
  try {
    const normalized = value.trim().replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
    const decoded: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))));
    if (typeof decoded !== "object" || decoded === null || !("bazaar" in decoded)) return { status: "malformed" };
    const bazaar = decoded.bazaar;
    if (typeof bazaar !== "object" || bazaar === null || !("status" in bazaar)) return { status: "malformed" };
    const status = bazaar.status;
    if (status !== "success" && status !== "processing" && status !== "rejected") return { status: "malformed" };
    const rejectedReason = "rejectedReason" in bazaar ? bazaar.rejectedReason : undefined;
    return typeof rejectedReason === "string" ? { status, rejectedReason } : { status };
  } catch {
    return { status: "malformed" };
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

export function payerReadinessError(
  address: string,
  state: "not-opted-in" | "insufficient-balance" | "unavailable",
): Error {
  if (state === "not-opted-in") {
    return new Error(
      `Pera selected ${address}, but it is not opted into TestNet USDC (ASA 10458941). `
      + "Switch Pera to the TestNet-funded account, then choose ‘Pair Pera again (show QR)’. No payment was signed.",
    );
  }
  if (state === "insufficient-balance") {
    return new Error(
      `Pera selected ${address}, but it has less than $0.01 TestNet USDC (10,000 units). `
      + "Choose or fund a TestNet USDC account, then try again. No payment was signed.",
    );
  }
  return new Error(
    `MicroVern could not verify whether Pera account ${address} can pay TestNet USDC. `
    + "No payment was signed; check the network connection and try again.",
  );
}

async function requireReadyTestnetUsdcPayer(algorandClient: AlgorandClient, address: string): Promise<void> {
  try {
    const holding = await algorandClient.asset.getAccountInformation(address, TESTNET_USDC_ASSET_ID);
    if (holding.balance < TESTNET_PAYMENT_AMOUNT) throw payerReadinessError(address, "insufficient-balance");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Pera selected")) throw error;
    const detail = error instanceof Error ? error.message : "";
    if (/\b404\b|not found|missing asset|asset.*missing/iu.test(detail)) {
      throw payerReadinessError(address, "not-opted-in");
    }
    throw payerReadinessError(address, "unavailable");
  }
}

function mainnetPayerReadinessError(
  address: string,
  state: "not-opted-in" | "insufficient-balance" | "unavailable",
): Error {
  if (state === "not-opted-in") {
    return new Error(
      `Pera selected ${address}, but it is not opted into MainNet USDC (ASA 31566704). `
      + "Opt in through Pera first, then retrieve a new quote. No payment was signed.",
    );
  }
  if (state === "insufficient-balance") {
    return new Error(
      `Pera selected ${address}, but it has less than $0.01 MainNet USDC (10,000 units). `
      + "Choose or fund a MainNet USDC account, then retrieve a new quote. No payment was signed.",
    );
  }
  return new Error(
    `MicroVern could not verify whether Pera account ${address} can pay MainNet USDC. `
    + "No payment was signed; check the MainNet connection and try again.",
  );
}

async function requireReadyMainnetUsdcPayer(algorandClient: AlgorandClient, address: string): Promise<void> {
  try {
    const holding = await algorandClient.asset.getAccountInformation(address, MAINNET_USDC_ASSET_ID);
    if (holding.balance < MAINNET_PAYMENT_AMOUNT) throw mainnetPayerReadinessError(address, "insufficient-balance");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Pera selected")) throw error;
    const detail = error instanceof Error ? error.message : "";
    if (/\b404\b|not found|missing asset|asset.*missing/iu.test(detail)) {
      throw mainnetPayerReadinessError(address, "not-opted-in");
    }
    throw mainnetPayerReadinessError(address, "unavailable");
  }
}

async function restoreOrConnectPeraSession(wallet: PeraWalletConnect, forceNewPairing: boolean, networkName: string): Promise<string> {
  if (forceNewPairing) {
    // This affects only the saved WalletConnect pairing for this browser. It
    // never touches the wallet, keys, assets, or an on-chain transaction.
    await wallet.reconnectSession().catch(() => [] as string[]);
    await wallet.disconnect().catch(() => undefined);
    const address = (await wallet.connect())[0];
    if (address === undefined) throw new Error(`Pera did not provide an account to use for the ${networkName} payment.`);
    return address;
  }

  // A QR scan can establish the WalletConnect session before this browser page
  // receives the account callback. Restore that session first so a second click
  // proceeds to the signing request instead of asking Pera to create it again.
  const restored = await wallet.reconnectSession().catch(() => [] as string[]);
  const accounts = restored.length > 0
    ? restored
    : await wallet.connect().catch(async (error: unknown) => {
      const recovered = await wallet.reconnectSession().catch(() => [] as string[]);
      if (recovered.length > 0) return recovered;
      throw error;
    });
  const address = accounts[0];
  if (address === undefined) throw new Error(`Pera did not provide an account to use for the ${networkName} payment.`);
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
  const address = await restoreOrConnectPeraSession(wallet, forceNewPairing, "TestNet");

  const signer = createPeraSigner(wallet, address);
  const algorandClient = AlgorandClient.testNet()
    .setDefaultValidityWindow(TESTNET_PAYMENT_VALIDITY_ROUNDS);
  await requireReadyTestnetUsdcPayer(algorandClient, address);
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
    redirect: "error",
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
    bazaarDiscovery: decodeBazaarDiscoveryOutcome(response.headers.get("extension-responses")),
  };
}

/**
 * A deliberately narrow MainNet path for the operator's one-time Bazaar
 * cataloging check. It is not a general-purpose MainNet browser payment API.
 */
export async function payForMicrovernMainnetBazaarInspection(
  serviceUrl: string,
  request: InspectionRequest,
  displayedQuote: PaymentRequired,
): Promise<BrowserPaidInspectionResult> {
  if (!isMicrovernMainnetBrowserOrigin(serviceUrl)) {
    throw new Error("MainNet browser payment is available only for MicroVern's pinned MainNet service.");
  }
  if (request.network !== "algorand-mainnet") {
    throw new Error("This one-time cataloging payment requires an Algorand MainNet inspection request.");
  }

  const displayedRequirement = selectCappedMainnetPaymentRequirement(displayedQuote.accepts);
  // Always start a fresh MainNet WalletConnect pairing. This prevents a prior
  // TestNet pairing in this browser from being silently reused for this action.
  const wallet = new PeraWalletConnect({ chainId: 416001, compactMode: true });
  const address = await restoreOrConnectPeraSession(wallet, true, "MainNet");
  const signer = createPeraSigner(wallet, address);
  const algorandClient = AlgorandClient.mainNet()
    .setDefaultValidityWindow(MAINNET_PAYMENT_VALIDITY_ROUNDS);
  await requireReadyMainnetUsdcPayer(algorandClient, address);
  const client = new x402Client()
    .register(MICROVERN_MAINNET_CAIP2, new ExactAvmScheme(signer, { algorandClient }));
  client.registerPolicy((_version, requirements) => requirements.filter((requirement) => {
    try {
      return sameCappedPaymentRequirement(
        displayedRequirement,
        selectCappedMainnetPaymentRequirement([requirement]),
      );
    } catch {
      return false;
    }
  }));

  const guardedFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, { ...init, redirect: "error" });
    if (response.status === 402) {
      const freshRequirement = selectCappedMainnetPaymentRequirement(
        decodePaymentRequired(response.headers.get("payment-required")).accepts,
      );
      if (!sameCappedPaymentRequirement(displayedRequirement, freshRequirement)) {
        throw new Error("The payment terms changed after the quote. No payment was signed; retrieve and review a new quote.");
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
    redirect: "error",
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
    bazaarDiscovery: decodeBazaarDiscoveryOutcome(response.headers.get("extension-responses")),
  };
}
