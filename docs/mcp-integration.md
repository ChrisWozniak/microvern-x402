# MicroVern MCP integration

MicroVern ships a local **stdio MCP server** for agents. It exposes three
tools, but has no wallet, seed phrase, private key, or signing configuration.
Run it beside the agent that owns an approved wallet or HSM boundary; do not
deploy this process as an unauthenticated public service.

## Start it

```powershell
npm ci
npm run build
node dist/mcp-server.js
```

For an MCP host that launches local commands, use the compiled entry point.
For example, replace the path below with the absolute path on your machine:

```json
{
  "mcpServers": {
    "microvern": {
      "command": "node",
      "args": ["C:\\path\\to\\microvern-x402\\dist\\mcp-server.js"]
    }
  }
}
```

The server speaks MCP on standard input/output. Do not add console logging to
its output stream.

## Tools and required boundaries

| Tool | What it does | Required caller boundaries |
| --- | --- | --- |
| `validate_transaction` | Performs local profile, explicit ALGO/USDC limit, and recipient checks, then calls the free structural preflight. | HTTPS service origin, inspection network, profile ID, unsigned group, explicit ALGO/USDC transaction caps, and at least one exact allowed transaction recipient. |
| `get_quote` | Performs the same checks, then reads a no-spend `402` quote. | All validation inputs plus exact x402 payment network, USDC ASA ID, receiver, and maximum atomic-USDC payment. |
| `inspect_transaction` | Returns a paid report only after rechecking the quote and report binding. | All quote boundaries and, only after external approval, an already-created `Payment-Signature`. |

`inspect_transaction` without `paymentProof` returns an approval-required quote
and sends no payment. The MCP server never generates a payment signature and
never accepts a seed phrase or private key. An agent must create any signature
through its own approved wallet, HSM, or signer boundary.

## Versioned profiles

Use one known profile rather than an ad-hoc policy in MCP requests:

| Profile | Purpose |
| --- | --- |
| `strict-usdc-v1` | Official USDC only, no outgoing ALGO, `$0.01` USDC transaction limit, and no rekeys, close-outs, or administrative actions. The official USDC ASA is resolved for the requested network. |
| `algo-only-v1` | Blocks every ASA action while retaining conservative rekey and close-out defaults. |
| `no-admin-actions-v1` | Blocks rekeys, close-outs, asset configuration/clawback/freeze actions, and application administration. |

The selected profile ID and version are included in a completed report and in
its request hash/checksum binding. An unknown profile, a profile mixed with an
ad-hoc policy, a transaction recipient outside the supplied allowlist, or a
payment quote outside the caller's pinned limits fails before a payment proof
is forwarded.

## Safe agent sequence

1. Construct the unsigned group outside MicroVern.
2. Select a profile, explicit ALGO/USDC transaction caps, and an exact recipient allowlist.
3. Call `validate_transaction`.
4. Call `get_quote` with an explicit payment cap and pinned x402 receiver,
   USDC asset, and Algorand CAIP-2 network.
5. Show or apply the exact quote through the agent's separate approval policy.
6. Only after approval, call `inspect_transaction` with the externally created
   payment proof.
7. Treat the returned report as decision support; independently verify it
   before any signing decision.
