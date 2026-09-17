import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SuccessorReleaseContractError,
  validateSuccessorReleaseContract,
} from "../../scripts/lib/supabase-successor-release-contract.mjs";
import { BUDGET_DECISION_CONTRACT_FILE } from "../../scripts/lib/amora-budget-decision-release-contract.mjs";
import { EXPLICIT_BUDGET_CONTRACT_FILE } from "../../scripts/lib/amora-explicit-budget-release-contract.mjs";
import { PROFILE_AVATAR_CONTRACT_FILE } from "../../scripts/lib/profile-avatar-release-contract.mjs";
import { CUSTOMER_DATA_CONTRACT_FILE } from "../../scripts/lib/account-deletion-customer-data-release-contract.mjs";
import { NOT_APPLICABLE_STATUS_CONTRACT_FILE } from "../../scripts/lib/amora-not-applicable-status-release-contract.mjs";
import { WEDDING_CODE_RESEARCH_CONTRACT_FILE } from "../../scripts/lib/wedding-code-research-contributions-release-contract.mjs";
import { WEDDING_CODE_SCENE_VERSION_CONTRACT_FILE } from "../../scripts/lib/wedding-code-research-scene-v09-release-contract.mjs";
import { PROFILE_WEDDING_ROLES_CONTRACT_FILE } from "../../scripts/lib/profile-wedding-roles-release-contract.mjs";
import { CHAT_FEEDBACK_CONTRACT_FILE } from "../../scripts/lib/chat-feedback-nullability-release-contract.mjs";

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
    // 등록된 후속 계약이 있으면 그 exact SQL까지 검사한다. 검증 실패 후
    // 구 경로로 재시도하지 않으며, 계약이 없는 과거 checkout은 기존 검사를 유지한다.
    releaseContract = validateSuccessorReleaseContract({
      repoRoot,
      followup: existsSync(join(repoRoot, WEDDING_CODE_SCENE_VERSION_CONTRACT_FILE))
        ? "wedding-code-research-scene-v09"
        : existsSync(join(repoRoot, WEDDING_CODE_RESEARCH_CONTRACT_FILE))
        ? "wedding-code-research-contributions"
        : existsSync(join(repoRoot, NOT_APPLICABLE_STATUS_CONTRACT_FILE))
        ? "amora-not-applicable-status"
        : existsSync(join(repoRoot, CUSTOMER_DATA_CONTRACT_FILE))
        ? "account-deletion-customer-data"
        : existsSync(join(repoRoot, PROFILE_AVATAR_CONTRACT_FILE))
        ? "profile-avatar"
        : existsSync(join(repoRoot, PROFILE_WEDDING_ROLES_CONTRACT_FILE))
        ? "profile-wedding-roles"
        : existsSync(join(repoRoot, CHAT_FEEDBACK_CONTRACT_FILE))
        ? "chat-feedback-nullability"
        : existsSync(join(repoRoot, EXPLICIT_BUDGET_CONTRACT_FILE))
          ? "amora-explicit-budget-hotfix"
          : existsSync(join(repoRoot, BUDGET_DECISION_CONTRACT_FILE))
            ? "amora-budget-decision-hotfix"
            : null,
    });
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

  // ── controller-ready 요구는 **유예 중이다** (2026-08-08) ─────────────────────
  //
  // 이 검사는 벤더 공시 v2 릴리스를 위한 것이고, 매니페스트가
  // `deployment_blocked`인 한 무조건 실패한다. 그 상태를 벗어나려면 호스팅 증거
  // 5종(backup·storage 각 30분 신선도, hostedStaging, 별도 프로젝트 파괴적
  // hostedRestore, finalizer 리허설)이 전부 있어야 한다.
  //
  // 문제는 이 검사가 **모든 프로덕션 빌드**를 막는다는 것이다. 벤더 공시와 무관한
  // 변경(아모라, 랜딩)까지 그 릴리스 일정에 묶인다. 실제로 2026-08-08에 아모라
  // 릴리스가 여기서 막혔고, 그 사이 다른 작업도 전부 배포되지 못했다.
  //
  // 이 단계는 2026-08-08 병합으로 **새로 추가된 것**이다. 그전까지 이 펜스는
  // 정적 계약 + 소유자 서명 2단이었고 프로덕션은 그 기준으로 배포돼 왔다.
  // 지금은 그 2단 기준으로 되돌려 둔다 — 없애는 게 아니라 **적용을 미루는 것**이다.
  //
  // **되살릴 시점**: 벤더 공시 v2를 실제로 공개할 때. 그때 매니페스트가
  // `controller_ready`가 되고 증거 5종이 채워지므로 이 블록을 그대로 복원하면 된다.
  // 그전에 복원하면 무엇도 배포할 수 없다.
  //
  // 계속 지키는 것: 정적 마이그레이션 계약(위)과 소유자 서명(아래). 즉 매니페스트에
  // 등록되지 않은 마이그레이션이 섞이거나 소유자가 서명하지 않은 빌드는 여전히 막힌다.
  const enforceControllerReady = false;
  if (
    enforceControllerReady
    && (
      releaseContract.deploymentBlocked !== false
      || releaseContract.controllerReady !== true
      || !releaseContract.controllerManifest
    )
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
