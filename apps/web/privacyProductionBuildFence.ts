export const PRIVACY_CROSS_BORDER_NOTICE_NOT_APPROVED =
  "PRIVACY_CROSS_BORDER_NOTICE_NOT_APPROVED";

export class PrivacyProductionBuildBlocked extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`PRIVACY_PRODUCTION_BUILD_BLOCKED: ${code}: ${message}`);
    this.name = "PrivacyProductionBuildBlocked";
    this.code = code;
  }
}

/**
 * Production is intentionally fail-closed until the real processor contracts,
 * deployment regions, transfer timing/method, retention, contact details, and
 * refusal effects have been reviewed and published. An environment variable is
 * not accepted as legal approval or release evidence.
 */
export function assertPrivacyProductionBuild({
  environment = process.env,
}: {
  environment?: Record<string, string | undefined>;
} = {}): void {
  if (environment.VERCEL_ENV !== "production") return;

  throw new PrivacyProductionBuildBlocked(
    PRIVACY_CROSS_BORDER_NOTICE_NOT_APPROVED,
    "the cross-border transfer notice and processor retention contract are not approved",
  );
}
