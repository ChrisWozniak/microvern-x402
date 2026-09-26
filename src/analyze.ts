import algosdk from "algosdk";
import { decodeMulti } from "algorand-msgpack";
import { bindInspectionReport } from "./binding.js";
import { ValidationError } from "./errors.js";
import { RULESET_VERSION, type Action, type AppliedPolicyProfile, type Finding, type InspectionAnalysis, type InspectionPolicy, type InspectionReport, type InspectionRequest, type ReviewSummary, type Verdict } from "./types.js";

const MAINNET_USDC_ASSET_ID = 31_566_704;
const TESTNET_USDC_ASSET_ID = 10_458_941;
const MICROALGOS_PER_ALGO = 1_000_000;
const ADMIN_ACTION_CODES = new Set(["ASSET_CLAWBACK", "ASSET_FREEZE", "ASSET_CONFIGURATION", "ASSET_CREATE", "APPLICATION_ADMIN_ACTION"]);

const DEFAULT_POLICY: Required<Pick<InspectionPolicy, "allowRekey" | "allowCloseOut" | "allowUnknownApps">> = {
  allowRekey: false,
  allowCloseOut: false,
  allowUnknownApps: false,
};

function formatAmount(amount: bigint, decimals = 6): string {
  const whole = amount / BigInt(10 ** decimals);
  const fraction = (amount % BigInt(10 ** decimals)).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}

function addressOrNone(value: algosdk.Address | undefined): string | undefined {
  return value?.toString();
}

function appCompletionName(onComplete: algosdk.OnApplicationComplete): string {
  return {
    [algosdk.OnApplicationComplete.NoOpOC]: "NoOp",
    [algosdk.OnApplicationComplete.OptInOC]: "OptIn",
    [algosdk.OnApplicationComplete.CloseOutOC]: "CloseOut",
    [algosdk.OnApplicationComplete.ClearStateOC]: "ClearState",
    [algosdk.OnApplicationComplete.UpdateApplicationOC]: "UpdateApplication",
    [algosdk.OnApplicationComplete.DeleteApplicationOC]: "DeleteApplication",
  }[onComplete];
}

function describeAppArgument(argument: Uint8Array): string {
  if (argument.length === 0) return "empty";
  if (argument.length <= 32) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(argument);
      if (/^[\x20-\x7e]+$/.test(text)) return JSON.stringify(text);
    } catch {
      // The value remains opaque below.
    }
  }
  const prefix = Buffer.from(argument.subarray(0, 8)).toString("hex");
  return `0x${prefix}${argument.length > 8 ? "…" : ""} (${argument.length}-byte opaque value)`;
}

function describeAppArguments(arguments_: readonly Uint8Array[]): string {
  if (arguments_.length === 0) return "with no arguments";
  const displayed = arguments_.slice(0, 3).map(describeAppArgument).join(", ");
  return `with ${arguments_.length} argument${arguments_.length === 1 ? "" : "s"}: ${displayed}${arguments_.length > 3 ? ", …" : ""}`;
}

function pushFinding(findings: Finding[], finding: Finding): void {
  findings.push(finding);
}

function addPolicy(policyEvaluation: InspectionReport["policyEvaluation"], key: string, failed: boolean, configured: boolean): void {
  policyEvaluation[key] = configured ? (failed ? "failed" : "passed") : "not-configured";
}

function decodeUnsignedGroup(encoded: string): algosdk.Transaction[] {
  const bytes = Buffer.from(encoded, "base64");
  try {
    const transactions = Array.from(decodeMulti(bytes), (data) =>
      algosdk.decodeUnsignedTransaction(algosdk.msgpackRawEncode(data)),
    );
    if (transactions.length === 0 || transactions.length > 16) {
      throw new ValidationError("unsignedTransactionGroup must contain between 1 and 16 transactions.");
    }
    if (transactions.length > 1 && (transactions.some((txn) => txn.group === undefined) || !transactions.every((txn) => Buffer.from(txn.group!).equals(Buffer.from(transactions[0]!.group!))))) {
      throw new ValidationError("Multiple transactions must share one Algorand group ID.");
    }
    return transactions;
  } catch {
    throw new ValidationError("unsignedTransactionGroup must be concatenated unsigned Algorand transactions encoded with algosdk.encodeUnsignedTransaction.");
  }
}

