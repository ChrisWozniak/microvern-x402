import { describe, expect, it, vi } from "vitest";
import { ALGORAND_MAINNET_GENESIS_HASH, USDC_MAINNET_ASA_ID } from "@x402/avm";
import { createHarmlessMainnetInspectionRequest, verifyMainnetPreflight } from "../src/mainnet-preflight.js";

const mainnetCaip2 = `algorand:${ALGORAND_MAINNET_GENESIS_HASH}`;

describe("MainNet preflight script", () => {
  it("creates an unsigned MainNet inspection request", () => {
    const request = createHarmlessMainnetInspectionRequest();
    expect(request.network).toBe("algorand-mainnet");
    expect(request.unsignedTransactionGroup.length).toBeGreaterThan(0);
  });

  it("verifies health, readiness, and a MainNet 402 quote without payment", async () => {
    const paymentRequired = {
      accepts: [{
        scheme: "exact",
        network: mainnetCaip2,
        payTo: "MAINNETRECEIVER",
        extra: { asset: USDC_MAINNET_ASA_ID, tag: "x402-global-challenge" },
      }],
      extensions: { bazaar: { info: { input: { method: "POST" } } } },
    };
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ready", network: "algorand-mainnet", scheme: "exact" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, {
        status: 402,
        headers: { "payment-required": Buffer.from(JSON.stringify(paymentRequired)).toString("base64") },
      }));

    await expect(verifyMainnetPreflight("https://microvern.example", request)).resolves.toMatchObject({
      healthStatus: 200,
      readyStatus: 200,
      quoteStatus: 402,
      network: mainnetCaip2,
      usdcAssetId: USDC_MAINNET_ASA_ID,
      tag: "x402-global-challenge",
    });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2]?.[1]).not.toHaveProperty("headers.payment-signature");
  });
});
