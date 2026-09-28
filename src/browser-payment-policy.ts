export const MICROVERN_TESTNET_BROWSER_ORIGIN = "https://microvern-x402-testnet.onrender.com";
export const MICROVERN_TESTNET_CAIP2 = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";
export const MICROVERN_TESTNET_USDC_ASA_ID = "10458941";
export const MICROVERN_TESTNET_PRICE_ATOMIC = "10000";
export const MICROVERN_MAINNET_BROWSER_ORIGIN = "https://microvern-x402-mainnet.onrender.com";
export const MICROVERN_MAINNET_CAIP2 = "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
export const MICROVERN_MAINNET_USDC_ASA_ID = "31566704";
export const MICROVERN_MAINNET_PRICE_ATOMIC = "10000";
export const MICROVERN_MAINNET_RECEIVER = "GOXRKDEGYKJTNAJSPFAVUQQHHWMKBI7IW5PJ6G65X32OCYBMN6WYNNOPGE";

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
  return isCanonicalBrowserOrigin(value, MICROVERN_TESTNET_BROWSER_ORIGIN);
}

export function isMicrovernMainnetBrowserOrigin(value: string): boolean {
  return isCanonicalBrowserOrigin(value, MICROVERN_MAINNET_BROWSER_ORIGIN);
}

function isCanonicalBrowserOrigin(value: string, expectedOrigin: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.origin === expectedOrigin
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
  return selectCappedPaymentRequirement(
    accepts,
    MICROVERN_TESTNET_CAIP2,
    MICROVERN_TESTNET_USDC_ASA_ID,
    MICROVERN_TESTNET_PRICE_ATOMIC,
    undefined,
    "TestNet",
  );
}

export function selectCappedMainnetPaymentRequirement(
  accepts: readonly BrowserPaymentRequirement[] | undefined,
): BrowserPaymentRequirement {
  return selectCappedPaymentRequirement(
    accepts,
    MICROVERN_MAINNET_CAIP2,
    MICROVERN_MAINNET_USDC_ASA_ID,
    MICROVERN_MAINNET_PRICE_ATOMIC,
    MICROVERN_MAINNET_RECEIVER,
    "MainNet",
  );
}

function selectCappedPaymentRequirement(
  accepts: readonly BrowserPaymentRequirement[] | undefined,
  network: string,
  asset: string,
  amount: string,
  receiver: string | undefined,
  networkName: string,
): BrowserPaymentRequirement {
  const matches = accepts?.filter((requirement) => (
    requirement.scheme === "exact"
    && requirement.network === network
    && offeredAsset(requirement) === asset
    && offeredAmount(requirement) === amount
    && typeof requirement.payTo === "string"
    && /^[A-Z2-7]{58}$/.test(requirement.payTo)
    && (receiver === undefined || requirement.payTo === receiver)
  )) ?? [];
  if (matches.length !== 1) {
    throw new Error(`The payment request did not match MicroVern's fixed ${networkName} USDC boundary.`);
  }
  return matches[0]!;
}

export function sameCappedPaymentRequirement(
  first: BrowserPaymentRequirement,
  second: BrowserPaymentRequirement,
): boolean {
  return first.scheme === second.scheme
    && first.network === second.network
    && first.payTo === second.payTo
    && offeredAsset(first) === offeredAsset(second)
    && offeredAmount(first) === offeredAmount(second);
}

/** @deprecated Use sameCappedPaymentRequirement for either pinned network. */
export const sameCappedTestnetPaymentRequirement = sameCappedPaymentRequirement;
