import {
  ALGORAND_MAINNET_GENESIS_HASH,
  ALGORAND_TESTNET_GENESIS_HASH,
  USDC_DECIMALS,
  USDC_MAINNET_ASA_ID,
  USDC_TESTNET_ASA_ID,
  isValidAlgorandAddress,
} from "@x402/avm";

export const GOPLAUSIBLE_FACILITATOR_URL = "https://facilitator.goplausible.xyz";
// GoPlausible advertises full Algorand genesis hashes in /supported.
export const GOPLAUSIBLE_ALGORAND_MAINNET_CAIP2: `algorand:${string}` = `algorand:${ALGORAND_MAINNET_GENESIS_HASH}`;
export const GOPLAUSIBLE_ALGORAND_TESTNET_CAIP2: `algorand:${string}` = `algorand:${ALGORAND_TESTNET_GENESIS_HASH}`;
export const MICROVERN_MAINNET_PRICE_USD = "$0.01";
export const MICROVERN_TESTNET_PRICE_USD = "$0.01";
export const MICROVERN_MAINNET_CONFIRMATION = "ENABLE_MAINNET_PAYMENTS";

export type MicrovernPaymentNetwork = "algorand-mainnet" | "algorand-testnet";

function optionalHttpsBaseUrl(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
    return parsed.toString();
  } catch {
    throw new Error(`${name} must be a valid HTTPS Algod base URL without credentials, query, or fragment.`);
  }
}

/**
 * Optional read-only Algod endpoints for caller-approved public account-state
 * observations. No default is used: production operators pin their provider.
 */
export function loadAlgodObserverUrls(environment: NodeJS.ProcessEnv = process.env): Partial<Record<MicrovernPaymentNetwork, string>> {
  const mainnet = optionalHttpsBaseUrl(environment.MICROVERN_ALGOD_MAINNET_URL, "MICROVERN_ALGOD_MAINNET_URL");
  const testnet = optionalHttpsBaseUrl(environment.MICROVERN_ALGOD_TESTNET_URL, "MICROVERN_ALGOD_TESTNET_URL");
  return {
    ...(mainnet === undefined ? {} : { "algorand-mainnet": mainnet }),
    ...(testnet === undefined ? {} : { "algorand-testnet": testnet }),
  };
}

export interface PaymentConfig {
  readonly network: MicrovernPaymentNetwork;
  readonly caip2: `${string}:${string}`;
  readonly payTo: string;
  readonly facilitatorUrl: string;
  readonly priceUsd: string;
  readonly usdcAssetId: typeof USDC_MAINNET_ASA_ID | typeof USDC_TESTNET_ASA_ID;
  readonly usdcDecimals: typeof USDC_DECIMALS;
  /** Optional until the service has a public HTTPS-hosted icon. */
  readonly iconUrl?: string;
  /** Canonical public HTTPS origin used in Bazaar's discoverable resource URL. */
  readonly publicBaseUrl?: string;
}

function requiredPrice(value: string): string {
  if (!/^\$\d+(?:\.\d{1,6})?$/.test(value) || Number(value.slice(1)) <= 0) {
    throw new Error("MICROVERN_PRICE_USD must be a positive USD string such as $0.01.");
  }
  return value;
}

