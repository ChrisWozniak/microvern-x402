# MicroVern x402 Technical Research

**Status:** pre-implementation audit  
**Date:** 2026-09-24  
**Scope:** the current x402 v2 AVM exact-payment scheme, Algorand TypeScript/Hono integration, GoPlausible Facilitator, Bazaar discovery, client payment flow, and implications for MicroVern.

## Decision summary

MicroVern should be a **paid HTTP API**, not a custodial wallet product and not a smart contract for the MVP. A caller submits an **unsigned Algorand transaction group** to `POST /v1/inspect-transaction`. The x402 middleware returns `402 Payment Required`; an x402-aware client signs a separate USDC payment; the GoPlausible Facilitator verifies and settles it on Algorand; only then does MicroVern return its deterministic safety report.

Use the current **x402 v2 `exact` AVM scheme**, `@x402/hono`, `@x402/avm`, and the hosted GoPlausible Facilitator for the challenge MVP. The server needs only MicroVern's opted-in receiving address (`AVM_ADDRESS`) and the Facilitator URL. It must never hold a payment private key.

The MVP needs one paid endpoint and one real MainNet settlement. Bazaar metadata should be enabled from the first deployed version, but discovery is an evolving facilitator-operated catalog rather than a guaranteed listing service.

## What x402 is doing technically

x402 reuses HTTP status `402 Payment Required` to make an ordinary endpoint payable without accounts, API keys, or a separate checkout page. There are three actors:

1. The **client** requests a protected endpoint.
2. The **resource server** returns a structured payment requirement if the request has no valid proof.
3. The **facilitator** verifies and settles the payment on-chain; the resource server serves the result after a successful settlement.

For Algorand `exact`, the payment is an ASA transfer of a fixed amount from the caller to `payTo`. The facilitator cannot redirect it to another recipient: the scheme checks the ASA amount, receiver, and asset against the advertised payment requirements. It simulates the group before submission, then broadcasts it only if valid. A successful response contains the settled transfer transaction ID.

**Implication:** x402 is the access-payment layer. MicroVern's transaction decoding, policy rules, and user-facing explanation remain ordinary application code behind that layer.

