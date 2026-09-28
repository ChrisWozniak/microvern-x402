import algosdk from "algosdk";

// This creates a harmless, unsigned MainNet self-payment for an x402/Bazaar
// inspection check. It is never submitted to Algorand and has no private key.
const account = algosdk.generateAccount();
const transaction = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
  sender: account.addr,
  receiver: account.addr,
  amount: 0,
  suggestedParams: {
    fee: 1_000,
    minFee: 1_000,
    flatFee: true,
    firstValid: 1,
    lastValid: 1_000,
    genesisHash: Buffer.from("wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=", "base64"),
  },
});

console.log(JSON.stringify({
  network: "algorand-mainnet",
  unsignedTransactionGroup: Buffer.from(algosdk.encodeUnsignedTransaction(transaction)).toString("base64"),
  policy: { maxAlgoSend: 0, maxUsdcSend: 0.01, allowRekey: false, allowCloseOut: false },
}, null, 2));
