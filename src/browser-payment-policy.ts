export const MICROVERN_TESTNET_BROWSER_ORIGIN = "https://microvern-x402-testnet.onrender.com";
export const MICROVERN_TESTNET_CAIP2 = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";
export const MICROVERN_TESTNET_USDC_ASA_ID = "10458941";
export const MICROVERN_TESTNET_PRICE_ATOMIC = "10000";

export interface BrowserPaymentRequirement {
  readonly scheme?: unknown;
  readonly network?: unknown;
  readonly payTo?: unknown;
  readonly amount?: unknown;
  readonly maxAmountRequired?: unknown;
  readonly asset?: unknown;
  readonly extra?: unknown;
}

function offeredAsset(requirement: BrowserPaymentRequirement): unknown {
  if (typeof requirement.asset === "string") return requirement.asset;
  if (typeof requirement.extra === "object" && requirement.extra !== null && "asset" in requirement.extra) {
    return requirement.extra.asset;
  }
  return undefined;
}

function offeredAmount(requirement: BrowserPaymentRequirement): unknown {
  return requirement.amount ?? requirement.maxAmountRequired;
}

export function isMicrovernTestnetBrowserOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.origin === MICROVERN_TESTNET_BROWSER_ORIGIN
      && parsed.username.length === 0
      && parsed.password.length === 0
      && parsed.pathname === "/"
      && parsed.search.length === 0
      && parsed.hash.length === 0;
  } catch {
    return false;
  }
}

export function selectCappedTestnetPaymentRequirement(
  accepts: readonly BrowserPaymentRequirement[] | undefined,
): BrowserPaymentRequirement {
  const matches = accepts?.filter((requirement) => (
    requirement.scheme === "exact"
    && requirement.network === MICROVERN_TESTNET_CAIP2
    && offeredAsset(requirement) === MICROVERN_TESTNET_USDC_ASA_ID
    && offeredAmount(requirement) === MICROVERN_TESTNET_PRICE_ATOMIC
    && typeof requirement.payTo === "string"
    && /^[A-Z2-7]{58}$/.test(requirement.payTo)
  )) ?? [];
  if (matches.length !== 1) {
    throw new Error("The payment request did not match MicroVern's fixed TestNet USDC boundary.");
  }
  return matches[0]!;
}

export function sameCappedTestnetPaymentRequirement(
  first: BrowserPaymentRequirement,
  second: BrowserPaymentRequirement,
): boolean {
  return first.scheme === second.scheme
    && first.network === second.network
    && first.payTo === second.payTo
    && offeredAsset(first) === offeredAsset(second)
    && offeredAmount(first) === offeredAmount(second);
}
