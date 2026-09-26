# MicroVern agent integration kit

MicroVern’s agent client is intentionally non-custodial. Your agent supplies
an already-approved `ClientAvmSigner` from its own wallet, hardware-backed
signer, or secure signing service. MicroVern never accepts a seed phrase,
private key, or wallet credential.

The kit consists of:

- [`src/agent-client.ts`](../src/agent-client.ts): pinned x402 client that
  validates before payment and verifies the returned report binding.
- [`src/agent-integration.ts`](../src/agent-integration.ts): bounded recovery
  helper that reuses one idempotency key only when doing so is safe.
- [`examples/agent-inspection.ts`](../examples/agent-inspection.ts): a
  MainNet runner with MicroVern’s deployed HTTPS origin, official USDC ASA,
  receiver, and a hard `$0.01` cap pinned in code.

## 1. Prepare an approved signer module

Create a local, uncommitted module that exports `agentSigner`. It must satisfy
the x402 `ClientAvmSigner` interface. The signer must enforce your own wallet
approval and key-management rules. Do not put a seed phrase or private key in
the request file, project configuration, source control, or this example.

```ts
import type { ClientAvmSigner } from "@x402/avm";

export const agentSigner: ClientAvmSigner = {
  address: "YOUR_APPROVED_AGENT_ADDRESS",
  async signTransactions(transactions, indexesToSign) {
    // Delegate to your HSM, wallet adapter, or reviewed signing boundary.
    // Return null for every transaction the agent is not authorized to sign.
    throw new Error("Connect your approved signer here.");
  },
};
```

## 2. Create the exact request file

Save the unsigned inspection request as JSON. It must contain the expected
MainNet network, the base64 unsigned transaction group, and optionally the
MicroVern review policy. Generate or obtain the group through your normal
transaction workflow; do not sign it for MicroVern.

```json
{
  "network": "algorand-mainnet",
  "unsignedTransactionGroup": "<base64 unsigned transaction group>",
  "policy": { "maxAlgoSend": 0, "maxUsdcSend": 0.01 }
}
```

## 3. Run the free preflight first

This checks structure and policy only. It does not request a payment or call
the signer.

```powershell
$env:MICROVERN_REQUEST_FILE = ".\request.json"
$env:MICROVERN_AGENT_SIGNER_MODULE = ".\approved-agent-signer.ts"
$env:MICROVERN_DRY_RUN = "1"
npx tsx examples/agent-inspection.ts
```

If it prints `Preflight passed`, remove `MICROVERN_DRY_RUN` only when your
agent is explicitly authorized to spend at most `$0.01` USDC for this exact
inspection.

## 4. Make one bounded inspection

```powershell
Remove-Item Env:MICROVERN_DRY_RUN
npx tsx examples/agent-inspection.ts
```

The runner pins all of these before the signer is reached:

| Boundary | Pinned value |
| --- | --- |
| Service origin | `https://microvern-x402-mainnet.onrender.com` |
| Inspection network | Algorand MainNet |
| Payment scheme | `exact` |
| Payment asset | MainNet USDC ASA `31566704` |
| Payment receiver | MicroVern’s configured MainNet receiver |
| Maximum payment | `10,000` atomic USDC (`$0.01`) |

On success, it emits the report verdict, request hash, report checksum,
idempotency key, support request ID, settlement transaction ID, [Allo
explorer](https://allo.info/) URL, and facilitator receipt URL. The client
also recomputes the request hash and report checksum locally; a report not
bound to the exact request is rejected.

## Recovery rules

The runner never retries a changed quote or rejected request. It can retry at
most once, using the **same idempotency key**, in these narrow cases:

| Result | Behavior |
| --- | --- |
| `409 in-progress` | Wait for `Retry-After` (or two seconds) and retry once. |
| `429 throttled` with `Retry-After` | Wait that duration and retry once. |
| `5xx unavailable` | Retry once with bounded exponential delay. |
| `402 payment-required` | Stop. Treat this as a changed or unacceptable quote. |
| Other `4xx` | Stop. Correct the request or policy. |

Reusing an idempotency key for different transaction data or policy is
deliberately rejected by MicroVern before payment. Do not create manual retry
loops around the runner.

## Agent intent boundary

Before your agent signs the original transaction, compare the completed report
with the agent’s independently declared recipient, ASA, ALGO/USDC, network,
and expiry boundaries. The public [Intent check](intent.html) implements the
same fail-closed review for humans. An `allow` verdict or intent match is
decision support, not authorization to sign.
