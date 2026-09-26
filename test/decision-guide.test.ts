import { describe, expect, it } from "vitest";
import { createMicrovernDecisionGuide } from "../docs/assets/microvern-decision-guide.js";

describe("decision-time guidance", () => {
  it("explains a blocking rekey in plain language without authorizing the transaction", () => {
    const guide = createMicrovernDecisionGuide({ verdict: "block", findings: [{ severity: "critical", code: "REKEY_PRESENT" }] });
    expect(guide).toMatchObject({ tone: "block", title: "Do not sign yet" });
    expect(guide.steps.join(" ")).toContain("future");
    expect(guide.steps.join(" ")).toContain("not");
  });

  it("gives a conservative explanation for review and allow verdicts", () => {
    expect(createMicrovernDecisionGuide({ verdict: "review", findings: [{ severity: "high", code: "UNKNOWN_APPLICATION" }] })).toMatchObject({ tone: "review", title: "Pause and confirm the details" });
    const allow = createMicrovernDecisionGuide({ verdict: "allow", findings: [] });
    expect(allow.title).toBe("No configured rule was triggered");
    expect(allow.summary).toContain("not a safety guarantee");
  });

  it("rejects an incomplete report", () => {
    expect(() => createMicrovernDecisionGuide({ verdict: "unknown" })).toThrow("inspection report");
  });
});
