# MicroVern MCP integration

MicroVern ships a local **stdio MCP server** for agents. It exposes three
tools, but has no wallet, seed phrase, private key, or signing configuration.
Run it beside the agent that owns an approved wallet or HSM boundary; do not
deploy this process as an unauthenticated public service.

For the shortest operator-facing overview, start with the public
[Agent quick start](agents.html). This guide remains the source of truth for
connection setup and the complete tool contract.

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

## Optional account-state observation

All MCP tools default to **no account-state query**. An agent may set
`observeAccountState: true` only after its caller has approved a read of the
public sender accounts and ASA opt-in state involved in the submitted group.
MicroVern forwards this as the HTTP request's explicit
`accountStateChecks: { consent: true }` field.

If the deployed service has the selected network's pinned HTTPS Algod observer
configured, a completed report labels the facts as `observed at round X` and
includes an observation time. These public facts can change after that round;
they are not a guarantee, a reservation, or a simulation. An unconfigured or
unavailable observer is reported transparently and does not become a safety
claim. The consent choice is bound into the request hash and report checksum.

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
3. If authorized, set `observeAccountState: true`; otherwise omit it.
4. Call `validate_transaction`.
5. Call `get_quote` with an explicit payment cap and pinned x402 receiver,
   USDC asset, and Algorand CAIP-2 network.
6. Show or apply the exact quote through the agent's separate approval policy.
7. Only after approval, call `inspect_transaction` with the externally created
   payment proof.
8. Treat the returned report as decision support; independently verify it
   before any signing decision.

## Operator setup checklist

Configure these values once in the agent's own reviewed configuration, not in a
prompt and not in a transaction payload:

1. Select one versioned profile: `strict-usdc-v1`, `algo-only-v1`, or
   `no-admin-actions-v1`.
2. Set exact transaction limits and one or more exact recipient addresses.
3. Pin the HTTPS MicroVern origin and the intended Algorand inspection network.
4. Pin the x402 CAIP-2 payment network, official USDC ASA ID, receiver, and
   maximum atomic payment amount after reviewing the service capabilities.
5. Keep the signer outside MicroVern. Require the operator's wallet, HSM, or
   signing service to approve any payment proof.

For ready-to-copy request shapes, use the strict-USDC, ALGO-only, and
no-administration recipes on the [Agent quick start](agents.html). Never let an
agent replace any pinned value solely because it appeared in a quote or prompt.
