import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const web = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const repo = (path: string) => readFileSync(resolve(process.cwd(), "../..", path), "utf8");

describe("account deletion availability contract", () => {
  it("keeps both the UI and authoritative server endpoint closed", () => {
    const sharedConstants = repo("packages/shared/src/constants/index.ts");
    const settings = web("src/app/(app)/settings/page.tsx");
    const mobileSettings = repo("apps/mobile/app/settings/index.tsx");
    const route = web("src/app/api/auth/delete/route.ts");

    expect(sharedConstants).not.toMatch(/PUBLIC_BETA_CAPABILITIES|accountDeletionRequests/);
    expect(settings).toContain("계정 삭제 기능 점검 중");
    expect(mobileSettings).toContain("계정 삭제 기능 점검 중");
    expect(settings).not.toContain("/api/auth/delete");
    expect(mobileSettings).not.toContain("/api/auth/delete");
    expect(settings).not.toMatch(/handleDeleteAccount|showDeleteModal/);
    expect(mobileSettings).not.toContain("handleDeleteAccount");
    expect(route).toContain("ACCOUNT_DELETION_UNAVAILABLE");
    expect(route).toContain("status: 503");
    expect(route).not.toMatch(
      /ACCOUNT_DELETION_CRON_ENABLED|createClientFromRequest|createServiceClient|request_account_deletion|request\.json/,
    );
  });

  it("does not publish a self-service deletion promise while the control is closed", () => {
    const terms = web("src/app/terms/page.tsx");
    const privacy = web("src/app/privacy/page.tsx");

    expect(terms).not.toContain("언제든지 설정 페이지에서 탈퇴를 요청할 수 있습니다");
    expect(privacy).not.toContain("탈퇴는 설정 페이지에서 직접 처리할 수 있습니다");
    expect(privacy).toContain("계정 삭제 요청 경로, 영속 처리 대기열, 처리 작업자와 실패 복구의 운영 검증이 완료되지 않아");
  });
});
