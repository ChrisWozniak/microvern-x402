import algosdk from "algosdk";

// This creates a harmless, unsigned Testnet self-payment for API testing only.
// It is not a transaction to submit to the network.
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
    genesisHash: Buffer.from("SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=", "base64"),
  },
});

console.log(JSON.stringify({
  network: "algorand-testnet",
  unsignedTransactionGroup: Buffer.from(algosdk.encodeUnsignedTransaction(transaction)).toString("base64"),
  policy: { allowRekey: false, allowCloseOut: false },
}, null, 2));
