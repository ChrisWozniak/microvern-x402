# MicroVern Product Requirements Document

**Version:** 1.4
**Date:** 2026-09-25
**Status:** Living product plan

## Product summary

MicroVern is an x402-protected Algorand API that inspects an **unsigned**
transaction group before a person, wallet, or agent signs it. It returns a
deterministic, structured explanation of transfers, asset movement, fees,
ordering, and selected risks. A client can validate a request for free, then
pay only when it needs the full inspection report.

**Product promise:** _Know what you sign. Clarity before commitment._

### Name meaning

**MicroVern** means "small protection." **Micro** represents a focused
transaction check before signing. **Vern** is Norwegian for protection,
defense, or safeguarding, with roots in Old Norse. The name expresses
MicroVern's role as a protective layer between an unsigned Algorand transaction
and a user's approval. It is decision support, not a guarantee that a
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

- **Wallet users and reviewers** who want an explanation before approving an
  unsigned group.
- **Wallet, application, and agent developers** who need a predictable,
  programmatic review step.
- **AI agents and service clients** that can pay an HTTP x402 invoice for a
  report without a conventional account or subscription.

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
| Automated coverage | Delivered | `npm test` runs 42 deterministic tests, including MainNet preflight behavior and the public review console's browser-access policy. |
| Public TestNet deployment | Delivered | `https://microvern-x402-testnet.onrender.com` is live. |
| Availability monitor | Delivered | UptimeRobot checks `/healthz` every 10 minutes. |
| Real paid TestNet proof | Delivered | One $0.01 TestNet USDC payment: [`PQIBZGIFEUQVZX4YGYQCJQJO7PDN4DBYFHLJXOGN43IE5NEX7VQA`](https://lora.algokit.io/testnet/transaction/PQIBZGIFEUQVZX4YGYQCJQJO7PDN4DBYFHLJXOGN43IE5NEX7VQA). |
| MainNet deployment foundation | Delivered in code | Explicit guard, durable idempotency, separate Render Blueprint, and no-payment preflight command. |
| Public landing page | Delivered | [GitHub Pages](https://chriswozniak.github.io/microvern-x402/) publishes the product explanation and original icon over HTTPS. |
| Human review console | Delivered | GitHub Pages provides a mobile-friendly request composer, free structural preflight, policy builder, x402 quote disclosure, and report viewer. It does not request wallet secrets or sign transactions. |
| Bazaar discovery | Pending external indexing | TestNet discovery has not listed the service; that does not invalidate the paid endpoint. |

## MainNet release gates

The next milestone is a deliberately small MainNet launch, not a feature
expansion. Complete the following gates in order.

| Gate | Status | Completion criterion |
| --- | --- | --- |
| Enable GitHub Pages | Complete | The public landing page and icon are available over HTTPS at `https://chriswozniak.github.io/microvern-x402/`. |
| Provision MainNet compute and PostgreSQL | Pending | The paid Render web service and private database are created from `render.mainnet.yaml`. |
| Configure the MainNet receiver | Pending | A dedicated receiver is funded, opted into MainNet USDC, and set as `AVM_ADDRESS`. |
| Configure public service metadata | Pending | `MICROVERN_ICON_URL` points to the published icon. |
| Run no-payment preflight | Pending | `npm run verify:mainnet-preflight` passes against public HTTPS; it receives the expected 402 and makes no payment. |
| Authorize and make one capped MainNet payment | Pending user approval | An intentional, low-value USDC inspection succeeds and its transaction is recorded. |
| Verify discovery and submission evidence | Pending | Bazaar/leaderboard visibility is checked and public endpoint, proof, and documentation are ready. |
| Complete challenge submission | Pending | Project details, paid-use evidence, and the public repository are submitted through the challenge process. |

No MainNet payment or deployment should occur without explicit user approval.
TestNet validates implementation; it does not satisfy a MainNet submission by
itself.

## Prioritized post-release iterations

These are planned directions, not features currently claimed as available. Each
needs a focused safety and design review before implementation begins.

### 1. Human inspection and payment flow

**Purpose:** provide a mobile-friendly, plain-language review flow while
keeping signing and payment approval in the user's existing wallet.

**Delivered foundation:** a mobile-friendly GitHub Pages review console validates a pasted unsigned group for free, builds a bounded policy, discloses an unpaid x402 quote, and renders a returned report. The console does not custody a wallet or automatically sign a payment.

**Remaining requirements:** integrate an explicit wallet payment approval only after the console discloses the exact network, USDC amount, recipient, and purpose. Show the highest-risk actions first, total outgoing ALGO/USDC, recipients, fees, consequences, policy outcome, and raw technical details only on demand. Use plain language such as "changes signing authority" alongside the technical term "rekey". Never call a result "safe"; use "no configured rule triggered" instead.

**Acceptance:** a demo client can submit a group, display its summary and
warnings, obtain explicit payment approval in the user's wallet, then show the
unchanged group for the user's own signing process. The delivered report shows
its ruleset version, timestamp, request ID, and link to the settlement receipt.
No key, mnemonic, or signing request reaches MicroVern.

**Dependency:** stable public MainNet API and a documented client example.

### 2. Safe agent-payment client

**Purpose:** make paid inspection quick and dependable for automated callers
without allowing blind or unbounded spending.

**Requirements:** provide a small TypeScript client/example built on the
standard x402 fetch flow. It must validate first, generate and reuse an
idempotency key, and apply local limits for maximum spend, accepted network and
USDC asset, expected MicroVern domain, and expected `payTo` address. It must
handle validation, payment-required, in-progress, throttled, and unavailable
responses distinctly.

**Acceptance:** an agent pays at most once for one logical inspection, can
recover a completed report after a network interruption, and receives the
settlement transaction ID plus a report checksum. A payment is refused locally
when the server's quote does not match the agent's configured limits.

**Dependency:** request-hash-bound durable idempotency and hardened MainNet
service behavior.

### 3. Account-state and execution-context checks

**Purpose:** add current account, asset, and network context that raw bytes
alone cannot provide.

**Requirements:** record the ledger round; check likely insufficient balance,
asset opt-in, minimum-balance, and obvious authorization conditions when data
is available; identify unavailable or uncertain checks instead of inventing a
result.

**Acceptance:** every context-derived finding includes its observation round
and source status. A timeout or unavailable dependency becomes transparent
`not evaluated`, never a safety claim.

**Dependency:** reliable Algod/indexer access, latency budget, caching, and
privacy review.

### 4. Named, versioned policy profiles

**Purpose:** let integrators apply their own review rules without forking the
core analyzer.

**Requirements:** define a small schema for allowlists, spend limits,
prohibited fields, required warnings, and severity thresholds. Return the
policy identifier and version with every result.

**Acceptance:** callers can select a documented profile; the same payload and
policy version produce the same findings; invalid policies fail validation
before payment.

**Dependency:** stable baseline findings and a backwards-compatible versioning
policy.

### 5. MCP interface for agent clients

**Purpose:** make inspection discoverable and convenient for agent workflows
without replacing the HTTP API.

**Requirements:** expose a narrow, documented inspection tool; retain
validation-before-payment; keep payment handling explicit; reject secret
material.

**Acceptance:** an MCP client can validate and request an inspection report
through the same public contract, and examples include a visible payment cap or
confirmation step.

**Dependency:** hardened MainNet service behavior and a clear agent-payment UX.

### 6. Recognized application-call semantics

**Purpose:** turn opaque application calls into useful descriptions where
verified knowledge of a protocol or application exists.

**Requirements:** maintain a conservative registry of supported patterns;
display the interpretation, its evidence, and an explicit unknown fallback.

**Acceptance:** supported patterns have fixtures and regression tests;
unrecognized calls are never described as understood; registry changes are
versioned and reviewable.

**Dependency:** a sustainable registry-maintenance process and
protocol-specific fixtures.

### 7. Expanded adversarial regression corpus

**Purpose:** preserve reliability as the analyzer and policy surface grow.

**Requirements:** add fixtures for malformed groups, fee pooling, rekeying,
close-outs, asset edge cases, mixed types, concurrency, idempotency, and
payment-middleware failures.

**Acceptance:** every resolved issue adds a deterministic regression test; the
suite runs without a live payment and remains part of release checks.

**Dependency:** none; this grows continuously alongside other iterations.

## Success measures and guardrails

Track validation, 402, and paid-inspection counts; completion and idempotency
conflict rates; response latency; health/readiness availability; finding
categories; and MainNet preflight and payment proofs. Do not retain keys,
mnemonics, payment credentials, or raw unsigned transaction payloads for these
metrics. Any new metric or storage needs privacy review before release.

For public discovery, keep the landing-page title, description, logo, route
description, and supported agent-oriented metadata accurate and specific about
what the caller receives. The public page is
[https://chriswozniak.github.io/microvern-x402/](https://chriswozniak.github.io/microvern-x402/).

## Source documents

- [README](../README.md) — local setup, endpoint use, TestNet proof, and
  operational commands.
- [OpenAPI contract](openapi.yaml) — public endpoint and response contract.
- [Technical research](x402_technical_research.md) — x402 findings and
  post-release research context.
- [MainNet Render deployment guide](render_mainnet_deployment.md) — controlled
  infrastructure procedure.
- [`render.mainnet.yaml`](../render.mainnet.yaml) — MainNet deployment
  Blueprint.

This PRD controls product sequencing: an iteration moves into implementation
only after its dependencies and acceptance criteria are reviewed and accepted.
