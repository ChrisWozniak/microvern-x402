import { describe, expect, it, vi } from "vitest";
import { createAgentInspectionWebhookEvent, deliverAgentInspectionWebhook, signAgentWebhookBody } from "../src/agent-webhook.js";
import type { AgentInspectionResult } from "../src/agent-client.js";

const result = {
  idempotencyKey: "agent-webhook-fixture",
  requestId: "support-correlation",
  paymentTransactionId: "W7TKPIJ374F47DVDXGHCPOTGGLXS74PM7YL4G3EZ4TSTXGNWQWRA",
  paymentReceipt: {} as AgentInspectionResult["paymentReceipt"],
  report: {
    verdict: "allow",
    riskScore: 0,
    summary: "No configured policy violation found.",
    reviewSummary: { unsignedTransactionGroup: "never-send-this" },
    actions: [],
    findings: [],
    policyEvaluation: {},
    rulesetVersion: "fixture",
    disclaimer: "Decision support only.",
    requestHash: "a".repeat(64),
    reportChecksum: "b".repeat(64),
  },
} as AgentInspectionResult;

describe("agent inspection webhooks", () => {
  it("creates a stable, sanitized completion event", () => {
    const event = createAgentInspectionWebhookEvent(result, new Date("2026-09-26T00:00:00.000Z"));
    expect(event).toMatchObject({ version: 1, event: "microvern.inspection.completed", reportId: result.report.requestHash });
    expect(JSON.stringify(event)).not.toContain("never-send-this");
    expect(event.report.reviewSummary).not.toHaveProperty("unsignedTransactionGroup");
  });

  it("posts a signed HTTPS callback without redirects", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const event = await deliverAgentInspectionWebhook(result, {
      url: "https://agent.example/hooks/microvern",
      secret: "a secret with more than sixteen bytes",
      now: new Date("2026-09-26T00:00:00.000Z"),
      fetchImplementation,
    });
    expect(event.reportId).toBe(result.report.requestHash);
    const [target, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(target.toString()).toBe("https://agent.example/hooks/microvern");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toMatchObject({ "x-microvern-webhook-event": "microvern.inspection.completed" });
    expect((init?.headers as Record<string, string>)["x-microvern-webhook-signature"]).toBe(signAgentWebhookBody("a secret with more than sixteen bytes", "2026-09-26T00:00:00.000Z", init?.body as string));
  });

  it("rejects unsafe endpoints, weak secrets, and unsuccessful deliveries", async () => {
    await expect(deliverAgentInspectionWebhook(result, { url: "http://agent.example/hook", secret: "a secret with more than sixteen bytes" })).rejects.toThrow("HTTPS");
    await expect(deliverAgentInspectionWebhook(result, { url: "https://agent.example/hook?secret=bad", secret: "a secret with more than sixteen bytes" })).rejects.toThrow("query");
    await expect(deliverAgentInspectionWebhook(result, { url: "https://agent.example/hook", secret: "too-short" })).rejects.toThrow("16");
    await expect(deliverAgentInspectionWebhook(result, { url: "https://agent.example/hook", secret: "a secret with more than sixteen bytes", fetchImplementation: async () => new Response(null, { status: 500 }) })).rejects.toThrow("HTTP 500");
  });
});
