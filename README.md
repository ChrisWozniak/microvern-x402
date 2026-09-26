# MicroVern

> **Know what you sign. Clarity before commitment.**

MicroVern explains unsigned Algorand transactions before signing. It is a deterministic, best-effort decision-support API: it does not custody funds, accept wallet secrets, submit customer transactions, or guarantee safety.

The current scope, MainNet release gates, and prioritized future iterations are in the [Product Requirements Document](docs/PRD.md).

## Why the name MicroVern

**MicroVern** combines a focused transaction check before signing with **vern**,
the Norwegian word for protection, defense, or safeguarding, with roots in Old
Norse. MicroVern is the protective layer between an unsigned Algorand
transaction and a user's approval. Its product promise is: **Know what you
sign. Clarity before commitment.** This is a decision-support aid, not a
guarantee that a transaction is safe. See the
[Bokmålsordboka definition of _vern_](https://ordbokene.no/bm/vern).

## Current milestone: Testnet x402-protected analysis, with MainNet preflight safeguards

The local API accepts a base64 encoding of one or more concatenated unsigned Algorand transactions, each encoded by `algosdk.encodeUnsignedTransaction`. Multi-transaction inputs must have one shared Algorand group ID. It explains transfers, asset opt-ins/out, close-outs, clawbacks, asset administration, app calls, rekeys, and policy violations; unfamiliar behavior is flagged rather than treated as safe.

```bash
npm install
npm test
npm run build
npm start
```

For a public Testnet deployment on Render Free, use [the Render deployment guide](docs/render_testnet_deployment.md). The included `render.yaml` compiles the service and starts `dist/server.js`; it prompts for the receiver address rather than storing environment configuration in the repository. A separate, paid-MainNet Blueprint is prepared in [the MainNet Render deployment guide](docs/render_mainnet_deployment.md); it does not modify the Testnet service.

## Public landing page and MainNet preflight

The GitHub Pages-ready landing page and original MicroVern icon live in [`docs/index.html`](docs/index.html) and [`docs/assets/microvern-icon.svg`](docs/assets/microvern-icon.svg). The page includes a browser review console: it builds a bounded policy, submits the free structural preflight, discloses the exact x402 quote without signing or sending a payment, and displays reports with risk-first findings, outgoing totals, recipients, fees, policy outcomes, and on-demand technical detail. Its local receipt verifier recomputes the request hash and report checksum in the browser; it sends neither the report nor the original request to a third party. A paid report is deliberately obtained by a compatible wallet or agent; the page never asks for a seed phrase, private key, or wallet custody. After these files are pushed, enable GitHub Pages in the repository: **Settings** → **Pages** → **Deploy from a branch** → `main` → `/docs`. The expected icon URL is `https://chriswozniak.github.io/microvern-x402/assets/microvern-icon.svg`; confirm it loads publicly before entering it as `MICROVERN_ICON_URL` in the MainNet Blueprint.

After the paid MainNet service is deployed, run the no-payment preflight:

```powershell
$env:MICROVERN_URL = "https://<mainnet-service>.onrender.com"
npm run verify:mainnet-preflight
```

It calls only `/healthz`, `/readyz`, and an unsigned request without a payment header. It requires a `200` health check, a MainNet `exact` readiness response, and a `402` that advertises MainNet USDC ASA `31566704` plus the Bazaar challenge metadata. It cannot make a payment.

Public routes:

- `GET /healthz`
- `GET /readyz` (checks that the configured facilitator supports configured-network `exact` payments)
- `GET /v1/capabilities`
- `POST /v1/validate-transaction` (free bounded request preflight; no report)

Payment-protected route:

- `POST /v1/inspect-transaction` — x402 v2, Testnet USDC, `$0.01`

## Verified Testnet payment proof

MicroVern has completed one end-to-end Testnet payment through the hosted GoPlausible Facilitator. An unpaid inspection returned `402 Payment Required` for Testnet USDC ASA `10458941`, 10,000 atomic units (`$0.01`); the paid retry returned an `allow` report. The settlement is publicly verifiable: [`6GHS4RITOWH4KGZBPE2K2J4YG7W2GTW7SC7R6P735X3KSGG7YIKQ`](https://lora.algokit.io/testnet/transaction/6GHS4RITOWH4KGZBPE2K2J4YG7W2GTW7SC7R6P735X3KSGG7YIKQ).

The installed AVM SDK's shortened Testnet CAIP-2 identifier does not currently match GoPlausible's full genesis-hash identifier. MicroVern centralizes the compatible value in `GOPLAUSIBLE_ALGORAND_TESTNET_CAIP2`; re-check the facilitator's `/supported` response whenever x402 dependencies are upgraded.

Example request body:

```json
{
  "network": "algorand-testnet",
  "unsignedTransactionGroup": "<base64 concatenated algosdk.encodeUnsignedTransaction output>",
  "policy": { "maxAlgoSend": 10, "allowRekey": false }
}
```

Testnet payment configuration is loaded from `AVM_ADDRESS`, `FACILITATOR_URL`, and `MICROVERN_PRICE_USD`; `MICROVERN_PAYMENT_NETWORK` defaults to `testnet`. Copy `.env.example` to `.env` to use the funded Testnet receiver. Startup fails closed when `AVM_ADDRESS` is absent or invalid, or when the facilitator does not advertise the configured network's `exact` support. `GET /healthz` is intentionally independent of the facilitator; use `GET /readyz` for deployment readiness.

## MainNet preflight status

MicroVern recognizes `MICROVERN_PAYMENT_NETWORK=mainnet` and uses the hosted facilitator's verified full MainNet CAIP-2 identifier and MainNet USDC ASA `31566704`. Selecting it also requires the exact explicit confirmation `MICROVERN_MAINNET_CONFIRMATION=ENABLE_MAINNET_PAYMENTS`; this prevents a receiver-address configuration change from accidentally exposing a real-money endpoint.

MainNet startup requires `MICROVERN_POSTGRES_URL`, a secret PostgreSQL connection URL. When configured, MicroVern creates a small `microvern_idempotency` table and atomically reserves each paid `Idempotency-Key` before payment middleware runs. Each key is bound to a privacy-preserving SHA-256 request hash of the canonical unsigned transaction data and policy; reusing it with different data returns `409` before payment. Each report returns that `requestHash` and a `reportChecksum`, allowing an agent to retain and verify the exact reviewed input without MicroVern storing the raw unsigned group. The store keeps only the completed response and payment receipt—not the submitted unsigned transaction group—and safely replays a completed report for 10 minutes across restarts or multiple instances. A concurrent duplicate receives `409` with `Retry-After: 2` before payment processing.

Before any MainNet deployment, also use an always-on production service, a paid durable Postgres instance, a MainNet USDC-opted-in receiver, a real HTTPS icon, and an explicitly approved small MainNet payment. The existing Render Free Testnet service remains Testnet-only.

## Bazaar discovery metadata

The paid route declares x402 Bazaar metadata: its JSON request/response schemas, an unsigned-Testnet input example, `MicroVern` as the service name, and the `algorand`, `transaction-safety`, and `x402-global-challenge` tags. The resource server registers the Bazaar extension so its 402 response is enriched with the actual `POST` method.

Set `MICROVERN_ICON_URL` to the real absolute HTTPS URL of MicroVern's public icon before public deployment. It is intentionally omitted during local development; publishing a placeholder or someone else's icon would make the discovery listing misleading. When deployed behind Render's TLS proxy, also set `MICROVERN_PUBLIC_BASE_URL` to the service's canonical HTTPS origin (for example, `https://microvern-x402-mainnet.onrender.com`). This ensures the Bazaar declaration advertises a publicly callable HTTPS resource rather than Render's internal HTTP request URL. The first public paid request is the point at which a facilitator can catalog the declaration.

## API contract and safe retries

The publishable API contract is [docs/openapi.yaml](docs/openapi.yaml). Generate a harmless unsigned Testnet sample request with `node examples/generate-inspection-request.mjs`; send it first to `/v1/validate-transaction`, then to the paid endpoint with an `Idempotency-Key` of 8–128 URL-safe characters. A completed report can be replayed with that same key for 10 minutes on the same server instance without another x402 payment attempt. Use a new key for a different request.

Requests are capped at 128 KiB before payment middleware, and repeated unpaid inspection attempts are rate-limited. MicroVern returns an `X-Request-Id` for support correlation and intentionally does not log raw transaction payloads. The in-memory idempotency cache is suitable for local/Testnet use. Set the secret `MICROVERN_POSTGRES_URL` to use the shared durable PostgreSQL store required for MainNet.

## Agent-safe inspection client

[`src/agent-client.ts`](src/agent-client.ts) provides a reusable TypeScript
client for an agent that has its own approved `ClientAvmSigner`. It never
accepts, stores, or derives a private key. Before the signer is reached, it:

- sends the free structural preflight;
- pins one HTTPS MicroVern origin and rejects redirects;
- requires the configured Algorand CAIP-2 network, official USDC ASA, exact
  receiver, and `exact` scheme;
- rejects any quote above its caller-supplied atomic-USDC cap; and
- generates an idempotency key unless a retry supplies the original key.

For MainNet MicroVern, use a maximum of `10_000n` USDC atomic units (`$0.01`)
and pin the deployed service and receiver explicitly. The caller must wire a
secure wallet, hardware-backed signer, or other approved signing boundary;
the client does not turn a private key into configuration.

```ts
import { createMicrovernAgentClient } from "./dist/agent-client.js";

const microvern = createMicrovernAgentClient(agentSigner, {
  serviceUrl: "https://microvern-x402-mainnet.onrender.com",
  inspectionNetwork: "algorand-mainnet",
  paymentNetwork: "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=",
  usdcAssetId: "31566704",
  payTo: "GOXRKDEGYKJTNAJSPFAVUQQHHWMKBI7IW5PJ6G65X32OCYBMN6WYNNOPGE",
  maxAmountAtomic: 10_000n,
});

const result = await microvern.inspect(unsignedRequest);
// result.report, result.paymentTransactionId, result.idempotencyKey
```

Use the same `idempotencyKey` only to retry the same request after a timeout.
The service rejects a key that is bound to different transaction data or policy.
`AgentInspectionError.kind` distinguishes a changed payment requirement,
in-progress inspection, throttling, service unavailability, and a rejected
request so an agent can recover without guessing from error text.

## Local verification coverage

`npm test` currently runs 49 deterministic tests and `npm run build` type-checks the service. The suite covers route availability and readiness failures; the narrowly scoped GitHub Pages browser-access policy; browser-local receipt verification against the server binding format; the agent client's exact network/asset/receiver/amount trust boundary, validate-before-payment behavior, and typed recovery errors; validated Testnet and confirmation-gated MainNet payment configuration; PostgreSQL URL validation; atomic idempotency reservation/completion/replay semantics; x402 402 generation, malformed proof rejection, and Bazaar metadata; request/body/base64/policy validation; unpaid-request throttling; one-to-sixteen transaction group limits and shared-group enforcement; exact ALGO and Testnet-USDC policy boundaries; the supported transaction-risk findings (rekeys, close-outs, clawbacks, freezes, asset administration, application actions, and policy limits); and the no-payment MainNet preflight contract.

These are local, mocked-facilitator tests except for the Testnet settlement proof above. They do not substitute for the remaining public HTTPS, durable-idempotency, Bazaar-catalog, or deliberate MainNet smoke tests.

## Testnet paid-inspection client

`src/testnet-payer-client.ts` is a Node client for a single paid inspection. It only accepts Testnet `exact` USDC requirements for ASA `10458941`, capped at 10,000 atomic units (`$0.01`). It requires a base64-encoded 64-byte payer private key and an unsigned transaction group. Keep the key in your shell or an ignored local env file; never add it to the repository.

```powershell
$env:AVM_PRIVATE_KEY = "<payer private key, base64>"
$env:MICROVERN_UNSIGNED_TRANSACTION_GROUP = "<base64 unsigned transaction group>"
$env:MICROVERN_URL = "http://127.0.0.1:4021"
npx tsx src/testnet-payer-client.ts
```

On success it prints the analysis report and the Testnet settlement transaction ID. The active payer used for the integration test is held only by the protected Algorand wallet integration, so the executable client cannot use it until you provide a local key yourself.

See [the x402 technical research](docs/x402_technical_research.md) for the payment and Bazaar design.
