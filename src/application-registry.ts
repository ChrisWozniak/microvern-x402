import type { Network } from "./types.js";

/** Bump whenever a meaning or a registry entry changes. */
export const APPLICATION_REGISTRY_VERSION = "2026-09-v1";

type KnownMethod = {
  readonly selector: string;
  readonly label: string;
  readonly description: string;
  readonly consequences: readonly string[];
};

type KnownApplication = {
  readonly network: Network;
  readonly applicationId: number;
  readonly name: string;
  readonly referenceUrl: string;
  readonly methods: readonly KnownMethod[];
};

const TINYMAN_V2_METHODS: readonly KnownMethod[] = [
  {
    selector: "swap",
    label: "swap",
    description: "Request a Tinyman V2 asset swap. The surrounding atomic group should include the input transfer; the pool may make inner transfers for output or change.",
    consequences: ["Check the input transfer, asset IDs, minimum or exact output argument, pool account, and slippage before signing."],
  },
  {
    selector: "add_initial_liquidity",
    label: "add initial liquidity",
    description: "Request creation of an initial Tinyman V2 pool liquidity position.",
    consequences: ["This can lock the submitted assets in a pool and create pool-token exposure. Verify each companion transfer and pool account."],
  },
  {
    selector: "add_liquidity",
    label: "add liquidity",
    description: "Request an addition to a Tinyman V2 liquidity position.",
    consequences: ["This can transfer assets to a pool and change the holder's liquidity exposure. Verify companion transfers and minimum output arguments."],
  },
  {
    selector: "remove_liquidity",
    label: "remove liquidity",
    description: "Request withdrawal of assets from a Tinyman V2 liquidity position.",
    consequences: ["Verify the pool-token transfer and minimum asset outputs. Actual amounts depend on pool state when executed."],
  },
];

/**
 * Small, deliberately conservative registry. IDs and method shapes are taken
 * from Tinyman's published V2 contract and integration documentation.
 */
const KNOWN_APPLICATIONS: readonly KnownApplication[] = [
  {
    network: "algorand-mainnet",
    applicationId: 1_002_541_853,
    name: "Tinyman V2 Validator",
    referenceUrl: "https://docs.tinyman.org/contracts",
    methods: TINYMAN_V2_METHODS,
  },
  {
    network: "algorand-testnet",
    applicationId: 148_607_000,
    name: "Tinyman V2 Validator",
    referenceUrl: "https://docs.tinyman.org/contracts",
    methods: TINYMAN_V2_METHODS,
  },
];

export interface ApplicationExplanation {
  readonly registryVersion: typeof APPLICATION_REGISTRY_VERSION;
  readonly applicationId: number;
  readonly recognition: "recognized" | "known-application-unknown-method" | "unknown";
  readonly name?: string;
  readonly method?: string;
  readonly referenceUrl?: string;
  readonly description: string;
  readonly consequences: readonly string[];
}

function printableSelector(argument: Uint8Array | undefined): string | undefined {
  if (argument === undefined || argument.length === 0 || argument.length > 64) return undefined;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(argument);
    return /^[\x20-\x7e]+$/u.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

/** Explains only exact registry matches; all other app calls remain unknown. */
export function explainApplicationCall(
  network: Network,
  applicationId: number,
  arguments_: readonly Uint8Array[],
): ApplicationExplanation {
  const application = KNOWN_APPLICATIONS.find((candidate) => (
    candidate.network === network && candidate.applicationId === applicationId
  ));
  if (application === undefined) {
    return {
      registryVersion: APPLICATION_REGISTRY_VERSION,
      applicationId,
      recognition: "unknown",
      description: `Unknown application ${applicationId}. Its call data is not recognized by MicroVern's registry.`,
      consequences: ["Treat this as an opaque state-changing action. Verify the application independently before signing."],
    };
  }

  const selector = printableSelector(arguments_[0]);
  const method = application.methods.find((candidate) => candidate.selector === selector);
  if (method === undefined) {
    return {
      registryVersion: APPLICATION_REGISTRY_VERSION,
      applicationId,
      recognition: "known-application-unknown-method",
      name: application.name,
      referenceUrl: application.referenceUrl,
      description: `${application.name} is recognized, but this method selector is not in MicroVern's registry.`,
      consequences: ["Do not infer the method's effects from the application name alone; inspect the full atomic group and official application documentation."],
    };
  }

  return {
    registryVersion: APPLICATION_REGISTRY_VERSION,
    applicationId,
    recognition: "recognized",
    name: application.name,
    method: method.label,
    referenceUrl: application.referenceUrl,
    description: `${application.name}: ${method.description}`,
    consequences: method.consequences,
  };
}

export function listRecognizedApplications() {
  return KNOWN_APPLICATIONS.map(({ network, applicationId, name, referenceUrl }) => ({
    network,
    applicationId,
    name,
    referenceUrl,
  }));
}
