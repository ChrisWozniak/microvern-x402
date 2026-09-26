import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ClientAvmSigner } from "@x402/avm";
import { createMicrovernAgentClient, type MicrovernAgentTrustPolicy } from "../src/agent-client.js";
import { inspectWithSafeRecovery } from "../src/agent-integration.js";
import type { InspectionRequest } from "../src/types.js";

const MAINNET_TRUST_POLICY: MicrovernAgentTrustPolicy = {
  serviceUrl: "https://microvern-x402-mainnet.onrender.com",
  inspectionNetwork: "algorand-mainnet",
  paymentNetwork: "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=",
  usdcAssetId: "31566704",
  payTo: "GOXRKDEGYKJTNAJSPFAVUQQHHWMKBI7IW5PJ6G65X32OCYBMN6WYNNOPGE",
  maxAmountAtomic: 10_000n,
};

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}.`);
  return value;
}

function assertSigner(value: unknown): asserts value is ClientAvmSigner {
  if (typeof value !== "object" || value === null || !("address" in value) || !("signTransactions" in value) || typeof value.address !== "string" || typeof value.signTransactions !== "function") {
    throw new Error("The signer module must export an approved ClientAvmSigner as agentSigner.");
  }
}

async function readInspectionRequest(): Promise<InspectionRequest> {
  const raw = await readFile(resolve(requireEnvironment("MICROVERN_REQUEST_FILE")), "utf8");
  try {
    return JSON.parse(raw) as InspectionRequest;
  } catch {
    throw new Error("MICROVERN_REQUEST_FILE must contain valid inspection-request JSON.");
  }
}

async function loadApprovedSigner(): Promise<ClientAvmSigner> {
  const modulePath = pathToFileURL(resolve(requireEnvironment("MICROVERN_AGENT_SIGNER_MODULE"))).href;
  const loaded = await import(modulePath) as { agentSigner?: unknown };
  assertSigner(loaded.agentSigner);
  return loaded.agentSigner;
}

async function main(): Promise<void> {
  const request = await readInspectionRequest();
  const signer = await loadApprovedSigner();
  const client = createMicrovernAgentClient(signer, MAINNET_TRUST_POLICY);

  if (process.env.MICROVERN_DRY_RUN === "1") {
    await client.validate(request);
    console.log("Preflight passed. No payment was attempted.");
    return;
  }

  const correlationId = process.env.MICROVERN_CORRELATION_ID;
  const { result, attempts } = await inspectWithSafeRecovery(client, request, {
    maxAttempts: 2,
    ...(correlationId === undefined ? {} : { correlationId }),
  });
  console.log(JSON.stringify({
    verdict: result.report.verdict,
    requestHash: result.report.requestHash,
    reportChecksum: result.report.reportChecksum,
    idempotencyKey: result.idempotencyKey,
    requestId: result.requestId,
    attempts,
    paymentTransactionId: result.paymentTransactionId,
    receiptUrl: `https://facilitator.goplausible.xyz/api/receipt/${result.paymentTransactionId}`,
    explorerUrl: `https://allo.info/tx/${result.paymentTransactionId}`,
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Agent inspection failed.");
  process.exitCode = 1;
});
