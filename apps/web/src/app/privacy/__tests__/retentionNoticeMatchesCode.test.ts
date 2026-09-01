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
