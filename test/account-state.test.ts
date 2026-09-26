import { describe, expect, it } from "vitest";
import { createAccountStateObserver } from "../src/account-state.js";

const ADDRESS = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

describe("account-state observer", () => {
  it("labels read-only public facts with the Algod-reported round", async () => {
    const requests: string[] = [];
    const observer = createAccountStateObserver(
      { MICROVERN_ALGOD_TESTNET_URL: "https://algod.example" },
      async (input) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("/v2/accounts/")) {
          return new Response(JSON.stringify({ account: { amount: 2_500_000, assets: [{ "asset-id": 10_458_941 }] } }), { status: 200 });
        }
        return new Response(JSON.stringify({ "last-round": 12_345 }), { status: 200 });
      },
    );

    const observation = await observer.observe("algorand-testnet", { addresses: [ADDRESS], assetIds: [10_458_941, 99] });

    expect(observer.configuredNetworks).toEqual(["algorand-testnet"]);
    expect(requests).toEqual([
      `https://algod.example/v2/accounts/${ADDRESS}`,
      "https://algod.example/v2/status",
    ]);
    expect(observation).toMatchObject({
      status: "observed",
      source: "algod",
      observedRound: 12_345,
      accounts: [{ address: ADDRESS, active: true, balanceMicroAlgos: "2500000", assetOptIns: [{ assetId: 10_458_941, optedIn: true }, { assetId: 99, optedIn: false }] }],
    });
    expect(observation.notice).toContain("round 12345");
    expect(observation.notice).toContain("not a guarantee");
  });

  it("does not make an unconfigured fallback query", async () => {
    const observer = createAccountStateObserver({}, async () => {
      throw new Error("A network call must not be made without consent and configuration.");
    });
    const observation = await observer.observe("algorand-mainnet", { addresses: [ADDRESS], assetIds: [] });
    expect(observation).toEqual({
      status: "not-configured",
      source: "algod",
      accounts: [],
      notice: "Account-state checks were not evaluated because this network has no configured Algod observer.",
    });
  });
});
