import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

import { isValidServerSecret } from "@hanbang/shared/security/server-secret-policy";
import { CURRENT_PRIVACY_VERSION } from "@hanbang/shared/constants";

import { getSignupSiteOrigin } from "@/lib/auth/signupConfirmationLink";
import { isRecord, normalizeEmail } from "@/utils/requestValidation";

export const PREREGISTRATION_INTENT_TTL_MINUTES = 30;
export const PREREGISTRATION_INTENT_RPC = "issue_preregistration_intent";
export const READ_PREREGISTRATION_INTENT_RPC = "read_preregistration_intent";
export const CONFIRM_PREREGISTRATION_INTENT_RPC = "confirm_preregistration_intent";
export const REVOKE_PREREGISTRATION_INTENT_RPC = "revoke_preregistration_intent";
export const PURGE_PREREGISTRATION_INTENTS_RPC = "purge_expired_preregistration_intents";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_CIPHERTEXT_BYTES = 8 * 1024;
const ENVELOPE_PATTERN = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{16,10923}$/u;
const ROLE_VALUES = new Set(["bride", "groom"]);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export interface PreregistrationIntentPayload {
  email: string;
  name: string | null;
  weddingDate: string | null;
  role: "bride" | "groom";
  message: string | null;
  isBetaCandidate: boolean;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  privacyVersion: typeof CURRENT_PRIVACY_VERSION;
}

function deriveKey(secret: string | undefined, purpose: string): Buffer | null {
  if (!isValidServerSecret(secret)) return null;
  return createHash("sha256")
    .update("hanbang-preregistration-intent-v1\0", "utf8")
    .update(purpose, "utf8")
    .update("\0", "utf8")
    .update(secret, "utf8")
    .digest();
}

function encryptionKey(): Buffer | null {
  return deriveKey(
    process.env.PREREGISTRATION_INTENT_ENCRYPTION_KEY,
    "aes-256-gcm",
  );
}

function lookupKey(): Buffer | null {
  return deriveKey(
    process.env.PREREGISTRATION_INTENT_ENCRYPTION_KEY,
    "email-lookup-hmac-sha256",
  );
}

export function isPreregistrationIntentEncryptionConfigured(): boolean {
  return encryptionKey() !== null && lookupKey() !== null;
}

function aad(): Buffer {
  return Buffer.from(
    `hanbang-preregistration-intent-v1\0${CURRENT_PRIVACY_VERSION}`,
    "utf8",
  );
}

function validOptionalText(value: unknown, maxLength: number): value is string | null {
  return value === null
    || (typeof value === "string" && value.length > 0 && value.length <= maxLength);
}

function validIsoDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parsePayload(value: unknown): PreregistrationIntentPayload | null {
  if (!isRecord(value)) return null;
  const expectedKeys = [
    "email",
    "name",
    "weddingDate",
    "role",
    "message",
    "isBetaCandidate",
    "utmSource",
    "utmMedium",
    "utmCampaign",
    "privacyVersion",
  ];
  const keys = Object.keys(value).sort();
  if (keys.length !== expectedKeys.length) return null;
  if (keys.some((key, index) => key !== [...expectedKeys].sort()[index])) return null;

  const email = normalizeEmail(value.email);
  if (
    !email
    || email !== value.email
    || !validOptionalText(value.name, 60)
    || !validIsoDate(value.weddingDate)
    || typeof value.role !== "string"
    || !ROLE_VALUES.has(value.role)
    || !validOptionalText(value.message, 500)
    || typeof value.isBetaCandidate !== "boolean"
    || !validOptionalText(value.utmSource, 80)
    || !validOptionalText(value.utmMedium, 80)
    || !validOptionalText(value.utmCampaign, 120)
    || value.privacyVersion !== CURRENT_PRIVACY_VERSION
  ) {
    return null;
  }

  return {
    email,
    name: value.name,
    weddingDate: value.weddingDate,
    role: value.role as "bride" | "groom",
    message: value.message,
    isBetaCandidate: value.isBetaCandidate,
    utmSource: value.utmSource,
    utmMedium: value.utmMedium,
    utmCampaign: value.utmCampaign,
    privacyVersion: CURRENT_PRIVACY_VERSION,
  };
}

