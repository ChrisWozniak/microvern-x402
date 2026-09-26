import { describe, expect, it } from "vitest";
import { inspectUnsignedTransaction } from "../src/analyze.js";
import { MICROVERN_DEMO_GROUPS, findMicrovernDemo } from "../docs/assets/microvern-demo-groups.js";

describe("guided demo groups", () => {
  it("provides the four safe, fixed TestNet examples", () => {
    expect(MICROVERN_DEMO_GROUPS.map((demo) => demo.id)).toEqual([
      "normal-usdc-payment",
      "hidden-rekey",
      "asset-close-out",
      "suspicious-app-call",
    ]);
    expect(MICROVERN_DEMO_GROUPS.every((demo) => demo.network === "algorand-testnet")).toBe(true);
  });

  it("keeps every demo unsigned and aligned with its teaching outcome", () => {
    const reports = MICROVERN_DEMO_GROUPS.map((demo) => ({ demo, report: inspectUnsignedTransaction(demo.unsignedTransactionGroup, demo.network, demo.policy) }));
    expect(reports.map(({ demo, report }) => [demo.expected, report.verdict])).toEqual([
      ["allow", "allow"],
      ["block", "block"],
      ["block", "block"],
      ["review", "review"],
    ]);
    expect(reports[1]?.report.findings.map((finding) => finding.code)).toContain("REKEY_PRESENT");
    expect(reports[2]?.report.findings.map((finding) => finding.code)).toContain("ASSET_CLOSE_OUT");
    expect(reports[3]?.report.findings.map((finding) => finding.code)).toContain("UNKNOWN_APPLICATION");
    expect(findMicrovernDemo("hidden-rekey")?.expected).toBe("block");
    expect(findMicrovernDemo("not-a-demo")).toBeUndefined();
  });
});
