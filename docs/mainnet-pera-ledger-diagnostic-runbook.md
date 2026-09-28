# MainNet Pera + Ledger payment diagnostic runbook

Use this procedure only to diagnose a MainNet Pera + Ledger x402 payment issue.
It follows the successful TestNet recovery method while applying a stricter
MainNet rule: diagnose without spending first, and do not make or retry a
payment without explicit project-owner approval.

## Non-negotiable boundary

- MainNet USDC is real value. Do not make a payment merely to test a wallet
  connection or clear an error.
- Never enter a seed phrase, private key, or Ledger recovery phrase into
  MicroVern, Pera, a browser prompt, or a support request.
- MicroVern must never sign or broadcast the unsigned customer group under
  review. Pera and Ledger may sign only the separately disclosed x402 report
  payment.
- A failed or expired quote must not be retried automatically.

## Phase 1 — no-spend service preflight

Before opening Pera, verify all of the following without a payment proof:

1. `GET https://microvern-x402-mainnet.onrender.com/healthz` returns `200`.
2. `GET https://microvern-x402-mainnet.onrender.com/readyz` returns `200` and
   reports `algorand-mainnet` with `exact` payment support.
3. A valid unsigned MainNet request receives `402 Payment Required`.
4. The quote states each exact boundary below:

| Field | Required value |
| --- | --- |
| Service origin | `https://microvern-x402-mainnet.onrender.com` |
| Inspection network | Algorand MainNet |
| x402 network | `algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=` |
| Scheme | `exact` |
| Asset | MainNet USDC, ASA `31566704` |
| Amount | `10,000` atomic units (`$0.01`) |
| Receiver | `GOXRKDEGYKJTNAJSPFAVUQQHHWMKBI7IW5PJ6G65X32OCYBMN6WYNNOPGE` |
| Discovery tag | `x402-global-challenge` |

Stop immediately if a term differs. Keep the received quote and error text;
do not connect a wallet or approve a transaction.

## Phase 2 — Pera and Ledger readiness, still without payment

1. Ensure Pera is switched to the intended MainNet Ledger-backed account.
2. Ensure the Ledger is unlocked and the Algorand app is open.
3. Confirm the selected payer is not MicroVern's receiver address.
4. Confirm the payer holds enough MainNet ALGO for fees, is opted into MainNet
   USDC ASA `31566704`, and has at least `10,000` atomic USDC.
5. If Pera has a stale TestNet or failed MainNet session, use a **fresh MainNet
   pairing**. Do not rely on an account selection from an earlier network.

The browser flow performs these checks before asking Pera or Ledger to sign.
An opt-in, balance, network, receiver, service-origin, asset, amount, or quote
mismatch must fail before a payment is created.

## Phase 3 — capture a failure precisely

When the flow fails, retain only the following non-secret evidence:

- timestamp and browser/device version;
- whether failure occurred before pairing, during Pera account selection, on
  Ledger confirmation, or after the wallet returned;
- the exact Pera, Ledger, MicroVern, or browser error text;
- the public quote terms and whether they matched the table above;
- the idempotency key and settlement transaction ID only if they were shown.

Do not share recovery phrases, private keys, wallet connection secrets, or raw
unsigned customer transaction data.

## Symptom-to-response guide

| Symptom | Safe response |
| --- | --- |
| Pera returns a TestNet account | Cancel before signing. Switch Pera to the intended MainNet account and begin a fresh MainNet pairing. |
| Payer equals the MicroVern receiver | Stop. The browser rejects self-payment because it is not a valid cataloging check. Choose a separate payer. |
| Payer lacks MainNet USDC opt-in or balance | Do not attempt payment. Opt in or fund the intended account outside MicroVern, then retrieve a new quote. |
| Ledger cannot sign | Check device unlock state, Algorand app, cable/Bluetooth connection, and Pera account selection. Obtain a fresh quote before trying again. |
| Quote changed or expired | Do not sign. Retrieve a new quote and repeat Phase 1. |
| Payment submitted but report is absent | Preserve the transaction ID and idempotency key. Check the facilitator receipt and request replay only for the same logical inspection. Do not create a new payment. |
| Receipt or returned terms differ | Treat this as a payment-boundary failure. Stop and investigate before any retry. |

## Phase 4 — one explicitly approved payment

Proceed only after all prior phases pass and the project owner explicitly
approves one payment. Immediately before Ledger confirmation, re-verify the
receiver, MainNet USDC ASA, and `$0.01` amount on the Ledger display. After
settlement, record the report, receipt, settlement transaction ID, and Bazaar
outcome. A `success` or `processing` Bazaar outcome is not by itself proof
that the public catalog listing is visible.

## Related TestNet procedure

Use the [TestNet Pera + Ledger payment runbook](testnet-pera-ledger-payment-runbook.md)
to reproduce the same recovery method without MainNet spending.