function optionalHttpsUrl(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:") throw new Error();
    return parsed.toString();
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL.`);
  }
}

function optionalHttpsOrigin(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (
      parsed.protocol !== "https:"
      || parsed.username.length !== 0
      || parsed.password.length !== 0
      || parsed.pathname !== "/"
      || parsed.search.length !== 0
      || parsed.hash.length !== 0
    ) {
      throw new Error();
    }
    return parsed.origin;
  } catch {
    throw new Error(`${name} must be a valid HTTPS origin without a path, query, fragment, or credentials.`);
  }
}

function paymentNetwork(environment: NodeJS.ProcessEnv): MicrovernPaymentNetwork {
  const value = environment.MICROVERN_PAYMENT_NETWORK?.trim().toLowerCase() || "testnet";
  if (value === "testnet" || value === "algorand-testnet") return "algorand-testnet";
  if (value === "mainnet" || value === "algorand-mainnet") return "algorand-mainnet";
  throw new Error("MICROVERN_PAYMENT_NETWORK must be either testnet or mainnet.");
}

export function loadPostgresIdempotencyUrl(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = environment.MICROVERN_POSTGRES_URL?.trim();
  if (value === undefined || value.length === 0) return undefined;
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") || parsed.hostname.length === 0) throw new Error();
    return value;
  } catch {
    throw new Error("MICROVERN_POSTGRES_URL must be a valid postgres:// or postgresql:// connection URL.");
  }
}

export function loadPaymentConfig(environment: NodeJS.ProcessEnv = process.env): PaymentConfig | undefined {
  const payTo = environment.AVM_ADDRESS?.trim();
  if (payTo === undefined || payTo.length === 0) return undefined;
  if (!isValidAlgorandAddress(payTo)) throw new Error("AVM_ADDRESS must be a valid Algorand address.");

  const network = paymentNetwork(environment);
  if (
    network === "algorand-mainnet"
    && environment.MICROVERN_MAINNET_CONFIRMATION?.trim() !== MICROVERN_MAINNET_CONFIRMATION
  ) {
    throw new Error(`MICROVERN_MAINNET_CONFIRMATION must equal ${MICROVERN_MAINNET_CONFIRMATION} before MainNet payments can be configured.`);
  }

  const facilitatorUrl = environment.FACILITATOR_URL?.trim() || GOPLAUSIBLE_FACILITATOR_URL;
  try {
    const parsed = new URL(facilitatorUrl);
    if (parsed.protocol !== "https:") throw new Error();
  } catch {
    throw new Error("FACILITATOR_URL must be a valid HTTPS URL.");
  }
  const iconUrl = optionalHttpsUrl(environment.MICROVERN_ICON_URL, "MICROVERN_ICON_URL");
  const publicBaseUrl = optionalHttpsOrigin(environment.MICROVERN_PUBLIC_BASE_URL, "MICROVERN_PUBLIC_BASE_URL");

  return {
    network,
    caip2: network === "algorand-mainnet"
      ? GOPLAUSIBLE_ALGORAND_MAINNET_CAIP2
      : GOPLAUSIBLE_ALGORAND_TESTNET_CAIP2,
    payTo,
    facilitatorUrl,
    priceUsd: requiredPrice(
      environment.MICROVERN_PRICE_USD?.trim()
      || (network === "algorand-mainnet" ? MICROVERN_MAINNET_PRICE_USD : MICROVERN_TESTNET_PRICE_USD),
    ),
    usdcAssetId: network === "algorand-mainnet" ? USDC_MAINNET_ASA_ID : USDC_TESTNET_ASA_ID,
    usdcDecimals: USDC_DECIMALS,
    ...(iconUrl === undefined ? {} : { iconUrl }),
    ...(publicBaseUrl === undefined ? {} : { publicBaseUrl }),
  };
}

export function requirePaymentConfig(environment: NodeJS.ProcessEnv = process.env): PaymentConfig {
  const config = loadPaymentConfig(environment);
  if (config === undefined) {
    throw new Error("AVM_ADDRESS must be configured before starting the payment-protected MicroVern API.");
  }
  return config;
}

/**
 * Backwards-compatible Testnet helper for the local Testnet client and callers
 * that must never select MainNet.
 */
export function loadTestnetPaymentConfig(environment: NodeJS.ProcessEnv = process.env): PaymentConfig | undefined {
  return loadPaymentConfig({ ...environment, MICROVERN_PAYMENT_NETWORK: "testnet" });
}

export function requireTestnetPaymentConfig(environment: NodeJS.ProcessEnv = process.env): PaymentConfig {
  const config = loadTestnetPaymentConfig(environment);
  if (config === undefined) {
    throw new Error("AVM_ADDRESS must be configured before starting the payment-protected MicroVern API.");
  }
  return config;
}
