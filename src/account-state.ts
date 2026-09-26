import { loadAlgodObserverUrls } from "./config.js";
import type { AccountStateContext, Network, ObservedAccountState } from "./types.js";

export interface AccountStateTargets {
  readonly addresses: readonly string[];
  readonly assetIds: readonly number[];
}

export interface AccountStateObserver {
  readonly configuredNetworks: readonly Network[];
  observe(network: Network, targets: AccountStateTargets): Promise<AccountStateContext>;
}

type AlgodAccount = {
  amount?: unknown;
  assets?: Array<{ "asset-id"?: unknown }>;
};

type AlgodStatus = { "last-round"?: unknown };

function unavailable(reason: string): AccountStateContext {
  return {
    status: "unavailable",
    source: "algod",
    accounts: [],
    notice: `Account-state checks were not evaluated: ${reason}`,
  };
}

function configured(urls: Partial<Record<Network, string>>, network: Network): boolean {
  return urls[network] !== undefined;
}

function endpoint(baseUrl: string, path: string): URL {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

function numberOrString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^\d+$/u.test(value)) return value;
  return undefined;
}

function accountFromResponse(
  address: string,
  value: AlgodAccount,
  assetIds: readonly number[],
): ObservedAccountState {
  const optedIn = new Set(
    Array.isArray(value.assets)
      ? value.assets.map((asset) => asset["asset-id"]).filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id >= 0)
      : [],
  );
  const balanceMicroAlgos = numberOrString(value.amount);
  return {
    address,
    active: true,
    ...(balanceMicroAlgos === undefined ? {} : { balanceMicroAlgos }),
    assetOptIns: assetIds.map((assetId) => ({ assetId, optedIn: optedIn.has(assetId) })),
  };
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Creates a public, read-only Algod observer. URLs are deliberately optional:
 * without a configured HTTPS endpoint the report says not evaluated instead of
 * silently using an unpinned third-party node.
 */
export function createAccountStateObserver(
  environment: NodeJS.ProcessEnv = process.env,
  fetchImplementation: typeof fetch = fetch,
): AccountStateObserver {
  const urls = loadAlgodObserverUrls(environment);
  const configuredNetworks = (["algorand-mainnet", "algorand-testnet"] as const).filter((network) => configured(urls, network));

  return {
    configuredNetworks,
    async observe(network, targets) {
      const baseUrl = urls[network];
      if (baseUrl === undefined) {
        return {
          status: "not-configured",
          source: "algod",
          accounts: [],
          notice: "Account-state checks were not evaluated because this network has no configured Algod observer.",
        };
      }

      try {
        const signal = AbortSignal.timeout(3_000);
        const accounts: ObservedAccountState[] = [];
        for (const address of targets.addresses) {
          const response = await fetchImplementation(endpoint(baseUrl, `v2/accounts/${encodeURIComponent(address)}`), { signal });
          if (response.status === 404) {
            accounts.push({ address, active: false, assetOptIns: targets.assetIds.map((assetId) => ({ assetId, optedIn: false })) });
            continue;
          }
          if (!response.ok) throw new Error(`Algod returned HTTP ${response.status}.`);
          const body = await responseJson(response);
          if (typeof body !== "object" || body === null || !("account" in body) || typeof body.account !== "object" || body.account === null) {
            throw new Error("Algod returned an unreadable account response.");
          }
          accounts.push(accountFromResponse(address, body.account as AlgodAccount, targets.assetIds));
        }
        const statusResponse = await fetchImplementation(endpoint(baseUrl, "v2/status"), { signal });
        if (!statusResponse.ok) throw new Error(`Algod returned HTTP ${statusResponse.status} for network status.`);
        const status = await responseJson(statusResponse) as AlgodStatus | undefined;
        if (status === undefined || typeof status["last-round"] !== "number" || !Number.isSafeInteger(status["last-round"]) || status["last-round"] < 0) {
          throw new Error("Algod returned an unreadable network round.");
        }
        const observedRound = status["last-round"];
        return {
          status: "observed",
          source: "algod",
          observedRound,
          observedAt: new Date().toISOString(),
          accounts,
          notice: `Observed from Algod at round ${observedRound}. Account state can change after that round; this is not a guarantee or a transaction simulation.`,
        };
      } catch {
        return unavailable("the configured Algod observer was unavailable or returned an unreadable response.");
      }
    },
  };
}
