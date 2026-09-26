const ADDRESS_PATTERN = /^[A-Z2-7]{58}$/;
const NETWORKS = new Set(["algorand-mainnet", "algorand-testnet"]);

function parseDecimalMicros(value, label) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,6})?$/u.test(value)) {
    throw new Error(`${label} must be a non-negative decimal with at most 6 places.`);
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(`${fraction}000000`.slice(0, 6));
}

function displayAmount(value) {
  const [whole, fraction] = value.split(".");
  if (fraction === undefined) return whole;
  const trimmedFraction = fraction.replace(/0+$/u, "");
  return trimmedFraction.length === 0 ? whole : `${whole}.${trimmedFraction}`;
}

function validReport(report) {
  return typeof report === "object" && report !== null
    && typeof report.reviewSummary === "object" && report.reviewSummary !== null
    && Array.isArray(report.reviewSummary.recipients)
    && typeof report.reviewSummary.totalAlgoSent === "string"
    && typeof report.reviewSummary.totalUsdcSent === "string";
}

function validRequest(request) {
  return typeof request === "object" && request !== null && NETWORKS.has(request.network);
}

export function parseRecipientIntent(value) {
  const recipients = [...new Set(value.split(",").map((recipient) => recipient.trim()).filter(Boolean))];
  if (recipients.some((recipient) => !ADDRESS_PATTERN.test(recipient))) {
    throw new Error("Expected recipients must be comma-separated Algorand addresses.");
  }
  return recipients;
}

export function parseAssetIntent(value) {
  const assetIds = [...new Set(value.split(",").map((assetId) => assetId.trim()).filter(Boolean))];
  if (assetIds.some((assetId) => !/^\d+$/u.test(assetId) || !Number.isSafeInteger(Number(assetId)))) {
    throw new Error("Expected asset IDs must be comma-separated non-negative integers.");
  }
  return assetIds.map(Number).sort((left, right) => left - right);
}

export function evaluateMicrovernIntent(intent, report, request, now = new Date()) {
  if (!validReport(report)) throw new Error("A complete MicroVern report with totals and recipients is required.");
  if (typeof intent !== "object" || intent === null) throw new Error("Intent must be an object.");

  const checks = [];
  const expectedRecipients = intent.recipients ?? [];
  if (!Array.isArray(expectedRecipients) || expectedRecipients.some((recipient) => typeof recipient !== "string" || !ADDRESS_PATTERN.test(recipient))) {
    throw new Error("Intent recipients must be valid Algorand addresses.");
  }
  if (expectedRecipients.length > 0) {
    const actualRecipients = [...new Set(report.reviewSummary.recipients)];
    const unexpected = actualRecipients.filter((recipient) => !expectedRecipients.includes(recipient));
    const missing = expectedRecipients.filter((recipient) => !actualRecipients.includes(recipient));
    checks.push({ key: "recipients", status: unexpected.length === 0 && missing.length === 0 ? "matched" : "mismatch", message: unexpected.length || missing.length ? `Recipient mismatch. Unexpected: ${unexpected.join(", ") || "none"}. Missing: ${missing.join(", ") || "none"}.` : "Recipients match the declared intent." });
  }

  if (intent.assetIds !== undefined) {
    if (!Array.isArray(intent.assetIds) || intent.assetIds.some((assetId) => !Number.isSafeInteger(assetId) || assetId < 0)) {
      throw new Error("Intent asset IDs must be non-negative integers.");
    }
    const expectedAssetIds = [...new Set(intent.assetIds)].sort((left, right) => left - right);
    const reportedAssetIds = report.reviewSummary.assetIds;
    const actualAssetIds = Array.isArray(reportedAssetIds)
      && reportedAssetIds.every((assetId) => Number.isSafeInteger(assetId) && assetId >= 0)
      ? [...new Set(reportedAssetIds)].sort((left, right) => left - right)
      : undefined;
    const matches = actualAssetIds !== undefined
      && actualAssetIds.length === expectedAssetIds.length
      && actualAssetIds.every((assetId, index) => assetId === expectedAssetIds[index]);
    checks.push({ key: "assetIds", status: matches ? "matched" : "mismatch", message: actualAssetIds === undefined ? "Asset IDs could not be verified because this report is missing a valid asset summary." : matches ? `Asset IDs match the declared intent: ${actualAssetIds.join(", ") || "none"}.` : `Asset ID mismatch. Expected: ${expectedAssetIds.join(", ") || "none"}. Reported: ${actualAssetIds.join(", ") || "none"}.` });
  }

  for (const [intentKey, reportKey, label] of [["maxAlgoSend", "totalAlgoSent", "ALGO"], ["maxUsdcSend", "totalUsdcSent", "USDC"]]) {
    if (intent[intentKey] !== undefined) {
      const maximum = parseDecimalMicros(String(intent[intentKey]), `Maximum ${label}`);
      const actual = parseDecimalMicros(report.reviewSummary[reportKey], `Reported ${label}`);
      checks.push({ key: intentKey, status: actual <= maximum ? "matched" : "mismatch", message: actual <= maximum ? `${label} total ${displayAmount(report.reviewSummary[reportKey])} is within the declared maximum ${displayAmount(String(intent[intentKey]))}.` : `${label} total ${displayAmount(report.reviewSummary[reportKey])} exceeds the declared maximum ${displayAmount(String(intent[intentKey]))}.` });
    }
  }

  if (intent.network !== undefined) {
    if (!NETWORKS.has(intent.network)) throw new Error("Intent network must be Algorand MainNet or TestNet.");
    checks.push({ key: "network", status: validRequest(request) && request.network === intent.network ? "matched" : "mismatch", message: !validRequest(request) ? "Network could not be verified because the original request was not provided." : request.network === intent.network ? `Request network matches ${intent.network}.` : `Request network ${request.network} does not match expected ${intent.network}.` });
  }

  if (intent.expiresAt !== undefined) {
    const expiry = new Date(intent.expiresAt);
    if (Number.isNaN(expiry.getTime())) throw new Error("Intent expiry must be a valid date and time.");
    checks.push({ key: "expiry", status: now.getTime() <= expiry.getTime() ? "matched" : "mismatch", message: now.getTime() <= expiry.getTime() ? `Intent remains valid until ${expiry.toLocaleString()}.` : `Intent expired at ${expiry.toLocaleString()}.` });
  }

  if (checks.length === 0) throw new Error("Declare at least one recipient, amount limit, network, or expiry before checking intent.");
  return { matches: checks.every((check) => check.status === "matched"), checks };
}
