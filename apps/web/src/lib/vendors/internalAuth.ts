import { createHash, timingSafeEqual } from "node:crypto";

export const INTERNAL_VENDOR_TOKEN_HEADER = "x-internal-token";

const MIN_SECRET_LENGTH = 32;
const MAX_TOKEN_LENGTH = 512;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function resolveInternalApiToken(
  environment: {
    INTERNAL_API_TOKEN?: string;
    VENDOR_INTERNAL_TOKEN?: string;
  } = {
    INTERNAL_API_TOKEN: process.env.INTERNAL_API_TOKEN,
    VENDOR_INTERNAL_TOKEN: process.env.VENDOR_INTERNAL_TOKEN,
  },
): string {
  const canonicalSecret = environment.INTERNAL_API_TOKEN ?? "";
  const legacySecret = environment.VENDOR_INTERNAL_TOKEN ?? "";
  if (
    canonicalSecret.length > 0
    && legacySecret.length > 0
    && canonicalSecret !== legacySecret
  ) {
    return "";
  }
  return canonicalSecret || legacySecret;
}

export function verifyInternalVendorRequest(
  request: Request,
  configuredSecret = resolveInternalApiToken(),
): boolean {
  const received = request.headers.get(INTERNAL_VENDOR_TOKEN_HEADER) ?? "";
  if (
    configuredSecret.length < MIN_SECRET_LENGTH
    || received.length === 0
    || received.length > MAX_TOKEN_LENGTH
  ) {
    return false;
  }

  return timingSafeEqual(digest(received), digest(configuredSecret));
}
