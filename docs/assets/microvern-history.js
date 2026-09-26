const HISTORY_STORAGE_KEY = "microvern.private-report-history.v1";
const REPORT_ID_PATTERN = /^[a-f0-9]{64}$/u;
const TRANSACTION_ID_PATTERN = /^[A-Z2-7]{52}$/u;
const MAX_RECORDS = 40;
const MAX_HISTORY_BYTES = 1_000_000;

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "unsignedTransactionGroup")
    .map(([key, item]) => [key, sanitizeValue(item)]));
}

function requiredReport(report) {
  if (!isObject(report) || !["allow", "review", "block"].includes(report.verdict) || !REPORT_ID_PATTERN.test(report.requestHash) || !REPORT_ID_PATTERN.test(report.reportChecksum)) {
    throw new Error("A complete MicroVern inspection report is required.");
  }
  const safeReport = {
    verdict: report.verdict,
    riskScore: report.riskScore,
    summary: report.summary,
    reviewSummary: report.reviewSummary,
    actions: report.actions,
    findings: report.findings,
    policyEvaluation: report.policyEvaluation,
    rulesetVersion: report.rulesetVersion,
    disclaimer: report.disclaimer,
    requestHash: report.requestHash,
    reportChecksum: report.reportChecksum,
  };
  return sanitizeValue(safeReport);
}

function normalizeRecord(record) {
  if (!isObject(record) || typeof record.savedAt !== "string") throw new Error("format");
  const report = requiredReport(record.report);
  if (record.paymentTransactionId !== undefined && (typeof record.paymentTransactionId !== "string" || !TRANSACTION_ID_PATTERN.test(record.paymentTransactionId))) {
    throw new Error("format");
  }
  return {
    reportId: report.requestHash,
    savedAt: record.savedAt,
    report,
    ...(record.paymentTransactionId === undefined ? {} : { paymentTransactionId: record.paymentTransactionId }),
  };
}

export function readPrivateReportHistory(storage = globalThis.localStorage) {
  const raw = storage.getItem(HISTORY_STORAGE_KEY);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.records)) throw new Error("format");
    return parsed.records.map(normalizeRecord).sort((left, right) => right.savedAt.localeCompare(left.savedAt));
  } catch {
    throw new Error("Private report history could not be read. It was left unchanged.");
  }
}

function writeRecords(records, storage) {
  const normalized = records.map(normalizeRecord).sort((left, right) => right.savedAt.localeCompare(left.savedAt)).slice(0, MAX_RECORDS);
  const encoded = JSON.stringify({ version: 1, records: normalized });
  if (new TextEncoder().encode(encoded).byteLength > MAX_HISTORY_BYTES) {
    throw new Error("This report history is too large to store safely in this browser. Download the report instead.");
  }
  storage.setItem(HISTORY_STORAGE_KEY, encoded);
  return normalized;
}

/** Saves only a sanitized report; the original unsigned request is never retained. */
export function savePrivateReport(record, storage = globalThis.localStorage, now = new Date()) {
  const report = requiredReport(record?.report);
  if (record?.paymentTransactionId !== undefined && (typeof record.paymentTransactionId !== "string" || !TRANSACTION_ID_PATTERN.test(record.paymentTransactionId))) {
    throw new Error("Payment transaction ID must be a 52-character Algorand transaction ID.");
  }
  const existing = readPrivateReportHistory(storage).filter((item) => item.reportId !== report.requestHash);
  const saved = {
    reportId: report.requestHash,
    savedAt: now.toISOString(),
    report,
    ...(record.paymentTransactionId === undefined ? {} : { paymentTransactionId: record.paymentTransactionId }),
  };
  return writeRecords([saved, ...existing], storage);
}

export function removePrivateReport(reportId, storage = globalThis.localStorage) {
  if (typeof reportId !== "string" || !REPORT_ID_PATTERN.test(reportId)) throw new Error("Report ID is invalid.");
  return writeRecords(readPrivateReportHistory(storage).filter((record) => record.reportId !== reportId), storage);
}

export function clearPrivateReportHistory(storage = globalThis.localStorage) {
  storage.removeItem(HISTORY_STORAGE_KEY);
}
