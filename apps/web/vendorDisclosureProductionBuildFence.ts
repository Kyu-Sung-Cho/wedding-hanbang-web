import {
  SuccessorReleaseContractError,
  validateSuccessorReleaseContract,
} from "../../scripts/lib/supabase-successor-release-contract.mjs";

export const VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID =
  "VENDOR_DISCLOSURE_STATIC_RELEASE_CONTRACT_INVALID";
export const VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED =
  "VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED";

export class VendorDisclosureProductionBuildBlocked extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`VENDOR_DISCLOSURE_PRODUCTION_BUILD_BLOCKED: ${code}: ${message}`);
    this.name = "VendorDisclosureProductionBuildBlocked";
    this.code = code;
  }
}

function blocked(code: string, message: string): never {
  throw new VendorDisclosureProductionBuildBlocked(code, message);
}

/**
 * Interim production-only fence.
 *
 * The repository's shared successor validator is the only source of truth for
 * the static predecessor and migration contract. Passing that static contract
 * is necessary, but it is not deployment authorization. Production remains
 * fail-closed until a reviewed controller and external signed authorization
 * verifier are implemented together.
 */
export function assertVendorDisclosureProductionBuild({
  repoRoot,
  environment = process.env,
}: {
  repoRoot: string;
  environment?: Record<string, string | undefined>;
}): void {
  if (environment.VERCEL_ENV !== "production") return;

  try {
    validateSuccessorReleaseContract({ repoRoot });
  } catch (error) {
    if (error instanceof SuccessorReleaseContractError) {
      blocked(
        VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID,
        `shared successor release contract rejected the production build (${error.code})`,
      );
    }
    blocked(
      VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID,
      "shared successor release contract could not be verified",
    );
  }

  blocked(
    VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED,
    "static validation is not production authorization; an external signed authorization verifier and successor release controller are not implemented",
  );
}
