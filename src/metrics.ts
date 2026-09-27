import type { Verdict } from "./types.js";

/**
 * Process-local operational counters deliberately designed to avoid customer
 * telemetry. They never receive request payloads, addresses, hashes, wallet
 * identifiers, IP addresses, payment proofs, or exception text.
 */
export class PrivacyPreservingMetrics {
  private readonly startedAt = Date.now();
  private readonly validations = { accepted: 0, rejected: 0 };
  private readonly inspections = { allow: 0, review: 0, block: 0, rejected: 0, rateLimited: 0, paymentChallenges: 0 };
  private readonly idempotency = { replayed: 0, inProgress: 0, conflict: 0 };
  private readonly completedLatencyMs = { under100: 0, under500: 0, over500: 0 };

  recordValidation(accepted: boolean): void {
    if (accepted) this.validations.accepted += 1;
    else this.validations.rejected += 1;
  }

  recordInspection(verdict: Verdict, elapsedMs: number): void {
    this.inspections[verdict] += 1;
    if (elapsedMs <= 100) this.completedLatencyMs.under100 += 1;
    else if (elapsedMs <= 500) this.completedLatencyMs.under500 += 1;
    else this.completedLatencyMs.over500 += 1;
  }

  recordInspectionRejected(): void {
    this.inspections.rejected += 1;
  }

  recordRateLimited(): void {
    this.inspections.rateLimited += 1;
  }

  recordPaymentChallenge(): void {
    this.inspections.paymentChallenges += 1;
  }

  recordIdempotency(outcome: "replayed" | "inProgress" | "conflict"): void {
    this.idempotency[outcome] += 1;
  }

  snapshot(now = Date.now()) {
    return {
      metricsVersion: "2026-09-v1",
      storage: "in-memory",
      resetsOnRestart: true,
      privacy: {
        collects: ["aggregate outcome counts", "aggregate latency buckets", "aggregate idempotency outcomes"],
        neverCollects: ["unsigned transaction payloads", "addresses", "request hashes", "IP addresses", "wallet identifiers", "payment proofs", "exception text"],
      },
      uptimeSeconds: Math.max(0, Math.floor((now - this.startedAt) / 1000)),
      validations: { ...this.validations },
      inspections: { ...this.inspections },
      idempotency: { ...this.idempotency },
      completedInspectionLatencyMs: { ...this.completedLatencyMs },
    };
  }
}