export function createPreregistrationIntentToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isPreregistrationIntentToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export function digestPreregistrationIntentToken(token: unknown): string | null {
  if (!isPreregistrationIntentToken(token)) return null;
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function digestPreregistrationEmail(email: string): string | null {
  const normalized = normalizeEmail(email);
  const key = lookupKey();
  if (!normalized || !key) return null;
  return createHmac("sha256", key).update(normalized, "utf8").digest("hex");
}

export function encryptPreregistrationPayload(
  payload: PreregistrationIntentPayload,
): string | null {
  const normalized = parsePayload(payload);
  const key = encryptionKey();
  if (!normalized || !key) return null;

  const plaintext = Buffer.from(JSON.stringify(normalized), "utf8");
  if (plaintext.length === 0 || plaintext.length > MAX_CIPHERTEXT_BYTES) return null;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad());
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENVELOPE_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decodeCanonicalBase64Url(value: string): Buffer | null {
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.toString("base64url") === value ? decoded : null;
  } catch {
    return null;
  }
}

export function decryptPreregistrationPayload(
  envelope: unknown,
): PreregistrationIntentPayload | null {
  if (typeof envelope !== "string" || !ENVELOPE_PATTERN.test(envelope)) return null;
  const key = encryptionKey();
  if (!key) return null;

  const [, rawIv, rawTag, rawCiphertext] = envelope.split(".");
  try {
    const iv = decodeCanonicalBase64Url(rawIv!);
    const tag = decodeCanonicalBase64Url(rawTag!);
    const ciphertext = decodeCanonicalBase64Url(rawCiphertext!);
    if (
      iv === null
      || tag === null
      || ciphertext === null
      || iv.length !== IV_BYTES
      || tag.length !== TAG_BYTES
      || ciphertext.length === 0
      || ciphertext.length > MAX_CIPHERTEXT_BYTES
    ) {
      return null;
    }

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad());
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    if (plaintext.length === 0 || plaintext.length > MAX_CIPHERTEXT_BYTES) return null;
    return parsePayload(JSON.parse(plaintext.toString("utf8")) as unknown);
  } catch {
    return null;
  }
}

export function buildPreregistrationConfirmationLink(
  token: string,
  rawSiteUrl = process.env.NEXT_PUBLIC_SITE_URL,
  production = process.env.NODE_ENV === "production"
    || process.env.VERCEL_ENV === "production",
): string | null {
  if (!isPreregistrationIntentToken(token)) return null;
  const siteOrigin = getSignupSiteOrigin(
    rawSiteUrl ?? (production ? undefined : "http://localhost:3000"),
    production,
  );
  if (!siteOrigin) return null;

  const url = new URL("/preregister/confirm", siteOrigin);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

export function normalizePreregistrationConfirmationLink(
  rawLink: unknown,
  rawSiteUrl = process.env.NEXT_PUBLIC_SITE_URL,
  production = process.env.NODE_ENV === "production"
    || process.env.VERCEL_ENV === "production",
): string | null {
  if (typeof rawLink !== "string" || rawLink.length > 2048) return null;
  const siteOrigin = getSignupSiteOrigin(
    rawSiteUrl ?? (production ? undefined : "http://localhost:3000"),
    production,
  );
  if (!siteOrigin) return null;

  try {
    const url = new URL(rawLink);
    const fragment = new URLSearchParams(url.hash.slice(1));
    if (
      url.origin !== siteOrigin
      || url.pathname !== "/preregister/confirm"
      || url.username
      || url.password
      || url.search
      || [...fragment.keys()].length !== 1
      || !isPreregistrationIntentToken(fragment.get("token"))
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function isPreregistrationDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}
