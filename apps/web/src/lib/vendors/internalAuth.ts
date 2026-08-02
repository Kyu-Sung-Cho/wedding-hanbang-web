import { createHash, timingSafeEqual } from "node:crypto";

import {
  isValidServerSecret,
  resolveAliasedServerSecret,
} from "@hanbang/shared/security/server-secret-policy";

export const INTERNAL_VENDOR_TOKEN_HEADER = "x-internal-token";

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
  return resolveAliasedServerSecret(
    environment.INTERNAL_API_TOKEN,
    environment.VENDOR_INTERNAL_TOKEN,
  );
}

export function verifyInternalVendorRequest(
  request: Request,
  configuredSecret = resolveInternalApiToken(),
): boolean {
  const received = request.headers.get(INTERNAL_VENDOR_TOKEN_HEADER) ?? "";
  if (!isValidServerSecret(configuredSecret) || !isValidServerSecret(received)) {
    return false;
  }

  return timingSafeEqual(digest(received), digest(configuredSecret));
}
