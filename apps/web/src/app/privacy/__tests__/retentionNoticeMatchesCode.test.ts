import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **처방침이 말하는 파기 주기와 실제로 도는 주기가 같아야 한다.**
 *
 * 2026-09-01 까지 이 자리에는 `"…법률 검토가 끝난 뒤 확정하며"` 라는 미완성
 * 문구가 있었다. 그런데 파기는 이미 돌고 있었다 — 운영 실측으로 90일 넘은
 * `ai_interactions_log` 1,073행이 전부 `[redacted_after_retention]` 로 지워져
 * 있었다. 즉 **하고 있는 일을 안 한다고 적어 둔 상태**였다.
 *
 * 숫자를 문서에 적는 순간 그것은 약속이 된다. 그래서 코드에서 읽어 대조한다.
 * 크론의 주기를 바꾸면 이 검사가 빨개지고, 문서를 같이 고치게 된다.
 *
 * 이 검사는 문구의 존재가 아니라 **두 값이 같은지**를 본다. 문자열만 세면
 * 다른 곳에 남은 같은 숫자가 대신 답한다.
 */
const PRIVACY = "src/app/privacy/page.tsx";
const RETENTION_CRON = "src/app/api/cron/ai-log-retention/route.ts";

function read(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

/** 크론이 RPC 에 넘기는 보관 기간에서 일수를 꺼낸다. */
function retentionDaysFromCron(): number | null {
  const source = read(RETENTION_CRON);
  const match = source.match(/p_retention:\s*"(\d+)\s*days"/);
  return match ? Number(match[1]) : null;
}

/** 처방침이 사용자에게 말하는 일수를 꺼낸다. */
function noticedDaysFromPrivacy(): number | null {
  const source = read(PRIVACY);
  const match = source.match(/(\d+)일이\s*지나면\s*자동으로\s*제거/);
  return match ? Number(match[1]) : null;
}

/** 크론이 관리자 접속기록 파기에 넘기는 보관 기간에서 일수를 꺼낸다. */
function adminRetentionDaysFromCron(): number | null {
  const source = read(RETENTION_CRON);
  const match = source.match(/purge_admin_access_log[\s\S]{0,120}?p_retention:\s*"(\d+)\s*days"/);
  return match ? Number(match[1]) : null;
}

/** 처방침이 관리자 접속기록에 대해 말하는 기간을 일수로 꺼낸다. */
function noticedAdminRetentionDays(): number | null {
  const source = read(PRIVACY);
  const year = source.match(/(\d+)년간\s*보관/);
  if (year) return Number(year[1]) * 365;
  const day = source.match(/관리자[\s\S]{0,200}?(\d+)일간\s*보관/);
  return day ? Number(day[1]) : null;
}

describe("관리자 접속기록 — 말한 기간 = 실제로 지우는 기간", () => {
  it("크론이 관리자 접속기록을 실제로 지운다", () => {
    // 처방침이 기간을 약속하는데 지우는 코드가 없으면 그 약속은 거짓이 된다.
    expect(read(RETENTION_CRON)).toContain("purge_admin_access_log");
    expect(adminRetentionDaysFromCron()).toBeGreaterThan(0);
  });

  it("두 값이 같다", () => {
    expect(noticedAdminRetentionDays()).toBe(adminRetentionDaysFromCron());
  });

  it("관리자 인증이 실제로 기록을 남긴다", () => {
    // 파기만 있고 기록이 없으면 지울 것이 없다 — 처방침은 없는 기록을 약속하게 된다.
    // 변형 검사에서 `recordAdminAccess` 호출을 지웠을 때 아무도 못 잡아서 넣었다.
    const adminAuth = read("src/lib/utils/adminAuth.ts");
    expect(adminAuth).toContain("admin_access_log");

    // 권한이 있다고 판정하는 갈래 안에서 불려야 한다. 함수만 정의돼 있고
    // 아무도 안 부르면 기록은 한 줄도 안 남는다.
    const authorizedBranch = adminAuth.match(
      /is_admin === true\)\s*\{[\s\S]*?return \{ authorized: true/,
    )?.[0] ?? "";
    expect(authorizedBranch).not.toBe("");
    expect(authorizedBranch).toContain("recordAdminAccess(");
  });

  it("기록에 조회 내용이나 검색어를 담지 않는다고 약속하고, 코드가 그렇게 한다", () => {
    const privacy = read(PRIVACY);
    expect(privacy).toMatch(/조회한 회원 정보의 내용이나 검색어를 담지 않습니다/);

    // 약속한 대로 `pathname` 만 쓰고 질의문자열은 버려야 한다.
    const adminAuth = read("src/lib/utils/adminAuth.ts");
    expect(adminAuth).toContain("new URL(request.url).pathname");
    expect(adminAuth).not.toMatch(/\.search\b/);
    expect(adminAuth).not.toContain("request.json()");
  });
});

describe("처방침의 파기 주기 = 실제로 도는 주기", () => {
  it("크론에서 보관 기간을 읽어낼 수 있다", () => {
    // 이 검사가 먼저 깨지면 아래 대조는 아무것도 못 지킨다.
    expect(retentionDaysFromCron()).toBeGreaterThan(0);
  });

  it("처방침에서 고지한 일수를 읽어낼 수 있다", () => {
    expect(noticedDaysFromPrivacy()).toBeGreaterThan(0);
  });

  it("두 값이 같다", () => {
    expect(noticedDaysFromPrivacy()).toBe(retentionDaysFromCron());
  });

  it("미완성 문구가 이 항목에 다시 들어오지 않는다", () => {
    const privacy = read(PRIVACY);
    // 아모라 비용·오류 기록 항목만 본다. 다른 항목의 미확정 고지는 별개다.
    // 욕심부리면 뒤 항목까지 삼킨다 — 처음 만나는 `</li>` 에서 끊는다.
    const item = privacy.match(/<li>아모라 비용·오류 기록[\s\S]*?<\/li>/)?.[0] ?? "";
    expect(item).not.toBe("");
    for (const unfinished of ["법률 검토가 끝난 뒤", "확정하며", "출시 전에"]) {
      expect(item).not.toContain(unfinished);
    }
  });
});
