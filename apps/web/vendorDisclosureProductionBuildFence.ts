import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SuccessorReleaseContractError,
  validateSuccessorReleaseContract,
} from "../../scripts/lib/supabase-successor-release-contract.mjs";

export const VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID =
  "VENDOR_DISCLOSURE_STATIC_RELEASE_CONTRACT_INVALID";
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
 * when the owner pins the exact release manifest hash.
 *
 * 2026-08-11: 여기에 `controllerReady` 요구가 하나 더 있었다(2026-08-08 `7f437003`).
 * 그 조건은 후속 릴리스 매니페스트의 status가 `deployment_blocked`인 한 절대 참이
 * 되지 않는데, 그 status는 **운영 DB 쓰기 봉인 그 자체**다
 * (`docs/operations/VENDOR_DISCLOSURE_V2_MANIFEST_RETIREMENT_2026-08-08.md`).
 * 결과적으로 "웹을 배포하려면 먼저 운영 DB 쓰기를 열어라"가 되어 2026-08-08부터
 * 웹 프로덕션 빌드가 전부 실패했고, 3주치 변경이 사용자에게 가지 못했다.
 * 파운더 결정으로 그 조건을 뺐다. DB 릴리스 통제는 릴리스 컨트롤러가 계속 맡는다.
 *
 * ⚠️ 그 조건이 우연히 막아 주던 진짜 위험은 남아 있다 — **코드가 요구하는
 * 마이그레이션이 운영 DB에 적용되지 않은 채 배포되는 것.** 빌드 시점에는 운영
 * DB를 조회하지 않으므로(그래서도 안 된다) 이 판단은 사람이 한다. 아래 서명은
 * 그 판단의 자리다: `VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION`을 핀한다는 것은
 * **이 매니페스트의 `expandMigrations`가 운영 DB에 적용된 것을 확인했다**는 뜻이다.
 * 매니페스트가 바뀌면 해시가 바뀌어 서명이 무효가 되므로, 마이그레이션이 늘 때마다
 * 이 확인을 다시 하게 된다.
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

  // 외부 서명 승인: 소유자가 릴리스 매니페스트 sha256을 배포 환경에 직접 핀해야
  // 프로덕션 빌드가 열린다. 값 부재·불일치 모두 fail-closed.
  // 이 값을 넣는다는 것은 위 ⚠️ 의 확인을 마쳤다는 선언이다.
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
