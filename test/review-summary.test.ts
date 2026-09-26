import { describe, expect, it } from "vitest";
import { createMicrovernReviewSummary } from "../docs/assets/microvern-review-summary.js";

const report = {
  verdict: "block",
  reviewSummary: {
    totalAlgoSent: "1.25",
    totalUsdcSent: "2",
    totalFeeAlgo: "0.002",
    recipients: ["A".repeat(58)],
  },
  actions: [
    { index: 1, type: "rekey", description: "Changes signing authority." },
    { index: 0, type: "payment", description: "Sends 1.25 ALGO." },
  ],
  findings: [{ code: "REKEY_PRESENT", message: "This group changes account authorization." }],
  policyEvaluation: { maxAlgoSend: "passed", allowRekey: "failed" },
};

describe("review summary", () => {
  it("prioritizes outgoing value, recipients, and account-control changes", () => {
    const summary = createMicrovernReviewSummary(report, { policy: { maxAlgoSend: 2, allowRekey: false } });
    expect(summary.decision).toEqual({ label: "Do not sign yet", tone: "block" });
    expect(summary.movement[0]).toEqual({ label: "Outgoing ALGO", value: "1.25 ALGO" });
    expect(summary.recipients).toEqual(["A".repeat(58)]);
    expect(summary.accountControl).toMatchObject({ changed: true });
  });

  it("orders the timeline and compares observed behavior with the submitted safeguards", () => {
    const summary = createMicrovernReviewSummary(report, { policy: { maxAlgoSend: 2, allowRekey: false } });
    expect(summary.timeline.map((item) => item.type)).toEqual(["payment", "rekey"]);
    expect(summary.timeline[1]).toMatchObject({ step: 2, accountControl: true });
    expect(summary.guardrails).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "ALGO maximum", expected: "2 ALGO", actual: "1.25 ALGO", outcome: "passed" }),
      expect.objectContaining({ label: "Rekey", expected: "Blocked by default", actual: "Present", outcome: "failed" }),
    ]));
  });

  it("rejects incomplete data instead of inventing a decision summary", () => {
    expect(() => createMicrovernReviewSummary({ verdict: "allow" })).toThrow("completed MicroVern inspection report");
  });
});
