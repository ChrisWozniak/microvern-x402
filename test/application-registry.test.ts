import { describe, expect, it } from "vitest";
import { APPLICATION_REGISTRY_VERSION, explainApplicationCall } from "../src/application-registry.js";

describe("application registry", () => {
  it("explains the documented Tinyman V2 TestNet swap selector", () => {
    const explanation = explainApplicationCall(
      "algorand-testnet",
      148_607_000,
      [new TextEncoder().encode("swap"), new TextEncoder().encode("fixed-input")],
    );
    expect(explanation).toMatchObject({
      registryVersion: APPLICATION_REGISTRY_VERSION,
      recognition: "recognized",
      name: "Tinyman V2 Validator",
      method: "swap",
    });
    expect(explanation.description).toContain("asset swap");
  });

  it("recognizes only the documented Tinyman V2 bootstrap selector", () => {
    const bootstrap = explainApplicationCall(
      "algorand-mainnet",
      1_002_541_853,
      [new TextEncoder().encode("bootstrap")],
    );
    expect(bootstrap).toMatchObject({
      registryVersion: APPLICATION_REGISTRY_VERSION,
      recognition: "recognized",
      method: "bootstrap pool",
    });
    expect(bootstrap.consequences.join(" ")).toContain("rekey");
    expect(explainApplicationCall("algorand-mainnet", 1_002_541_853, [new TextEncoder().encode("Bootstrap")])).toMatchObject({
      recognition: "known-application-unknown-method",
    });
  });

  it("does not infer a meaning for unknown applications or methods", () => {
    expect(explainApplicationCall("algorand-mainnet", 1, []).recognition).toBe("unknown");
    expect(explainApplicationCall("algorand-mainnet", 1_002_541_853, [new TextEncoder().encode("unregistered")]).recognition).toBe("known-application-unknown-method");
  });
});
