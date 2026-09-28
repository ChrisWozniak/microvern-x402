# MicroVern Global x402 Challenge submission package

**Prepared:** 2026-09-28  
**Entry type:** Standard — one paid endpoint that returns a transaction-inspection report.

## Project summary

MicroVern is a non-custodial Algorand transaction-intelligence API. Before a
person, wallet, or agent signs an Algorand transaction group, it can submit the
**unsigned** group to MicroVern for a deterministic, plain-language explanation
and a structured `allow`, `review`, or `block` verdict.

The paid endpoint is `POST /v1/inspect-transaction`. It uses x402 v2 `exact`
payments through the GoPlausible Facilitator and charges `$0.01` USDC for a
full report. Free endpoints provide liveness, readiness, capabilities, and
bounded structural validation before a caller decides whether to pay.

MicroVern does not accept seed phrases, private keys, signed customer
transactions, or custody of funds. It does not sign or broadcast the group
under review.

## What the payment unlocks

The x402 payment unlocks a deterministic inspection report for an unsigned
Algorand transaction group. The report explains value movement, recipients,
fees, transaction ordering, rekeys, ALGO and asset close-outs, selected asset
administration, application calls, configured limits, and policy findings.

The separate x402 payment is never the customer transaction under review.

## Public links

| Item | Link |
| --- | --- |
| Source repository | https://github.com/ChrisWozniak/microvern-x402 |
| Human review demo | https://chriswozniak.github.io/microvern-x402/ |
| MainNet service | https://microvern-x402-mainnet.onrender.com |
| MainNet health | https://microvern-x402-mainnet.onrender.com/healthz |
| MainNet readiness | https://microvern-x402-mainnet.onrender.com/readyz |
| MainNet paid endpoint | https://microvern-x402-mainnet.onrender.com/v1/inspect-transaction |
| MainNet payment transaction | https://allo.info/tx/W7TKPIJ374F47DVDXGHCPOTGGLXS74PM7YL4G3EZ4TSTXGNWQWRA |
| GoPlausible payment receipt | https://facilitator.goplausible.xyz/api/receipt/W7TKPIJ374F47DVDXGHCPOTGGLXS74PM7YL4G3EZ4TSTXGNWQWRA |
| TestNet payment transaction | https://lora.algokit.io/testnet/transaction/6GHS4RITOWH4KGZBPE2K2J4YG7W2GTW7SC7R6P735X3KSGG7YIKQ |

## Verified qualification evidence

- The MainNet endpoint is deployed behind public HTTPS and reports healthy and
  payment-ready.
- One deliberate `$0.01` MainNet USDC x402 inspection payment settled and
  returned a report. The transaction and facilitator receipt are public.
- One TestNet USDC x402 payment settled separately.
- The route declares the `x402-global-challenge` discovery tag.
- The repository contains a public human review demo, an OpenAPI contract,
  deterministic tests, an MCP interface, and agent-integration documentation.

## Required owner actions before submission

1. Confirm the GitHub repository is public and the links above are accessible.
2. Submit the project details in the Global x402 Challenge submission form.
3. Submit the public GitHub repository to Electric Capital.
4. Recheck Bazaar/leaderboard visibility and add the exact public listing URL
   to the evidence record if it appears.
5. Do not claim Bazaar indexing is complete unless the public listing is
   visible. The latest recorded check remains pending external indexing.

## Suggested short description

> MicroVern is a paid, non-custodial Algorand transaction-inspection API. It
> helps wallets, developers, and AI agents understand an unsigned transaction
> group before signing by returning deterministic explanations and policy-based
> allow, review, or block verdicts. A separate x402 USDC payment unlocks the
> full report; MicroVern never receives a private key or signs the customer's
> transaction.

## Submission boundary

Submitting forms, making a real payment, or representing the project to a
third party must be performed or explicitly approved by the project owner.
This document intentionally contains only verified public evidence and does
not represent Bazaar indexing as complete.
