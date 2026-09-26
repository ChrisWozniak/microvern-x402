const SHARE_VERSION = 1;
const MAX_SHARE_FRAGMENT_LENGTH = 16_000;
const TRANSACTION_ID_PATTERN = /^[A-Z2-7]{52}$/;

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("The shared review link is not valid.");
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("The shared review could not be decoded.");
  }
}

function validReport(value) {
  return isObject(value)
    && ["allow", "review", "block"].includes(value.verdict)
    && typeof value.requestHash === "string"
    && /^[a-f0-9]{64}$/u.test(value.requestHash)
    && typeof value.reportChecksum === "string"
    && /^[a-f0-9]{64}$/u.test(value.reportChecksum);
}

function validRequest(value) {
  return isObject(value)
    && (value.network === "algorand-mainnet" || value.network === "algorand-testnet")
    && typeof value.unsignedTransactionGroup === "string";
}

function parsePayload(value) {
  if (!isObject(value) || value.version !== SHARE_VERSION || !validReport(value.report)) {
    throw new Error("This link does not contain a valid MicroVern inspection report.");
  }
  if (value.request !== undefined && !validRequest(value.request)) {
    throw new Error("The shared review contains an invalid original request.");
  }
  if (value.paymentTransactionId !== undefined && (
    typeof value.paymentTransactionId !== "string" || !TRANSACTION_ID_PATTERN.test(value.paymentTransactionId)
  )) {
    throw new Error("The shared review contains an invalid payment transaction ID.");
  }
  if (Object.keys(value).some((key) => !["version", "report", "request", "paymentTransactionId"].includes(key))) {
    throw new Error("The shared review contains unsupported data.");
  }
  return value;
}

export function createMicrovernShareLink({ report, request, paymentTransactionId }, pageUrl) {
  if (!validReport(report)) throw new Error("Display a complete MicroVern inspection report before sharing it.");
  if (request !== undefined && !validRequest(request)) throw new Error("The original request must be a valid MicroVern request.");
  if (paymentTransactionId !== undefined && (
    typeof paymentTransactionId !== "string" || !TRANSACTION_ID_PATTERN.test(paymentTransactionId)
  )) {
    throw new Error("Payment transaction ID must be a 52-character Algorand transaction ID.");
  }

  const payload = {
    version: SHARE_VERSION,
    report,
    ...(request === undefined ? {} : { request }),
    ...(paymentTransactionId === undefined ? {} : { paymentTransactionId }),
  };
  const fragment = `review=${encodeBase64Url(payload)}`;
  if (fragment.length > MAX_SHARE_FRAGMENT_LENGTH) {
    throw new Error("This review is too large for a dependable share link. Download the report instead, or share it without the original request.");
  }
  const url = new URL(pageUrl);
  url.hash = fragment;
  return url.toString();
}

export function readMicrovernShareLink(pageUrl) {
  const url = new URL(pageUrl);
  const fragment = new URLSearchParams(url.hash.slice(1)).get("review");
  if (fragment === null) return undefined;
  return parsePayload(decodeBase64Url(fragment));
}
