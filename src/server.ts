import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createPaymentProtectedService } from "./app.js";
import { loadPostgresIdempotencyUrl, requirePaymentConfig } from "./config.js";
import { createIdempotencyStore, type IdempotencyStore } from "./idempotency.js";

function assertMainnetLaunchIsSafe(network: string, idempotencyStore: IdempotencyStore): void {
  if (network === "algorand-mainnet" && !idempotencyStore.durable) {
    throw new Error("MainNet startup requires MICROVERN_POSTGRES_URL for a durable shared idempotency store. Do not run MainNet paid traffic on the in-memory implementation.");
  }
}

async function main(): Promise<void> {
  const environmentFile = resolve(process.cwd(), ".env");
  if (existsSync(environmentFile)) process.loadEnvFile(environmentFile);

  const paymentConfig = requirePaymentConfig();
  const idempotencyStore = createIdempotencyStore(loadPostgresIdempotencyUrl());
  assertMainnetLaunchIsSafe(paymentConfig.network, idempotencyStore);
  const port = Number(process.env.PORT ?? 4021);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const service = createPaymentProtectedService(paymentConfig, undefined, idempotencyStore);
  await service.initialize();
  serve({ fetch: service.app.fetch, port }, (info) => {
    console.log(`MicroVern x402 API listening on http://localhost:${info.port}`);
  });
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "MicroVern failed to start.");
  process.exitCode = 1;
});
