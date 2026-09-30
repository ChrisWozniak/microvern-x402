# MicroVern hackathon submission evidence

**Last read-only check:** 2026-09-30. This record captures public endpoints
and already-settled payment evidence. No payment, signing, or broadcast was
performed while collecting it.

**Submission readiness:** the public demo, repository, MainNet endpoint,
no-spend MainNet quote, settled payment proofs, and confirmed MainNet Bazaar
resource and merchant records are recorded below. The free TestNet service is
temporarily suspended by Render until its next billing-cycle reset; this does
not affect the public MainNet evidence.

For a concise owner-facing summary and public-link packet, see the
[submission package](hackathon_submission_package.md).

## Public demo and service endpoints

| Item | Public link | Verified result |
| --- | --- | --- |
| Human review demo | [GitHub Pages](https://chriswozniak.github.io/microvern-x402/) | `200` HTML response. |
| MainNet liveness | [`/healthz`](https://microvern-x402-mainnet.onrender.com/healthz) | `200` — `{"status":"ok"}`. |
| MainNet payment readiness | [`/readyz`](https://microvern-x402-mainnet.onrender.com/readyz) | `200` — MainNet `exact` scheme ready. |
| TestNet liveness | [`/healthz`](https://microvern-x402-testnet.onrender.com/healthz) | `200` — `{"status":"ok"}`. |
| TestNet payment readiness | [`/readyz`](https://microvern-x402-testnet.onrender.com/readyz) | `200` — TestNet `exact` scheme ready. |
| Paid inspection API | [`POST /v1/inspect-transaction`](https://microvern-x402-mainnet.onrender.com/v1/inspect-transaction) | x402-protected MainNet endpoint. |

On 2026-09-28, the GitHub Pages demo and public repository each returned
`200`; MainNet `/healthz` and `/readyz` each returned `200`, and an unpaid
MainNet inspection request returned the expected `402` quote. The two TestNet
rows above are their last successful 2026-09-27 checks: Render reported the
Free-plan TestNet web service suspended on 2026-09-28 until the billing-cycle
reset.

On 2026-09-29, Render deployed the public MainNet service from commit
`b26e1ee`. A read-only `OPTIONS` check from the GitHub Pages origin confirmed
that `Extension-Responses` is exposed alongside the x402 response headers, so
future browser payments can display a facilitator-provided Bazaar result.

## MainNet x402 quote: no payment made

A read-only `POST` probe of the MainNet inspection endpoint returned HTTP
`402` with x402 v2 `exact` payment requirements on 2026-09-28:

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
| MainNet (earlier service payment) | [Allo transaction](https://allo.info/tx/W7TKPIJ374F47DVDXGHCPOTGGLXS74PM7YL4G3EZ4TSTXGNWQWRA) | Settled MainNet service-payment evidence. |
| MainNet (Lute browser route) | [Allo transaction](https://allo.info/tx/J7DF5IZDIVP5BBCCF2DOU5TZEZH57NGHAOQVP26UDJQSXERFPVQA) · [GoPlausible receipt](https://goplausible.xyz/api/receipt/efb0bd2c3d6e07e2975fe6e643d19dfc) | The receipt shows a settled `$0.01` USDC x402 payment from the Lute-selected payer to MicroVern; GoPlausible states it is valid for 90 days. |
| TestNet | [Lora transaction](https://lora.algokit.io/testnet/transaction/6GHS4RITOWH4KGZBPE2K2J4YG7W2GTW7SC7R6P735X3KSGG7YIKQ) | Public link returned `200`. |

## Browser wallet routes

The public MainNet review page presents Pera Wallet and Lute Wallet as two
alternatives for the same pinned x402 payment. A payer chooses one wallet and
uses a separate MainNet account that is opted into USDC ASA `31566704` and has
the displayed balance. The browser verifies the exact scheme, network, asset,
amount (`10,000` atomic USDC), receiver, origin, and fresh quote before either
wallet is asked to sign. It never asks either wallet to sign or broadcast the
unsigned transaction group under review.

The Lute path has the settled MainNet evidence above. The Pera MainNet path is
available for a separately authorized payment but is not represented as having
completed this release's browser end-to-end settlement.

## Bazaar discovery status

MicroVern is **confirmed listed** in GoPlausible's public Bazaar catalog. On
2026-09-30, read-only direct-record checks returned `200` for both:

- [the MainNet resource record](https://facilitator.goplausible.xyz/discovery/resources/UE9TVDpodHRwczovL21pY3JvdmVybi14NDAyLW1haW5uZXQub25yZW5kZXIuY29tL3YxL2luc3BlY3QtdHJhbnNhY3Rpb24), for `POST https://microvern-x402-mainnet.onrender.com/v1/inspect-transaction`; and
- [the merchant record](https://facilitator.goplausible.xyz/discovery/merchants/GOXRKDEGYKJTNAJSPFAVUQQHHWMKBI7IW5PJ6G65X32OCYBMN6WYNNOPGE), for the configured MainNet receiver.

The resource record confirms `exact` x402 on Algorand MainNet, USDC ASA
`31566704`, `10,000` atomic units (`$0.01`), the configured receiver, and the
`x402-global-challenge` tag. It reports one merchant resource and
`settleCount: 2`, first seen on 2026-09-29.

The facilitator's free-text merchant and exact-URL search endpoints still
returned `500` with `LIKE or GLOB pattern too complex` during the same check.
That catalog-search defect does not affect the confirmed direct resource and
merchant records above.

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
