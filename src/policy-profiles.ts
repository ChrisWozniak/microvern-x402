import { ValidationError } from "./errors.js";
import type { AppliedPolicyProfile, InspectionPolicy, Network } from "./types.js";

export interface MicrovernPolicyProfile {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly resolve: (network: Network) => InspectionPolicy;
}

const PROFILES: readonly MicrovernPolicyProfile[] = Object.freeze([
  Object.freeze({
    id: "strict-usdc-v1",
    version: "1",
    description: "Official USDC only; no outgoing ALGO, rekeys, close-outs, or administrative actions; maximum 0.01 USDC.",
    resolve: (network: Network) => ({
      maxAlgoSend: 0,
      maxUsdcSend: 0.01,
      allowRekey: false,
      allowCloseOut: false,
      allowUnknownApps: false,
      allowedAssetIds: [network === "algorand-mainnet" ? 31_566_704 : 10_458_941],
      prohibitAdminActions: true,
    }),
  }),
  Object.freeze({
    id: "algo-only-v1",
    version: "1",
    description: "No ASA actions; rekeys and close-outs remain blocked by default.",
    resolve: () => ({
      allowRekey: false,
      allowCloseOut: false,
      allowUnknownApps: false,
      allowedAssetIds: [],
    }),
  }),
  Object.freeze({
    id: "no-admin-actions-v1",
    version: "1",
    description: "Blocks rekeys, close-outs, asset administration, clawbacks, freezes, and application administration.",
    resolve: () => ({
      allowRekey: false,
      allowCloseOut: false,
      allowUnknownApps: false,
      prohibitAdminActions: true,
    }),
  }),
]);

export function listPolicyProfiles(): readonly Pick<MicrovernPolicyProfile, "id" | "version" | "description">[] {
  return PROFILES.map(({ id, version, description }) => ({ id, version, description }));
}

export function resolvePolicyProfile(profileId: string, network: Network): { policy: InspectionPolicy; profile: AppliedPolicyProfile } {
  const profile = PROFILES.find((candidate) => candidate.id === profileId);
  if (profile === undefined) throw new ValidationError(`Unknown policyProfile: ${profileId}.`);
  return { policy: profile.resolve(network), profile: { id: profile.id, version: profile.version } };
}

export function validatePolicyProfile(profileId: unknown, network: Network): void {
  if (typeof profileId !== "string" || !/^[a-z0-9-]{3,80}$/.test(profileId)) {
    throw new ValidationError("policyProfile must be a known lowercase profile ID.");
  }
  resolvePolicyProfile(profileId, network);
}
