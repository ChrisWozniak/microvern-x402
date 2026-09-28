# MicroVern Product Requirements Document

**Version:** 2.0
**Date:** 2026-09-27
**Status:** Living product plan; MainNet release record reconciled

## Product summary

MicroVern is an x402-protected Algorand API that inspects an **unsigned**
transaction group before a person, wallet, or agent signs it. It returns a
deterministic, structured explanation of transfers, asset movement, fees,
ordering, and selected risks. A client can validate a request for free, then
pay only when it needs the full inspection report.

**Product promise:** _Know what you sign. Clarity before commitment._

### Name meaning

**MicroVern** combines a focused transaction check before signing with **vern**,
the Norwegian word for protection, defense, or safeguarding, with roots in Old
Norse. The name expresses MicroVern's role as a protective layer between an
unsigned Algorand transaction and a user's approval. Its product promise is:
_Know what you sign. Clarity before commitment._ It is decision support, not a guarantee that a
transaction is safe. See the [Bokmålsordboka definition of _vern_](https://ordbokene.no/bm/vern).

The product is deliberately an inspection service. It does not custody funds,
request private keys or mnemonics, sign transactions, broadcast transactions,
or promise that a transaction is safe.

## Problem and users

An Algorand transaction group can contain more than the action a user expects:
multiple transfers, asset transfers, fee pooling, rekeying, close-out fields,
or application calls. Raw transaction JSON is difficult for people to review
and not convenient for automated agents to assess consistently.

MicroVern serves:

- **Everyday wallet users and reviewers** who want a short, trustworthy
  explanation before approving an unsigned group. This is the primary product
  experience.
- **Advanced users** who occasionally need evidence hashes, saved safeguards,
  intent comparison, account observations, sharing, and report verification.
- **Wallet, application, and agent developers** who need a predictable,
  programmatic review step.
- **AI agents and service clients** that can pay an HTTP x402 invoice for a
  report without a conventional account or subscription. They may become the
  highest-volume source of inspections, while a human or operator remains the
  owner of policy, funding, and signing authority.

### Experience model

MicroVern must not force three very different audiences through one dense
screen. It has three deliberately separate product surfaces:

| Surface | Audience | Product rule |
| --- | --- | --- |
| **Review** | Everyday wallet users | Default to a short, plain-language three-step decision journey. |
| **More security tools** | Advanced users | Make powerful controls available on demand; do not place them before the first decision. |
| **For agents** | Agent operators and developers | Provide API/MCP recipes, fixed boundaries, and integration guidance outside the human form. |

An agent may create most requests in the future, but it is not an independent
trust authority. Its operator must pin the policy profile, recipient allowlist,
transaction limits, payment limits, and approved signer boundary. No surface
may accept a seed phrase, private key, unrestricted payment authority, or a
customer transaction signature.

## Goals and non-goals

### Goals

1. Explain an unsigned group clearly enough for a caller to decide whether to
   continue its own signing flow.
2. Make the paid path small, deterministic, and easy to integrate through
   standard HTTP and x402.
3. Keep sensitive signing material outside MicroVern at all times.
4. Support safe operations: validation before payment, idempotent paid
   requests, explicit network configuration, health checks, and observable
   deployment status.
5. Establish a credible public MainNet submission for the x402 Global
   Challenge without treating TestNet validation as a substitute for MainNet.

### Non-goals

- Operating a wallet, key store, signer, or transaction broadcaster.
- Replacing a wallet's own transaction review and consent UI.
- Guaranteeing that a group is harmless, executable, or economically sound.
- Performing a full on-chain state simulation in the initial release.
- Collecting or retaining raw unsigned transaction request bodies for product
  analytics.

## Current product scope

### Free endpoints

- `GET /healthz` for liveness.
- `GET /readyz` for configured-network readiness.
- `GET /v1/capabilities` for the active network, price, supported data types,
  and service metadata.
- `POST /v1/validate-transaction` to validate an unsigned payload without
  payment.

### Paid endpoint

- `POST /v1/inspect-transaction` returns a normalized inspection report for
  an unsigned Algorand transaction group.
- It is protected by x402 and accepts USDC on the configured Algorand network.
- The report covers ALGO and ASA transfers, group ordering, fee totals and
  pooling, rekey/close-out fields, application calls, and explicit warnings
  for selected high-risk fields or unrecognized transaction forms.
- An `Idempotency-Key` prevents a paid request from being processed twice. In
  MainNet mode, the service requires the durable PostgreSQL-backed store.

### Safety and reliability controls

- Only unsigned transaction payloads are accepted.
- Request-size, group-size, and transaction-count limits protect the service.
- Validation is performed before payment is required.
- Paid requests are rate limited and must use an idempotency key in production.
- MainNet mode requires an explicit confirmation environment variable and a
  durable database connection before the server will start.

Paid-request idempotency is bound to a privacy-preserving canonical request
hash. Reusing a key for the same request replays its completed report without
another charge; using it for different data fails before payment. Each report
also returns the request hash and a report checksum, so an agent can retain
evidence of the exact reviewed input. The hash, report, and payment receipt may
be retained for the recovery window, but never the raw unsigned transaction
payload.

## Current milestone and evidence

| Item | Status | Evidence / notes |
| --- | --- | --- |
| Core inspection API | Delivered | TypeScript service, OpenAPI contract, and deterministic tests. |
| Automated coverage | Delivered | `npm test` runs 115 deterministic tests, including MainNet preflight behavior, browser-local receipt verification, fixed unsigned guided-demo groups, versioned policy profiles, MCP recipient/transaction-cap/quote/payment-proof/account-observation boundaries, caller-approved account-state observations, recognized-application semantics, the public review console's browser-access policy, its visual decision summary, TestNet browser-payment and protected-402 CORS boundaries, declared intent checks, browser-local safeguards/history, agent payment trust boundaries and webhooks, and transient Postgres-startup retry handling. |
| Public TestNet deployment | Delivered | `https://microvern-x402-testnet.onrender.com` is live. |
| Availability monitor | Delivered | UptimeRobot checks `/healthz` every 10 minutes. |
| Real paid TestNet proof | Delivered | One $0.01 TestNet USDC payment: [`6GHS4RITOWH4KGZBPE2K2J4YG7W2GTW7SC7R6P735X3KSGG7YIKQ`](https://lora.algokit.io/testnet/transaction/6GHS4RITOWH4KGZBPE2K2J4YG7W2GTW7SC7R6P735X3KSGG7YIKQ). |
| MainNet deployment | Delivered | Paid Render compute, durable PostgreSQL, explicit enablement guard, public HTTPS service, and no-payment preflight are live at `https://microvern-x402-mainnet.onrender.com`. |
| Real paid MainNet proof | Delivered | One intentionally capped `$0.01` USDC inspection settled: [Allo transaction](https://allo.info/tx/W7TKPIJ374F47DVDXGHCPOTGGLXS74PM7YL4G3EZ4TSTXGNWQWRA) · [GoPlausible receipt](https://facilitator.goplausible.xyz/api/receipt/W7TKPIJ374F47DVDXGHCPOTGGLXS74PM7YL4G3EZ4TSTXGNWQWRA). |
| Public landing page | Delivered | [GitHub Pages](https://chriswozniak.github.io/microvern-x402/) publishes the product explanation and original icon over HTTPS. |
| Human review console | Delivered | GitHub Pages provides a mobile-friendly request composer, a no-spend guided demo, free structural preflight, policy builder, explicit opt-in for public round-labeled account observations, saved browser-local safeguards, intent check, private local history, x402 quote disclosure, a visual decision snapshot, risk-first report viewer, sharing, and local report verification. It does not request wallet secrets or sign transactions. |
| Versioned API policy profiles | Delivered | `strict-usdc-v1`, `algo-only-v1`, and `no-admin-actions-v1` resolve deterministically before payment. The selected ID/version is bound into each report. |
| Agent MCP interface | Delivered | A local stdio MCP server exposes `validate_transaction`, `get_quote`, and `inspect_transaction` with mandatory profile, ALGO/USDC transaction caps, recipient allowlist, payment-cap, receiver, and network boundaries. It accepts no wallet secret. |
| Optional account-state context | Delivered foundation | A caller must explicitly request `{ "accountStateChecks": { "consent": true } }`. MicroVern then reads only public sender/ASA facts from a configured Algod endpoint and labels the result `observed at round X`, `not configured`, or `unavailable`; it never presents an observation as a guarantee. |
| Recognized application-call semantics | Delivered foundation | Versioned registry `2026-09-v2` recognizes the documented Tinyman V2 MainNet/TestNet validator apps and selected methods. Other applications and unrecognized methods remain visibly unknown. |
| Bazaar discovery | Pending external indexing | The route advertises the required discovery metadata, but the public MainNet merchant-ID query returned zero MicroVern resources on 2026-09-27; earlier MainNet and TestNet searches also returned zero results on 2026-09-26. That does not invalidate the paid endpoint. |

## MainNet release record

The deliberate MainNet launch gates below have been reconciled with the live
deployment and settled proof. Future changes remain subject to the same
explicit approval and no-secret boundary.

| Gate | Status | Completion criterion |
| --- | --- | --- |
| Enable GitHub Pages | Complete | The public landing page and icon are available over HTTPS at `https://chriswozniak.github.io/microvern-x402/`. |
| Provision MainNet compute and PostgreSQL | Complete | The paid Render web service and private database are live from `render.mainnet.yaml`. |
| Configure the MainNet receiver | Complete | A dedicated receiver is funded, opted into MainNet USDC, and configured as `AVM_ADDRESS`. |
| Configure public service metadata | Complete | `MICROVERN_ICON_URL` points to the published MicroVern icon, and the service declares its public HTTPS base URL. |
| Run no-payment preflight | Complete | Public HTTPS returned the expected MainNet `402` quote without payment. |
| Authorize and make one capped MainNet payment | Complete | One intentional `$0.01` USDC inspection settled; the transaction and facilitator receipt are public. |
| Verify discovery and submission evidence | In progress: external indexing pending | Public endpoint, quote, settled proof, receipt, demo, and evidence record are ready. Bazaar indexing was rechecked on 2026-09-27 and is not yet listed. |
| Complete challenge submission | Pending | Project details, paid-use evidence, and the public repository are submitted through the challenge process. |

No future MainNet payment or production configuration change should occur
without explicit user approval. TestNet validates implementation; it does not
substitute for the recorded MainNet deployment and paid proof.

## Revised prioritized post-release plan

The product is moving from an MVP with many capabilities to a product with a
clear path for each audience. These are planned directions, not features
currently claimed as available. Each requires a focused safety and design
review before implementation begins.

### 1. Simple Review Mode — delivered baseline

**Purpose:** make the default experience useful to an everyday wallet user
without requiring them to understand protocol fields, reports, or x402.

**Delivered in this iteration:** the public console now presents its work as
three steps, keeps basic network/group entry and the free check in the default
path, and puts spending rules, service connection, report import, local receipt
verification, decoded actions, evidence, and report controls behind clearly
labeled optional details.

**Default three-step journey:**

1. Add or load an unsigned transaction group.
2. Run the free structural check.
3. Review the protected-report terms before any compatible wallet or agent
   approves a separate x402 report payment.

**Report result:** when a protected report is returned, show one
plain-language decision: **Matches your selected safeguards**, **Needs
attention**, or **Blocked by your safeguards**. The browser's TestNet Pera
pilot can retrieve that report after the user approves the pinned TestNet
payment. The MainNet browser experience is deliberately quote-only; a
compatible wallet or agent must separately approve the disclosed payment and
retrieve the report.

**Required visible facts:** what would leave the wallet if the group is signed;
who would receive it; whether account control would change; and the highest
priority finding. If a separate report payment has settled, show its exact
`$0.01` amount, asset, receiver, and settlement separately from the unsigned
group preview.

**Progressive disclosure:** move raw actions, policy rows, account-state
observations, report hashes, receipts, history, sharing, and technical IDs to
an **Advanced details** area or a separate tool. Never call a group “safe.” A
positive result must say it matched the selected safeguards and still instruct
the user to confirm the recipient and amount in their own wallet.

**Acceptance:** a new user can understand the free check and next safe action
without reading a technical term. No payment, wallet connection, or advanced
setting is required for that check. When a protected report is needed, the
page clearly separates its terms from the unsigned group and explains whether
the user can continue in the TestNet pilot or must use a compatible MainNet
wallet or agent.

### 2. Advanced security tools — delivered first consolidation

**Purpose:** preserve strong capabilities for advanced users without making
them the default human workflow.

**Delivered foundation:** browser-local saved safeguards and trusted contacts,
intent comparison, private local history, shareable report views, receipt
verification, optional round-labeled account observations, versioned profiles,
and on-demand report evidence are already available.

**Delivered in this iteration:** the primary navigation now groups existing
power-user pages under **More security tools**, and the review console keeps
its report import and local receipt verification behind the same optional
language.

**Follow-on work:** show an advanced control only when it is relevant to a
user’s current review. Do not add customer accounts or an end-user admin
dashboard merely to organize these tools.

**Acceptance:** an advanced user can find every existing safeguard, while an
everyday user can finish the default review without encountering a dense form.

### 3. Agent operator path — delivered quick-start layer

**Purpose:** make MicroVern a dependable, high-volume review service for
agents while keeping the operator in control of risk and funds.

**Delivered foundation:** the pinned TypeScript client, local stdio MCP server,
versioned profiles, exact recipient allowlists, transaction/payment caps,
idempotency, report binding, webhooks, and the public Agent Quick Start already
support the `validate_transaction` → `get_quote` → `inspect_transaction`
sequence.

**Delivered in this iteration:** the public Agent Quick Start now supplies
copyable strict-USDC, ALGO-only, and no-administration MCP request templates.
The MCP guide includes an operator setup checklist that keeps configuration
outside prompts and transaction payloads.

**Follow-on work:** document a deliberate live integration from a dedicated
agent wallet and keep recovery behavior for timeouts, throttling, and changed
quotes explicit and bounded.

**Acceptance:** an operator can configure one known profile, exact recipients,
transaction limits, and a maximum report-payment amount once. The agent cannot
use MicroVern outside those boundaries or provide it a wallet secret.

### 4. Reliability and semantic coverage — continuous priority

**Purpose:** ensure the product remains dependable as adoption and transaction
variety grow.

**Delivered baseline:** the regression corpus now covers malformed groups,
rekeys, close-outs, fee pooling, same-account transfers, clawbacks, and
recipient summaries for close-out destinations. It also covers idempotency
replay/conflict behavior and restart-scoped privacy-preserving metrics. The
versioned registry recognizes Tinyman V2 `bootstrap` only from its exact
published selector, alongside the previously documented methods; different
capitalization or unlisted selectors remain unknown.

**Next work:** add a deterministic regression for every production issue;
expand the known application registry only from authoritative protocol
documentation with versioned entries and fixtures; and keep unknown apps and
methods visibly unknown. Monitor the aggregate metrics for availability and
latency trends without introducing customer telemetry.

**Acceptance:** every resolved issue has a deterministic regression test; a
recognized app explanation cannot silently become a claim about an unrecognized
method; and availability/latency metrics remain privacy-preserving.

### 5. MainNet Pera + Ledger Bazaar cataloging check — deliberately narrow

**Purpose:** let the authorized operator make one capped MainNet x402 report
payment to trigger and verify Bazaar discovery. It is not a general human
MainNet payment journey.

**Requirements:** show this path only when the quote exactly matches the
pinned MainNet MicroVern origin, Algorand MainNet CAIP-2 identifier, USDC ASA
`31566704`, `10,000` atomic units (`$0.01`), and the pinned receiver. Require
an explicit real-USDC acknowledgement, start a fresh MainNet Pera pairing,
check the selected account's USDC readiness, and reject a changed quote before
Pera or Ledger can sign. The result must retain the payment receipt and report
the facilitator's Bazaar status as `success`, `processing`, `rejected`,
`not-reported`, or `malformed`; only the facilitator's report is evidence of
acceptance, not a claim that the catalog listing is already visible.

**Future MainNet browser payments:** remain out of scope until separately
approved through UX, security, and wallet-compatibility review.

**Non-negotiable boundary:** a wallet may sign the separately disclosed x402
report payment, but MicroVern never receives a seed phrase or private key and
never signs or broadcasts the customer transaction under review.

## Success measures and guardrails

Track validation, 402, and paid-inspection counts; completion and idempotency
conflict rates; response latency; health/readiness availability; finding
categories; and MainNet preflight and payment proofs. The initial
`/v1/metrics` implementation is process-local and stores aggregate counts and
latency buckets only; it resets on restart. Do not retain keys, mnemonics,
payment credentials, raw unsigned transaction payloads, addresses, request
hashes, IP addresses, wallet identifiers, payment proofs, or exception text
for these metrics. Any new metric or storage needs privacy review before
release.

For public discovery, keep the landing-page title, description, logo, route
description, and supported agent-oriented metadata accurate and specific about
what the caller receives. The public page is
[https://chriswozniak.github.io/microvern-x402/](https://chriswozniak.github.io/microvern-x402/).

## Source documents

- [README](../README.md) — local setup, endpoint use, payment proofs, and
  operational commands.
- [Hackathon submission evidence](hackathon_submission_evidence.md) — live
  endpoint checks, settled payment proofs, and Bazaar-indexing status.
- [OpenAPI contract](openapi.yaml) — public endpoint and response contract.
- [Technical research](x402_technical_research.md) — x402 findings and
  post-release research context.
- [MainNet Render deployment guide](render_mainnet_deployment.md) — controlled
  infrastructure procedure.
- [`render.mainnet.yaml`](../render.mainnet.yaml) — MainNet deployment
  Blueprint.

This PRD controls product sequencing: an iteration moves into implementation
only after its dependencies and acceptance criteria are reviewed and accepted.
