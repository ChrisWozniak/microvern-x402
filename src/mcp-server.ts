import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { pathToFileURL } from "node:url";
import * as z from "zod";
import { createMicrovernMcpTools } from "./mcp-tools.js";

const network = z.enum(["algorand-mainnet", "algorand-testnet"]);
const paymentTrust = z.object({
  paymentNetwork: z.string().min(1).describe("Exact Algorand CAIP-2 payment network."),
  usdcAssetId: z.string().regex(/^\d+$/u).describe("Official USDC ASA ID expected in the quote."),
  payTo: z.string().regex(/^[A-Z2-7]{58}$/u).describe("Exact x402 receiver address expected in the quote."),
  maxAmountAtomic: z.string().regex(/^\d+$/u).describe("Explicit positive maximum x402 spend in atomic USDC units."),
});
const inspectionInput = z.object({
  serviceUrl: z.string().url().describe("Exact HTTPS MicroVern service origin."),
  network,
  unsignedTransactionGroup: z.string().min(1).describe("Base64 of one to sixteen concatenated unsigned Algorand transactions."),
  policyProfile: z.string().min(3).describe("Known MicroVern versioned policy profile, for example strict-usdc-v1."),
  transactionLimits: z.object({
    maxAlgoSend: z.number().finite().nonnegative().describe("Explicit caller maximum outgoing ALGO."),
    maxUsdcSend: z.number().finite().nonnegative().describe("Explicit caller maximum outgoing USDC."),
  }),
  allowedRecipients: z.array(z.string().regex(/^[A-Z2-7]{58}$/u)).min(1).describe("Exact transaction-recipient allowlist required by the caller."),
});

function result(value: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function failure(error: unknown) {
  return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : "MicroVern MCP operation failed." }], isError: true };
}

/** Builds a local stdio MCP server; it has no wallet or secret configuration. */
export function createMicrovernMcpServer(fetchImplementation: typeof fetch = fetch): McpServer {
  const tools = createMicrovernMcpTools(fetchImplementation);
  const server = new McpServer(
    { name: "microvern", version: "0.1.0" },
    { instructions: "Validate an unsigned group first. Keep recipients, network, policy profile, x402 receiver, USDC asset, and spend cap pinned. Never send a seed phrase or private key: inspect_transaction only forwards an already externally approved Payment-Signature." },
  );

  server.registerTool("validate_transaction", {
    title: "Validate an unsigned transaction group",
    description: "Runs local allowlist/profile checks and MicroVern's free structural preflight. No payment, signature, wallet, or broadcast occurs.",
    inputSchema: inspectionInput,
  }, async (input) => {
    try { return result(await tools.validateTransaction(input)); } catch (error) { return failure(error); }
  });

  server.registerTool("get_quote", {
    title: "Get a verified x402 inspection quote",
    description: "Gets a no-spend 402 quote only after validating the group, profile, recipient allowlist, and explicit payment trust limits.",
    inputSchema: inspectionInput.extend({ paymentTrust }),
  }, async (input) => {
    try { return result(await tools.getQuote(input)); } catch (error) { return failure(error); }
  });

  server.registerTool("inspect_transaction", {
    title: "Inspect with externally approved payment",
    description: "Returns a paid report only after verifying the quote against explicit trust limits. Without paymentProof it returns an approval-required quote. Never provide a seed phrase or private key.",
    inputSchema: inspectionInput.extend({ paymentTrust, paymentProof: z.string().min(1).optional(), idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/u).optional() }),
  }, async (input) => {
    try { return result(await tools.inspectTransaction(input)); } catch (error) { return failure(error); }
  });

  return server;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  serveStdio(() => createMicrovernMcpServer());
}
