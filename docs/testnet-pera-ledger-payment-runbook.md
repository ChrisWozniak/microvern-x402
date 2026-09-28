# TestNet Pera + Ledger x402 payment runbook

Use this runbook to diagnose or repeat a MicroVern TestNet browser-payment
test. It covers the separate `$0.01` TestNet-USDC x402 payment for an
inspection report. It does **not** sign or broadcast the unsigned transaction
group under review.

## Safety boundary

- Use only Algorand **TestNet** and TestNet USDC ASA `10458941`.
- The only payment amount this browser flow may request is `10,000` atomic
  units (`$0.01` TestNet USDC).
- Never enter a seed phrase, private key, or Ledger recovery phrase into
  MicroVern, Pera, a browser prompt, or a support request.
- A person controlling the TestNet account must review and approve the wallet
  transaction. MicroVern and this runbook do not authorize payment.

## Before connecting Pera

1. Open the public review console at
   `https://chriswozniak.github.io/microvern-x402/`.
2. Choose a guided TestNet demo, or load a known unsigned TestNet group.
3. Confirm the transaction network is **Algorand TestNet** and the service URL
   is exactly `https://microvern-x402-testnet.onrender.com`.
4. Run the free structural check. This needs no wallet, signature, or funds.
5. Request a protected-report quote. Do not connect a wallet or approve
   payment until the quote is visible.

## Verify the quote

Before the wallet is asked to sign, verify all of the following:

| Field | Required value |
| --- | --- |
| Service origin | `https://microvern-x402-testnet.onrender.com` |
| Inspection network | Algorand TestNet |
| Payment scheme | x402 `exact` |
| Payment asset | TestNet USDC, ASA `10458941` |
| Amount | `10,000` atomic units (`$0.01`) |

If any displayed term changes, stop. Retrieve a new quote and re-check every
field. Do not approve a wallet transaction based on an old quote.

## Pera + Ledger flow

1. In Pera, switch to the intended **TestNet** account backed by the Ledger.
2. Confirm that account has enough TestNet ALGO for fees and at least `10,000`
   atomic TestNet USDC. It must already be opted into ASA `10458941`.
3. Open the Algorand app on the Ledger and unlock the device.
4. Select **Connect Pera and approve $0.01 TestNet USDC** in the review
   console.
5. If prompted, use Pera to establish the pairing and select the intended
   TestNet account.
6. Review the Ledger screen. Approve only the separate TestNet-USDC payment
   that matches the quoted amount and asset. The pasted unsigned group must
   not appear as a transaction to sign.
7. Wait for MicroVern to return the report and settlement transaction ID.
8. Independently open the settlement ID in a TestNet explorer and confirm the
   report-payment amount and asset.

## Recovery guide

| Symptom | Safe response |
| --- | --- |
| Pera selects the wrong account or network | Cancel without signing. Switch Pera to the TestNet-funded Ledger account, then pair again. |
| Pera has a stale or failed session | Select **Pair Pera again (show QR)** to start a fresh pairing; do not reuse an unclear session. |
| Account is not opted into TestNet USDC | Opt in through the TestNet wallet flow, then obtain a new MicroVern quote. |
| Account has insufficient TestNet USDC | Fund the correct TestNet account, then obtain a new quote. |
| Quote changed after it was displayed | Do not sign. The console must reject it; retrieve and review a fresh quote. |
| Ledger is not detected or cannot sign | Check that the device is unlocked and the Algorand app is open. Reconnect Pera only after confirming the intended TestNet account. |
| Payment succeeds but no report appears | Retain the payment transaction ID, idempotency key if shown, and error text. Retry only the same logical inspection; do not create a second payment. |
| Receipt is absent or terms differ | Do not retry automatically. Preserve the error and report it as a payment-boundary failure. |

## Evidence to retain

For a successful TestNet test, retain only:

- the settlement transaction ID;
- the paid report and its request hash/checksum;
- the displayed payment terms; and
- the facilitator Bazaar outcome, if returned.

Do not retain wallet credentials, recovery phrases, private keys, or the raw
unsigned group in support notes.

## Escalation to MainNet

This runbook is the diagnostic baseline for a MainNet Pera + Ledger issue, but
it must not be used to make a MainNet payment automatically. MainNet diagnosis
starts with health, readiness, and an unpaid quote; any `$0.01` MainNet retry
requires explicit project-owner approval after the quote is re-verified.