export function inspectUnsignedTransaction(
  encoded: string,
  network: "algorand-mainnet" | "algorand-testnet",
  policy: InspectionPolicy = {},
  bindingRequest: InspectionRequest = { network, unsignedTransactionGroup: encoded, policy },
  policyProfile?: AppliedPolicyProfile,
): InspectionReport {
  const transactions = decodeUnsignedGroup(encoded);

  const effectivePolicy = { ...DEFAULT_POLICY, ...policy };
  const findings: Finding[] = [];
  const actions: Action[] = [];
  const policyEvaluation: InspectionReport["policyEvaluation"] = {};
  let algoSent = 0n;
  let usdcSent = 0n;
  let totalFee = 0n;
  const recipients = new Set<string>();
  const assetIds = new Set<number>();
  const assetTransactionIndexes = new Map<number, number>();

  for (const [transactionIndex, txn] of transactions.entries()) {
    totalFee += txn.fee;
    const txnType = txn.type;
    const rekeyTo = addressOrNone(txn.rekeyTo);
    const closeRemainderTo = addressOrNone(txn.payment?.closeRemainderTo);
    const assetCloseTo = addressOrNone(txn.assetTransfer?.closeRemainderTo);

    if (txnType === "pay") {
      const payment = txn.payment;
      if (payment === undefined) throw new ValidationError("Decoded payment transaction is missing payment fields.");
      algoSent += payment.amount;
      recipients.add(payment.receiver.toString());
      actions.push({ index: transactionIndex, type: "payment", description: `Send ${formatAmount(payment.amount)} ALGO to ${payment.receiver.toString()}.`, consequences: [`Your ALGO balance decreases by ${formatAmount(payment.amount)} ALGO plus the transaction fee.`] });
    } else if (txnType === "axfer") {
      const transfer = txn.assetTransfer;
      if (transfer === undefined) throw new ValidationError("Decoded asset transfer is missing asset-transfer fields.");
      const assetId = Number(transfer.assetIndex);
      assetIds.add(assetId);
      assetTransactionIndexes.set(assetId, transactionIndex);
      const usdcId = network === "algorand-mainnet" ? MAINNET_USDC_ASSET_ID : TESTNET_USDC_ASSET_ID;
      if (assetId === usdcId) usdcSent += transfer.amount;
      const assetName = assetId === usdcId ? "USDC" : `asset ${assetId}`;
      const isOptIn = transfer.amount === 0n && transfer.receiver.toString() === txn.sender.toString() && transfer.assetSender === undefined && transfer.closeRemainderTo === undefined;
      if (isOptIn) {
        actions.push({ index: transactionIndex, type: "asset-opt-in", description: `Opt into ${assetName}.`, consequences: ["Your account will begin holding this asset and its minimum balance requirement."] });
      } else if (transfer.closeRemainderTo !== undefined) {
        recipients.add(transfer.receiver.toString());
        actions.push({ index: transactionIndex, type: "asset-opt-out", description: `Transfer ${formatAmount(transfer.amount)} ${assetName} to ${transfer.receiver.toString()} and close the remaining asset balance to ${transfer.closeRemainderTo.toString()}.`, consequences: [`Your ${assetName} holding will be removed after its remaining balance is transferred.`] });
      } else if (transfer.assetSender !== undefined) {
        recipients.add(transfer.receiver.toString());
        actions.push({ index: transactionIndex, type: "asset-clawback", description: `Transfer ${formatAmount(transfer.amount)} ${assetName} from ${transfer.assetSender.toString()} to ${transfer.receiver.toString()} using clawback authority.`, consequences: ["This transaction moves assets from another account rather than the transaction sender's holding."] });
        pushFinding(findings, { code: "ASSET_CLAWBACK", severity: "high", transactionIndex, message: `Asset ${assetId} is using clawback authority to transfer from ${transfer.assetSender.toString()}.` });
      } else {
        recipients.add(transfer.receiver.toString());
        actions.push({ index: transactionIndex, type: "asset-transfer", description: `Send ${formatAmount(transfer.amount)} ${assetName} to ${transfer.receiver.toString()}.`, consequences: [`Your ${assetName} balance decreases by ${formatAmount(transfer.amount)}.`] });
      }
    } else if (txnType === "appl") {
      const applicationCall = txn.applicationCall;
      if (applicationCall === undefined) throw new ValidationError("Decoded application call is missing application fields.");
      const appId = Number(applicationCall.appIndex);
      const completion = appCompletionName(applicationCall.onComplete);
      actions.push({ index: transactionIndex, type: "application-call", description: `Call application ${appId} with ${completion} completion ${describeAppArguments(applicationCall.appArgs)}.`, consequences: ["The application call may change on-chain state; only safely displayable arguments are rendered."] });
      const unknownApp = effectivePolicy.allowedApplicationIds?.includes(appId) !== true;
      if (!effectivePolicy.allowUnknownApps && unknownApp) {
        pushFinding(findings, { code: "UNKNOWN_APPLICATION", severity: "high", transactionIndex, message: `Application ${appId} is not on the configured allowlist.` });
      }
      if (applicationCall.onComplete === algosdk.OnApplicationComplete.UpdateApplicationOC || applicationCall.onComplete === algosdk.OnApplicationComplete.DeleteApplicationOC) {
        pushFinding(findings, { code: "APPLICATION_ADMIN_ACTION", severity: "high", transactionIndex, message: `Application ${appId} requests ${completion}, an administrative action.` });
      }
    } else if (txnType === "acfg") {
      const config = txn.assetConfig;
      if (config === undefined) throw new ValidationError("Decoded asset configuration transaction is missing asset fields.");
      const isCreate = config.assetIndex === 0n;
      actions.push({ index: transactionIndex, type: isCreate ? "asset-create" : "asset-configuration", description: isCreate ? `Create an asset with total supply ${formatAmount(config.total, config.decimals)}.` : `Configure asset ${config.assetIndex}.`, consequences: [isCreate ? "The sender becomes the asset creator and may assign administrative roles." : "This can change asset administrative roles or, when no roles are retained, destroy the asset."] });
      pushFinding(findings, { code: isCreate ? "ASSET_CREATE" : "ASSET_CONFIGURATION", severity: "medium", transactionIndex, message: isCreate ? "This transaction creates a new asset." : `This transaction changes or may destroy asset ${config.assetIndex}.` });
    } else if (txnType === "afrz") {
      const freeze = txn.assetFreeze;
      if (freeze === undefined) throw new ValidationError("Decoded asset freeze transaction is missing asset fields.");
      actions.push({ index: transactionIndex, type: "asset-freeze", description: `${freeze.frozen ? "Freeze" : "Unfreeze"} ${freeze.freezeAccount.toString()} for asset ${freeze.assetIndex}.`, consequences: [`The target account ${freeze.frozen ? "will be prevented from" : "will be allowed to"} transact in this asset.`] });
      pushFinding(findings, { code: "ASSET_FREEZE", severity: "high", transactionIndex, message: `This transaction ${freeze.frozen ? "freezes" : "unfreezes"} an account's holding for asset ${freeze.assetIndex}.` });
    } else {
      actions.push({ index: transactionIndex, type: txnType, description: `Submit an Algorand ${txnType} transaction.`, consequences: ["This transaction type requires review because the MVP has no detailed interpreter for it."] });
      pushFinding(findings, { code: "UNSUPPORTED_TRANSACTION_TYPE", severity: "medium", transactionIndex, message: `Transaction type ${txnType} is not fully interpreted by the MVP.` });
    }

    if (rekeyTo !== undefined) pushFinding(findings, { code: "REKEY_PRESENT", severity: "critical", transactionIndex, message: `The account's authorized signer will change to ${rekeyTo}.` });
    if (closeRemainderTo !== undefined) pushFinding(findings, { code: "ALGO_CLOSE_OUT", severity: "critical", transactionIndex, message: `The sender's remaining ALGO will close out to ${closeRemainderTo}.` });
    if (assetCloseTo !== undefined) pushFinding(findings, { code: "ASSET_CLOSE_OUT", severity: "critical", transactionIndex, message: `The remaining asset balance will close out to ${assetCloseTo}.` });
  }

  const algoLimitBreached = policy.maxAlgoSend !== undefined && algoSent > BigInt(Math.round(policy.maxAlgoSend * MICROALGOS_PER_ALGO));
  const usdcLimitBreached = policy.maxUsdcSend !== undefined && usdcSent > BigInt(Math.round(policy.maxUsdcSend * MICROALGOS_PER_ALGO));
  const unapprovedAssetIds = policy.allowedAssetIds === undefined
    ? []
    : [...assetIds].filter((assetId) => !policy.allowedAssetIds!.includes(assetId));
  if (algoLimitBreached) pushFinding(findings, { code: "ALGO_LIMIT_EXCEEDED", severity: "high", transactionIndex: 0, message: `This group sends more than the ${policy.maxAlgoSend} ALGO policy limit.` });
  if (usdcLimitBreached) pushFinding(findings, { code: "USDC_LIMIT_EXCEEDED", severity: "high", transactionIndex: 0, message: `This group sends more than the ${policy.maxUsdcSend} USDC policy limit.` });
  for (const assetId of unapprovedAssetIds) {
    pushFinding(findings, { code: "ASSET_NOT_ALLOWLISTED", severity: "high", transactionIndex: assetTransactionIndexes.get(assetId) ?? 0, message: `Asset ${assetId} is not on the configured asset allowlist.` });
  }
  const prohibitedAdminAction = policy.prohibitAdminActions === true && findings.some((finding) => ADMIN_ACTION_CODES.has(finding.code));
  if (prohibitedAdminAction) {
    const action = findings.find((finding) => ADMIN_ACTION_CODES.has(finding.code));
    pushFinding(findings, { code: "ADMIN_ACTION_PROHIBITED", severity: "high", transactionIndex: action?.transactionIndex ?? 0, message: "This group includes an administrative action prohibited by the selected policy." });
  }

  addPolicy(policyEvaluation, "allowRekey", findings.some((finding) => finding.code === "REKEY_PRESENT") && !effectivePolicy.allowRekey, policy.allowRekey !== undefined);
  addPolicy(policyEvaluation, "allowCloseOut", findings.some((finding) => finding.code === "ALGO_CLOSE_OUT" || finding.code === "ASSET_CLOSE_OUT") && !effectivePolicy.allowCloseOut, policy.allowCloseOut !== undefined);
  addPolicy(policyEvaluation, "maxAlgoSend", algoLimitBreached, policy.maxAlgoSend !== undefined);
  addPolicy(policyEvaluation, "maxUsdcSend", usdcLimitBreached, policy.maxUsdcSend !== undefined);
  addPolicy(policyEvaluation, "allowUnknownApps", findings.some((finding) => finding.code === "UNKNOWN_APPLICATION") && !effectivePolicy.allowUnknownApps, policy.allowedApplicationIds !== undefined || policy.allowUnknownApps !== undefined);
  addPolicy(policyEvaluation, "allowedAssetIds", unapprovedAssetIds.length > 0, policy.allowedAssetIds !== undefined);
  addPolicy(policyEvaluation, "prohibitAdminActions", prohibitedAdminAction, policy.prohibitAdminActions !== undefined);

  const hasUnapprovedRekey = findings.some((finding) => finding.code === "REKEY_PRESENT") && !effectivePolicy.allowRekey;
  const hasUnapprovedCloseOut = findings.some((finding) => finding.code === "ALGO_CLOSE_OUT" || finding.code === "ASSET_CLOSE_OUT") && !effectivePolicy.allowCloseOut;
  const hasBlocker = hasUnapprovedRekey || hasUnapprovedCloseOut || algoLimitBreached || usdcLimitBreached || unapprovedAssetIds.length > 0 || prohibitedAdminAction;
  const verdict: Verdict = hasBlocker ? "block" : findings.length > 0 ? "review" : "allow";
  const riskScore = Math.min(100, findings.reduce((score, finding) => score + ({ low: 10, medium: 25, high: 50, critical: 80 }[finding.severity]), 0));
  const summary = verdict === "allow"
    ? "No configured rule triggered; independently verify this transaction before signing."
    : `MicroVern found ${findings.length} condition${findings.length === 1 ? "" : "s"} that ${verdict === "block" ? "block" : "require"} review.`;

  const reviewSummary: ReviewSummary = {
    transactionCount: transactions.length,
    totalAlgoSent: formatAmount(algoSent),
    totalUsdcSent: formatAmount(usdcSent),
    totalFeeAlgo: formatAmount(totalFee),
    recipients: [...recipients].sort(),
    assetIds: [...assetIds].sort((left, right) => left - right),
  };
  const analysis: InspectionAnalysis = {
    verdict,
    riskScore,
    summary,
    reviewSummary,
    actions,
    findings,
    policyEvaluation,
    ...(policyProfile === undefined ? {} : { policyProfile }),
    rulesetVersion: RULESET_VERSION,
    disclaimer: "MicroVern is an automated analysis tool, not a guarantee of safety or financial advice.",
  };
  return bindInspectionReport(bindingRequest, analysis);
}
