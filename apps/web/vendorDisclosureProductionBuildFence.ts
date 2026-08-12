import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SuccessorReleaseContractError,
  validateSuccessorReleaseContract,
} from "../../scripts/lib/supabase-successor-release-contract.mjs";

export const VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID =
  "VENDOR_DISCLOSURE_STATIC_RELEASE_CONTRACT_INVALID";
export const VENDOR_DISCLOSURE_CONTROLLER_NOT_READY =
  "VENDOR_DISCLOSURE_RELEASE_CONTROLLER_NOT_READY";
export const VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED =
  "VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED";
export const VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID =
  "VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID";

const RELEASE_MANIFEST_RELATIVE_PATH =
  "supabase/release-manifests/vendor-disclosure-v2-20260718.json";

/** 소유자가 서명해야 하는 값: 릴리스 매니페스트 파일(개행 정규화)의 sha256. */
export function expectedProductionAuthorizationSha256(repoRoot: string): string {
  const manifest = readFileSync(
    join(repoRoot, RELEASE_MANIFEST_RELATIVE_PATH),
    "utf8",
  );
  return createHash("sha256")
    .update(manifest.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

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
 * is necessary, but it is not deployment authorization. Production opens only
 * when that validator returns a pinned controller-ready contract and the owner
 * separately pins the exact release manifest hash.
 */
export function assertVendorDisclosureProductionBuild({
  repoRoot,
  environment = process.env,
}: {
  repoRoot: string;
  environment?: Record<string, string | undefined>;
}): void {
  if (environment.VERCEL_ENV !== "production") return;

  let releaseContract;
  try {
    releaseContract = validateSuccessorReleaseContract({ repoRoot });
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

  if (
    releaseContract.deploymentBlocked !== false
    || releaseContract.controllerReady !== true
    || !releaseContract.controllerManifest
  ) {
    blocked(
      VENDOR_DISCLOSURE_CONTROLLER_NOT_READY,
      "the successor release is not controller-ready; hosted evidence contracts and the pinned controller manifest must be complete before production authorization",
    );
  }

  // 외부 서명 승인: 소유자가 릴리스 매니페스트 sha256을 배포 환경에 직접 핀해야
  // 프로덕션 빌드가 열린다. 값 부재·불일치 모두 fail-closed.
  const authorization = environment.VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION;
  if (!authorization) {
    blocked(
      VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED,
      "static validation is not production authorization; set VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION to the release manifest sha256 to sign this deployment",
    );
  }
  if (authorization !== expectedProductionAuthorizationSha256(repoRoot)) {
    blocked(
      VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID,
      "VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION does not match the release manifest sha256",
    );
  }
}
