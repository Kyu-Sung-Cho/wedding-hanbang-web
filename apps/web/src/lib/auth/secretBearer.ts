import { createHash, timingSafeEqual } from "node:crypto";

import { isValidServerSecret } from "@hanbang/shared/security/server-secret-policy";

import { parseAuthorizationHeader } from "@/utils/bearerAuthorization";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Verify server-to-server Bearer credentials without variable-length secret
 * comparison. Weak, malformed, or oversized credentials fail closed even if
 * an environment variable was accidentally populated with them.
 */
export function verifySecretBearerRequest(
  request: Request,
  configuredSecret: string | undefined,
): boolean {
  if (!isValidServerSecret(configuredSecret)) {
    return false;
  }

  const authorization = parseAuthorizationHeader(
    request.headers.get("authorization"),
  );
  if (
    authorization.kind !== "bearer"
    || !isValidServerSecret(authorization.token)
  ) {
    return false;
  }

  return timingSafeEqual(
    digest(authorization.token),
    digest(configuredSecret),
  );
}
