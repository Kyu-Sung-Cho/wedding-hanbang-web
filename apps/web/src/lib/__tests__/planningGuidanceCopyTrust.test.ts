import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("generic planning guidance copy", () => {
  it("never presents template timing as the couple's urgent personal deadline", () => {
    const sources = [
      "apps/web/src/components/app/WeeklyCard.tsx",
      "apps/web/src/components/app/schedule/ScheduleContent.tsx",
      "apps/web/src/components/app/schedule/ImminentAlerts.tsx",
      "apps/web/src/components/app/chat/panel/UpcomingTab.tsx",
      "apps/web/src/app/(app)/lounge/page.tsx",
    ].map(read).join("\n");

    expect(sources).not.toMatch(/긴급 확인|임박 체크리스트|일 초과/);
    expect(sources).not.toContain("daysUntilDeadline)}일");
    expect(sources).not.toContain("deadlineDaysLeft)}일");
    expect(sources).not.toContain("이번 주 마감 임박 항목");
    expect(sources).not.toContain("좋은 흐름이에요");
    expect(sources).toContain("일반적인 준비 순서 참고");
    expect(sources).toContain("업체 마감으로 계산한 값은 아닙니다");
    expect(sources).toContain("직접 시작한 준비");
  });
});
