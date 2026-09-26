# MicroVern hackathon submission evidence

**Last read-only check:** 2026-09-26. This record captures public endpoints
and already-settled payment evidence. No payment, signing, or broadcast was
performed while collecting it.

## Public demo and service endpoints

| Item | Public link | Verified result |
| --- | --- | --- |
| Human review demo | [GitHub Pages](https://chriswozniak.github.io/microvern-x402/) | `200` HTML response. |
| MainNet liveness | [`/healthz`](https://microvern-x402-mainnet.onrender.com/healthz) | `200` — `{"status":"ok"}`. |
| MainNet payment readiness | [`/readyz`](https://microvern-x402-mainnet.onrender.com/readyz) | `200` — MainNet `exact` scheme ready. |
| TestNet liveness | [`/healthz`](https://microvern-x402-testnet.onrender.com/healthz) | `200` — `{"status":"ok"}`. |
| TestNet payment readiness | [`/readyz`](https://microvern-x402-testnet.onrender.com/readyz) | `200` — TestNet `exact` scheme ready. |
| Paid inspection API | [`POST /v1/inspect-transaction`](https://microvern-x402-mainnet.onrender.com/v1/inspect-transaction) | x402-protected MainNet endpoint. |

## MainNet x402 quote: no payment made

A read-only `POST` probe of the MainNet inspection endpoint returned HTTP
`402` with x402 v2 `exact` payment requirements:

| Requirement | Verified value |
| --- | --- |
| Network | `algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=` |
| Asset | MainNet USDC ASA `31566704` |
| Price | `10,000` atomic USDC (`$0.01`) |
| Receiver | `GOXRKDEGYKJTNAJSPFAVUQQHHWMKBI7IW5PJ6G65X32OCYBMN6WYNNOPGE` |
| Discovery tag | `x402-global-challenge` |
| Scheme | `exact` |

The probe contained no payment proof. It did not call a signer, transfer USDC,
or obtain the paid report.

## Settled payment evidence

| Network | Proof | Verified result |
| --- | --- | --- |
| MainNet | [Allo transaction](https://allo.info/tx/W7TKPIJ374F47DVDXGHCPOTGGLXS74PM7YL4G3EZ4TSTXGNWQWRA) · [GoPlausible receipt](https://facilitator.goplausible.xyz/api/receipt/W7TKPIJ374F47DVDXGHCPOTGGLXS74PM7YL4G3EZ4TSTXGNWQWRA) | Both public links returned `200`; the receipt identifies a `$0.01` USDC x402 transfer. |
| TestNet | [Lora transaction](https://lora.algokit.io/testnet/transaction/6GHS4RITOWH4KGZBPE2K2J4YG7W2GTW7SC7R6P735X3KSGG7YIKQ) | Public link returned `200`. |

## Bazaar discovery status

MicroVern advertises the Bazaar extension and `x402-global-challenge` tag in
its protected-route metadata. The read-only catalog check on 2026-09-26 found:

- MainNet Bazaar search for `microvern`: **0 results**.
- TestNet Bazaar search for `microvern`: **0 results**.
- Exact-URL search returned the facilitator's current `500` error: `LIKE or
  GLOB pattern too complex`.

Therefore Bazaar catalog indexing is **not claimed as complete**. The public
endpoint, payment quote, settled proof, receipt, and demo remain available for
submission review. Recheck the catalog before final submission; if a resource
appears, add its exact Bazaar URL and discovery metadata to this record.

## Non-custodial security boundary

MicroVern remains an inspection and evidence service, not a wallet:

- The service and public browser pages do not request seed phrases, mnemonics,
  private keys, wallet credentials, or signing permission.
- The service does not sign or broadcast a customer's transaction. It analyzes
  an unsigned group and returns a deterministic report.
- x402 payment signing, when used, remains with the caller's compatible wallet
  or agent signer. The agent client pins its trusted origin, network, USDC ASA,
  receiver, and maximum spend before its signer is reached.
- Completion webhooks are sent by the agent after it has locally verified the
  report; they omit the original unsigned group.
- `src/testnet-payer-client.ts` is a deliberately separate, local TestNet test
  client. It can use an explicitly supplied `AVM_PRIVATE_KEY` only from the
  caller's local environment; it is not a service dependency, browser asset,
  or production wallet feature.

This boundary is a release rule: any feature that would collect a secret, hold
a key, sign a customer's transaction, or broadcast one is out of scope unless
the product model, security review, and explicit user approval change first.
