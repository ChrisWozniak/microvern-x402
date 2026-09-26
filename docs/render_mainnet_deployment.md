# Render MainNet deployment

This is a separate paid production stack for MicroVern. It does not modify the free Testnet service or its UptimeRobot monitor.

`render.mainnet.yaml` creates exactly two resources in the same Render region:

- `microvern-x402-mainnet`, an always-on `0.5c-512mb` web service;
- `microvern-x402-mainnet-db`, a paid `0.1c-256mb` Postgres database with 1 GB of storage.

The database blocks public connections. Render injects its internal, credential-bearing connection string into the web service as `MICROVERN_POSTGRES_URL`; it is never stored in GitHub or copied by hand.

## Before applying the Blueprint

1. Push the current MicroVern source, including the PostgreSQL idempotency implementation, to the branch you will deploy.
2. Create a dedicated **MainNet receiver** address. Do not use a Testnet address or expose a mnemonic/private key.
3. Fund that address with enough MainNet ALGO for its account minimum and fees, then opt it into MainNet USDC (ASA `31566704`). Do not send a MainNet x402 payment yet.
4. Publish a real MicroVern icon at a stable public HTTPS URL. It must be an icon you have the right to use.

## Create the paid stack

1. In Render, select **New** then **Blueprint** and choose this repository and branch.
2. Set **Blueprint Path** to `render.mainnet.yaml` rather than the existing `render.yaml` Testnet Blueprint.
3. Confirm Render proposes exactly the two resources above. The Testnet service must not appear in the proposed changes.
4. At Render's prompts, provide:
   - `AVM_ADDRESS`: the public MainNet receiver address from the previous section;
   - `MICROVERN_ICON_URL`: the actual public HTTPS icon URL;
   - `MICROVERN_PUBLIC_BASE_URL`: `https://microvern-x402-mainnet.onrender.com`.
5. Review the paid compute plans and billing impact, then create the Blueprint. Leave auto-deploy disabled until the preflight checks are complete.

## Preflight after deployment

1. Open the new service URL and verify `GET /healthz` returns `200`.
2. Verify `GET /readyz` returns `200` and reports `algorand-mainnet`.
3. Request `POST /v1/inspect-transaction` without a payment proof. Confirm `402 Payment Required` advertises MainNet USDC ASA `31566704`, the MainNet recipient, `x402-global-challenge`, and the canonical `https://microvern-x402-mainnet.onrender.com/v1/inspect-transaction` resource URL.
4. Check the Render logs for successful startup. The service creates the `microvern_idempotency` table automatically. Do not log, copy, or commit the database URL.

Only after these checks and a separate explicit approval should a capped MainNet inspection payment be made.
