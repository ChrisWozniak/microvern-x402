/**
 * Fixed, unsigned TestNet examples for the public demo. These groups use
 * synthetic addresses and intentionally cannot be submitted by this page.
 */
export const MICROVERN_DEMO_GROUPS = Object.freeze([
  Object.freeze({
    id: "normal-usdc-payment",
    title: "Normal USDC payment",
    description: "A 2.50 TestNet USDC transfer within a 3 USDC guardrail.",
    expected: "allow",
    learning: "See a normal asset payment and the exact amount, recipient, and fee MicroVern identifies.",
    network: "algorand-testnet",
    policy: Object.freeze({ maxAlgoSend: 0, maxUsdcSend: 3, allowRekey: false, allowCloseOut: false, allowUnknownApps: false }),
    unsignedTransactionGroup: "iaRhYW10zgAmJaCkYXJjdsQgRMxKZqgXMw3RaCUafi5fU/EdjG9HxE01PLR5URoG/FajZmVlzQPoomZ2AaJnaMQgSGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiKibHbNA+ijc25kxCDH6aGpgW+jLNsXyiaJsZ3ceGmU9eMTaZzmYNRNeIOKQqR0eXBlpWF4ZmVypHhhaWTOAJ+XPQ==",
  }),
  Object.freeze({
    id: "hidden-rekey",
    title: "Hidden rekey",
    description: "A small ALGO payment that also changes the account's authorized signer.",
    expected: "block",
    learning: "Notice that a harmless-looking payment can include an account-control change. Rekeys are blocked by default.",
    network: "algorand-testnet",
    policy: Object.freeze({ maxAlgoSend: 1, allowRekey: false, allowCloseOut: false, allowUnknownApps: false }),
    unsignedTransactionGroup: "iaNhbXTOAAGGoKNmZWXNA+iiZnYBomdoxCBIY7UYpLPITsgQ8i1PEIHLD3HwWaesIN7GL39w5Qk6IqJsds0D6KNyY3bEIETMSmaoFzMN0WglGn4uX1PxHYxvR8RNNTy0eVEaBvxWpXJla2V5xCBoPrEdKQGTJPv3zSaAIzm6rx9AJJHIkp/4tlmaATbWs6NzbmTEIMfpoamBb6Ms2xfKJomxndx4aZT14xNpnOZg1E14g4pCpHR5cGWjcGF5",
  }),
  Object.freeze({
    id: "asset-close-out",
    title: "Asset close-out",
    description: "An ASA transfer that also closes the sender's remaining asset balance elsewhere.",
    expected: "block",
    learning: "A close-out can move an entire remaining balance. It is blocked by default even when the visible transfer is tiny.",
    network: "algorand-testnet",
    policy: Object.freeze({ maxAlgoSend: 0, allowRekey: false, allowCloseOut: false, allowUnknownApps: false }),
    unsignedTransactionGroup: "iqRhYW10AaZhY2xvc2XEIGg+sR0pAZMk+/fNJoAjObqvH0AkkciSn/i2WZoBNtazpGFyY3bEIETMSmaoFzMN0WglGn4uX1PxHYxvR8RNNTy0eVEaBvxWo2ZlZc0D6KJmdgGiZ2jEIEhjtRiks8hOyBDyLU8QgcsPcfBZp6wg3sYvf3DlCToiomx2zQPoo3NuZMQgx+mhqYFvoyzbF8omibGd3HhplPXjE2mc5mDUTXiDikKkdHlwZaVheGZlcqR4YWlkYw==",
  }),
  Object.freeze({
    id: "suspicious-app-call",
    title: "Suspicious app call",
    description: "An unapproved application call with a readable but untrusted argument.",
    expected: "review",
    learning: "MicroVern shows the application call and requires review because the app is not on your allowlist.",
    network: "algorand-testnet",
    policy: Object.freeze({ maxAlgoSend: 0, allowRekey: false, allowCloseOut: false, allowUnknownApps: false }),
    unsignedTransactionGroup: "iKRhcGFhkcQMY2xhaW0tcmV3YXJkpGFwaWTNMDmjZmVlzQPoomZ2AaJnaMQgSGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiKibHbNA+ijc25kxCDH6aGpgW+jLNsXyiaJsZ3ceGmU9eMTaZzmYNRNeIOKQqR0eXBlpGFwcGw=",
  }),
]);

export function findMicrovernDemo(id) {
  return MICROVERN_DEMO_GROUPS.find((demo) => demo.id === id);
}
