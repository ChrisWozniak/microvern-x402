export interface StartupRetryOptions {
  readonly maxAttempts?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly onRetry?: (details: { attempt: number; maxAttempts: number; delayMs: number; error: unknown }) => void;
}

const transientDatabaseCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "57P01",
  "57P02",
  "57P03",
]);

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** Returns true only for connection failures that can occur while Render Postgres starts. */
export function isTransientDatabaseStartupError(error: unknown): boolean {
  const code = errorCode(error);
  if (code !== undefined && transientDatabaseCodes.has(code)) return true;
  return error instanceof Error && /\b(?:ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT)\b/u.test(error.message);
}

/**
 * Retries only temporary database-startup failures. Callers still receive the
 * final error, so a MainNet service never silently falls back to a non-durable
 * idempotency store.
 */
export async function initializeWithDatabaseRetry(
  initialize: () => Promise<void>,
  options: StartupRetryOptions = {},
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? 8;
  const initialDelayMs = options.initialDelayMs ?? 1_000;
  const maxDelayMs = options.maxDelayMs ?? 8_000;
  const sleep = options.sleep ?? defaultSleep;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be a positive integer.");
  if (!Number.isFinite(initialDelayMs) || initialDelayMs < 0) throw new Error("initialDelayMs must be a non-negative number.");
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < initialDelayMs) throw new Error("maxDelayMs must be at least initialDelayMs.");

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await initialize();
      return;
    } catch (error) {
      if (!isTransientDatabaseStartupError(error) || attempt === maxAttempts) throw error;
      const delayMs = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
      options.onRetry?.({ attempt, maxAttempts, delayMs, error });
      await sleep(delayMs);
    }
  }
}
