# Render Testnet deployment

This Blueprint deploys MicroVern as a Render **Free Web Service** for Testnet validation only. It does not make a MainNet deployment or grant permission to send a MainNet payment.

## Create the service

1. Push this repository to GitHub without `.env` or any key material.
2. In Render, select **New** then **Blueprint**, and connect the repository.
3. Confirm the detected `render.yaml` settings:
   - plan: `free`
   - build command: `npm ci && npm run build`
   - start command: `npm start`
   - health-check path: `/healthz`
4. At the prompt for `AVM_ADDRESS`, enter the funded **Testnet receiver** address only. It is public configuration, but is prompted rather than committed so a later environment can use its own address.
5. Create the service. Render supplies `PORT`; do not configure it manually.

`FACILITATOR_URL` and `MICROVERN_PRICE_USD` are intentionally omitted from the Blueprint because the service has safe Testnet defaults: the hosted GoPlausible facilitator and `$0.01`. Set them only if deliberately changing the Testnet deployment.

## Verify after Render reports a successful deploy

Replace `<render-url>` with the service's public `https://…onrender.com` URL:

```powershell
Invoke-WebRequest https://<render-url>/healthz
Invoke-WebRequest https://<render-url>/readyz
```

Expected responses are `200` with `status: ok` and `200` with `status: ready`, respectively. Then issue one unpaid inspection request and confirm the `402` contains Testnet USDC requirements and Bazaar metadata. Do not make a paid request until the public 402 has been checked.

## Free-plan limits

The service sleeps after 15 minutes without inbound traffic and can restart, so its in-memory idempotency cache is not durable. An external monitor may call only `GET /healthz` every 10 minutes for the Testnet demo. Do not send synthetic calls to the paid route and do not use the Free service for MainNet paid traffic.
