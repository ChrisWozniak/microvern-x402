import {
  ALGORAND_TESTNET_GENESIS_HASH,
  USDC_DECIMALS,
  USDC_TESTNET_ASA_ID,
  isValidAlgorandAddress,
} from "@x402/avm";

export const GOPLAUSIBLE_FACILITATOR_URL = "https://facilitator.goplausible.xyz";
// GoPlausible currently advertises the full Algorand Testnet genesis hash in /supported.
export const GOPLAUSIBLE_ALGORAND_TESTNET_CAIP2 = `algorand:${ALGORAND_TESTNET_GENESIS_HASH}`;
export const MICROVERN_TESTNET_PRICE_USD = "$0.01";

export interface TestnetPaymentConfig {
  readonly network: "algorand-testnet";
  readonly caip2: typeof GOPLAUSIBLE_ALGORAND_TESTNET_CAIP2;
  readonly payTo: string;
  readonly facilitatorUrl: string;
  readonly priceUsd: string;
  readonly usdcAssetId: typeof USDC_TESTNET_ASA_ID;
  readonly usdcDecimals: typeof USDC_DECIMALS;
  /** Optional until the service has a public HTTPS-hosted icon. */
  readonly iconUrl?: string;
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

export function loadTestnetPaymentConfig(environment: NodeJS.ProcessEnv = process.env): TestnetPaymentConfig | undefined {
  const payTo = environment.AVM_ADDRESS?.trim();
  if (payTo === undefined || payTo.length === 0) return undefined;
  if (!isValidAlgorandAddress(payTo)) throw new Error("AVM_ADDRESS must be a valid Algorand address.");

  const facilitatorUrl = environment.FACILITATOR_URL?.trim() || GOPLAUSIBLE_FACILITATOR_URL;
  try {
    const parsed = new URL(facilitatorUrl);
    if (parsed.protocol !== "https:") throw new Error();
  } catch {
    throw new Error("FACILITATOR_URL must be a valid HTTPS URL.");
  }
  const iconUrl = optionalHttpsUrl(environment.MICROVERN_ICON_URL, "MICROVERN_ICON_URL");

  return {
    network: "algorand-testnet",
    caip2: GOPLAUSIBLE_ALGORAND_TESTNET_CAIP2,
    payTo,
    facilitatorUrl,
    priceUsd: requiredPrice(environment.MICROVERN_PRICE_USD?.trim() || MICROVERN_TESTNET_PRICE_USD),
    usdcAssetId: USDC_TESTNET_ASA_ID,
    usdcDecimals: USDC_DECIMALS,
    ...(iconUrl === undefined ? {} : { iconUrl }),
  };
}

export function requireTestnetPaymentConfig(environment: NodeJS.ProcessEnv = process.env): TestnetPaymentConfig {
  const config = loadTestnetPaymentConfig(environment);
  if (config === undefined) {
    throw new Error("AVM_ADDRESS must be configured before starting the payment-protected MicroVern API.");
  }
  return config;
}