Sources: [Algorand x402 overview](https://dev.algorand.co/resources/x402-on-algorand/), [AVM exact scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_algo.md).

## Confirmed AVM payment facts

| Topic | Confirmed approach for MicroVern |
| --- | --- |
| Protocol version | x402 v2; do not hand-roll header parsing or payment verification. Use the maintained SDK middleware. |
| Scheme | `exact` on Algorand AVM: a fixed USDC ASA transfer. |
| MainNet network | Import the current CAIP-2 constant from `@x402/avm`, rather than hard-coding a string. The canonical MainNet ID is `algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k`. |
| TestNet network | Import `ALGORAND_TESTNET_CAIP2`; its current canonical value is `algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe`. |
| USDC assets | TestNet ASA `10458941`; MainNet ASA `31566704`. Use SDK constants where provided. |
| Price | Specify a dollar price such as `"$0.01"`. USDC uses six decimals, so $0.01 is 10,000 base units; avoid manual conversion in route code. |
| Receiver | `AVM_ADDRESS` is a public Algorand address. It must be opted in to USDC and have sufficient ALGO for its account minimum balance. |
| Payer | The payer must have ALGO for fees, be opted in to USDC, and have USDC. The private signing material belongs only in the payer's wallet or local development environment. |
| Fee payer | The scheme can include an optional facilitator fee payer. The facilitator's fee transaction is constrained and is not a way for a caller to cause arbitrary transfers. |
| Finality | Settlement is considered complete when the submitted payment is included in an Algorand block; the payment response identifies the relevant transfer transaction. |

The hosted GoPlausible Facilitator currently advertises Algorand MainNet and TestNet with `exact` / x402 v2. Its `/supported` endpoint is live capability data, so deployment health checks should call it rather than assuming support indefinitely.

Sources: [AVM package documentation](https://github.com/x402-foundation/x402/tree/main/typescript/packages/mechanisms/avm), [exact AVM specification](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_algo.md), [GoPlausible supported configurations](https://facilitator.goplausible.xyz/supported).

## Reference implementation shape

The official Algorand guide's Hono pattern is the correct starting point:

1. Construct `HTTPFacilitatorClient` with `FACILITATOR_URL`.
2. Construct `x402ResourceServer` around that client.
3. Register `ExactAvmScheme` for the desired imported CAIP-2 network constant.
4. Configure `paymentMiddleware` for the protected route.
5. Give the route `scheme: "exact"`, a dollar price, the network constant, `payTo: AVM_ADDRESS`, and the applicable USDC asset in `extra.asset`.
6. Put the actual Hono handler behind the middleware.

The current official tutorial names these server packages: `@x402/core`, `@x402/avm`, `@x402/hono`, `@x402-avm/extensions`, `hono`, and `@hono/node-server`. It uses `ExactAvmScheme` from `@x402/avm/exact/server` and `paymentMiddleware` / `x402ResourceServer` from `@x402/hono`.

The ecosystem is moving quickly: related GoPlausible examples use `@x402/extensions` while the Algorand portal currently shows `@x402-avm/extensions`. We will pin one mutually compatible set of package versions from the official example at implementation time, commit the lockfile, and run a real TestNet payment before accepting the import surface as stable. No unpinned `latest` dependencies.

Sources: [official Hono server tutorial](https://dev.algorand.co/resources/x402-on-algorand/), [official Hono reference example](https://github.com/algorandfoundation/x402-demo/tree/main/x402-examples/server/hono).

## Client behaviour

An x402-aware client first makes the ordinary HTTP request. On receiving `402`, it reads the payment requirements, creates a payment group using its own signer, and retries the same request with the payment proof. `@x402/fetch` provides this transparent retry pattern through `wrapFetchWithPayment`.

For the hackathon, build two clients:

* **Developer smoke-test client:** a local TypeScript command using `@x402/fetch` and a TestNet mnemonic held only in an ignored `.env` file. This proves the full protocol flow.
* **Human demo client:** a small web page or CLI flow that shows an unsigned transaction's report. Its payment signer must be a wallet integration; it must not collect a seed phrase.

The API should return the x402 settlement data to the caller where supported and record the payment transaction ID in a privacy-minimised audit record. A request retry after a network failure requires idempotency rules: retain the generated report keyed by a canonical request hash and associated settled payment ID so the customer does not pay twice for the same delivered report.

Source: [official x402 fetch client example](https://github.com/algorandfoundation/x402-demo/tree/main/x402-examples/client/fetch), [Algorand client walkthrough](https://dev.algorand.co/resources/x402-on-algorand/).

## Bazaar and agent discovery

Bazaar is x402's machine-readable discovery layer. It does **not** charge for listing. A resource becomes discoverable when a payment request includes the Bazaar extension and a facilitator processes a payment that echoes it. The extension carries input examples, JSON Schema, output examples, and route details. Facilitator cataloguing may be synchronous, asynchronous, or rejected; the extension-response header communicates that outcome when the facilitator provides it.

For MicroVern's initial route, publish:

* service name: `MicroVern`
* route: `POST /v1/inspect-transaction`
* concise description stating that the service interprets an **unsigned** Algorand transaction group before signing
* `bodyType: "json"`
* a strict request JSON Schema and a realistic response example
* tags: `algorand`, `transaction-safety`, `x402-global-challenge` (plus at most two focused additional tags if allowed by the installed package)
* an absolute HTTPS icon URL once a public domain exists

The permanent tag for challenge discovery is a challenge requirement supplied in the brief. The technical Bazaar spec permits up to five short ASCII tags and treats a malformed optional metadata field as soft-dropped, so we will test the actual 402 response and check the catalog result after the first payment. A public HTTPS endpoint is required for other agents to call reliably; localhost can prove the flow but is not a credible discovery deployment.

Sources: [Bazaar specification and seller guide](https://github.com/x402-foundation/x402/blob/main/docs/extensions/bazaar.mdx), [x402 v2 discovery specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md), [Algorand Bazarr-enabled server guide](https://dev.algorand.co/resources/x402-on-algorand/).

## MicroVern security design decisions

### 1. Only accept unsigned customer transaction groups in the MVP

An already signed transaction may be broadcastable. Asking a user to send one to an analysis service creates an avoidable custody, privacy, and trust problem. MicroVern will accept only an unsigned transaction/group encoding and will explicitly reject signed transaction blobs in the MVP. The user's payment is separate: their x402 client signs only the USDC payment group.

### 2. No customer secret enters the service

The server configuration consists of a receiving address, facilitator URL, network/environment, route price, and ordinary operational secrets such as logging credentials. It must never receive an Algorand mnemonic, private key, wallet connection secret, or seed phrase. Local test payer credentials belong in ignored local environment files only.

### 3. Deterministic, explainable MVP checks

The first report engine is deterministic and versioned. It will decode group members and flag at least:

* ALGO and ASA outgoing transfers, including totals and recipients;
* asset close-out / ALGO close remainder fields;
* rekey targets;
* application calls and arguments, marked as opaque when their program meaning cannot be safely inferred;
* asset configuration or freeze operations;
* transaction-group effects that are misleading when viewed one transaction at a time.

It returns `allow`, `review`, or `block`, reasons, severity, and ruleset version. It must never state that a transaction is safe; its language should be “no rule triggered” and “requires review.”

### 4. Abuse and reliability controls

* Limit body size and require JSON before expensive work.
* Enforce a group-size limit and bounded decoding work; reject malformed msgpack with a clear schema error.
* Keep readiness/health and API-schema endpoints free, but protect the inspection computation with x402.
* Preserve a paid response by canonical request hash plus settlement ID for a short retention window; do not recompute or charge again on a delivery retry.
* Rate-limit unpaid 402 creation and log only metadata needed for support: request hash, result status, duration, network, and settlement transaction ID. Never log raw user transaction payloads by default.
* Treat the facilitator as an external dependency: timeout it, expose readiness separately, monitor its supported networks/health, and return a clear unavailable response before accepting paid traffic if it is unhealthy.

### 5. Simulation is not an MVP promise

Decoding an unsigned group is local and deterministic. Chain-state simulation is a later feature because it depends on an Algod endpoint, round-specific state, and a precise explanation of what simulation does and does not prove. Do not market simulation as a guarantee of final execution.

## Required MVP contract

### Unpaid/public endpoints

* `GET /healthz` — liveness only, no secrets.
* `GET /readyz` — checks configuration and facilitator capability/health without creating a payment.
* `GET /v1/capabilities` — published limits, supported transaction types, ruleset version, pricing, and the exact unsigned input format.

### Paid endpoint

`POST /v1/inspect-transaction`

Initial body:

```json
{
  "network": "algorand-mainnet",
  "unsignedTransactionGroup": "base64-msgpack",
  "policy": "default"
}
```

Initial response shape:

```json
{
  "verdict": "review",
  "riskScore": 72,
  "summary": "This group rekeys the sender and transfers USDC.",
  "findings": [
    {
      "code": "REKEY_PRESENT",
      "severity": "critical",
      "transactionIndex": 0,
      "message": "The account's authorized signer will change."
    }
  ],
  "actions": ["Verify the rekey target before signing."],
  "rulesetVersion": "2026-09-mvp"
}
```

The exact encoding field name and JSON Schema are implementation decisions to validate against the Algorand TypeScript SDK before the API is published. The service must reject a signed transaction representation rather than silently treating it as unsigned.

## Test and launch evidence

### Automated tests before TestNet

* Unit fixtures for every supported transaction type and every high-risk field.
* Negative decoding tests: invalid base64, malformed msgpack, over-limit inputs, and signed blobs.
* Policy snapshot tests: same unsigned group yields the same report and ruleset version.
* Hono route tests: unpaid request gets 402; invalid/missing payment proof never reaches the paid handler; a mocked successful settlement reaches it once.
* No-secret tests: `.env`, mnemonic-shaped strings, and account seeds are excluded from commits and logs.

### TestNet evidence

* Two separate TestNet accounts, both funded with ALGO and opted into TestNet USDC.
* One successful payment from a real `@x402/fetch` client to MicroVern's TestNet receiver.
* Confirm the returned payment transaction ID on an explorer and confirm the paid JSON report was delivered.
* Confirm the 402 response exposes correct Bazaar metadata and inspect any Bazaar extension result.

### MainNet / challenge evidence

* MainNet receiving account is funded, opted into ASA `31566704`, and remains the same `payTo` address during the entry.
* HTTPS deployment is public and the endpoint is callable by an independent client.
* One intentional real USDC payment settles, is recorded with its transaction ID, and produces a valid report.
* Bazaar metadata includes `x402-global-challenge`; verify discoverability according to the challenge's current facilitator/leaderboard instructions.
* Code is public in the Electric Capital submission repository and contains no credentials.

## Build order

1. **Protocol spike:** create the Hono route, a static JSON response, an x402 fetch client, and TestNet payment. No transaction analysis yet.
2. **Safe decoder:** define unsigned-group input, strict validation, and fixture corpus.
3. **Rule engine:** implement deterministic findings, verdict logic, and report contract.
4. **Discovery and deployment:** add Bazaar declaration, public HTTPS URL, structured logs, readiness, and monitoring.
5. **MainNet readiness review:** configuration, opt-in, price, source scan, independent paid-call test, then one small intentional USDC payment.
6. **After challenge:** wallet-native human flow, optional account-state simulation, custom policies, and an MCP interface. These are not prerequisites for a valid first entry.

## Open items deliberately deferred

* A client wallet choice for the human demo.
* The public deployment/domain provider and icon hosting.
* The exact package versions after the protocol spike; upstream docs currently show two extension import paths, so empirical compatibility beats guessing.
* MainNet price after TestNet costs and response latency are measured. `$0.01` is a sensible starting proposal, not a locked promise.
* Advanced interpretation of arbitrary application-call programs. Flag rather than overclaim in the MVP.

## Sources audited

* [Algorand x402 developer page](https://algorand.co/agentic-commerce/x402/developers)
* [Algorand Developer Portal: x402 on Algorand](https://dev.algorand.co/resources/x402-on-algorand/)
* [x402 AVM TypeScript package](https://github.com/x402-foundation/x402/tree/main/typescript/packages/mechanisms/avm)
* [x402 exact Algorand specification](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_algo.md)
* [x402 v2 protocol specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md)
* [x402 Bazaar documentation](https://github.com/x402-foundation/x402/blob/main/docs/extensions/bazaar.mdx)
* [Algorand Foundation x402 Hono example](https://github.com/algorandfoundation/x402-demo/tree/main/x402-examples/server/hono)
* [Algorand Foundation x402 fetch-client example](https://github.com/algorandfoundation/x402-demo/tree/main/x402-examples/client/fetch)
* [GoPlausible x402 resources](https://x402.goplausible.xyz/)
* [GoPlausible facilitator capability endpoint](https://facilitator.goplausible.xyz/supported)
* [GoPlausible Bazaar extension examples](https://github.com/GoPlausible/.github/blob/main/profile/algorand-x402-documentation/typescript/x402-avm-extensions-examples.md)
* [Algorand agent-skills repository](https://github.com/algorand-devrel/algorand-agent-skills)

This is a technical audit of the sources that govern the planned TypeScript MVP. It is not legal, security-certification, or trademark advice, and it does not claim that every general ecosystem article has been read.
