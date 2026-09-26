import { randomUUID } from "node:crypto";
import { AgentInspectionError, type AgentInspectionOptions, type AgentInspectionResult } from "./agent-client.js";
import type { InspectionRequest } from "./types.js";

export interface AgentInspectionRunner {
  inspect(request: InspectionRequest, options?: AgentInspectionOptions): Promise<AgentInspectionResult>;
}

export interface SafeRecoveryOptions {
  /** Reuse only for retries of this one exact inspection request. */
  idempotencyKey?: string;
  correlationId?: string;
  /** Includes the initial call. Default: two attempts. */
  maxAttempts?: number;
  /** Injected for tests; production callers may use the default wait. */
  wait?: (milliseconds: number) => Promise<void>;
}

export interface RecoveredInspectionResult {
  result: AgentInspectionResult;
  attempts: number;
}

const defaultWait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelayMilliseconds(error: AgentInspectionError, attempt: number): number | undefined {
  if (error.kind === "in-progress") return (error.retryAfterSeconds ?? 2) * 1_000;
  if (error.kind === "throttled" && error.retryAfterSeconds !== undefined) return error.retryAfterSeconds * 1_000;
  if (error.kind === "unavailable") return Math.min(1_000 * 2 ** (attempt - 1), 8_000);
  return undefined;
}

/**
 * Retries only states that can safely recover with the same idempotency key.
 * Changed quotes and rejected requests are deliberately never retried.
 */
export async function inspectWithSafeRecovery(
  client: AgentInspectionRunner,
  request: InspectionRequest,
  options: SafeRecoveryOptions = {},
): Promise<RecoveredInspectionResult> {
  const maxAttempts = options.maxAttempts ?? 2;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error("maxAttempts must be a whole number from 1 to 3.");
  }
  const idempotencyKey = options.idempotencyKey ?? randomUUID().replaceAll("-", "");
  const wait = options.wait ?? defaultWait;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await client.inspect(request, { idempotencyKey, ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }) });
      return { result, attempts: attempt };
    } catch (error) {
      if (!(error instanceof AgentInspectionError) || attempt === maxAttempts) throw error;
      const delay = retryDelayMilliseconds(error, attempt);
      if (delay === undefined) throw error;
      await wait(delay);
    }
  }
  throw new Error("Inspection recovery exhausted unexpectedly.");
}
