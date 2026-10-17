import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { daysUntilWedding } from "@/lib/utils/weddingDate";
import { todayKstMidnight } from "@/lib/utils/kstDate";

/**
 * D-day 가 한국 새벽 0~9시에 하루 많았다.
 *
 * ## 무엇이 있었나
 *
 * 웹 상단바(`TopNav.tsx`)와 일정 화면(`ScheduleContent.tsx`)이 같은 계산을 손으로
 * 하고 있었다.
 *
 *     const today = new Date();
 *     Math.ceil((new Date("2026-10-15").getTime() - today.getTime()) / DAY_MS)
 *
 * `new Date("YYYY-MM-DD")` 는 **UTC 자정**으로 파싱되고 `new Date()` 는 지금 이
 * 순간이다. KST 0~9시는 UTC 로 **전날 15~24시**라 차이가 온전한 일수보다 조금 크고,
 * `Math.ceil` 이 그걸 올려 하루를 더한다.
 *
 * 그래서 예식 당일 새벽에 "D-1", 하루 전 새벽에 "D-2" 가 떴다.
 *
 * ## 왜 이 검사가 이 모양인가
 *
 * 이 저장소에는 이미 옳은 도우미(`daysUntilWedding`)가 있었고 다른 화면 6곳이 그걸
 * 쓰고 있었다. **두 화면만 자기 계산을 들고 있었다.** 그래서 값이 맞는지보다
 * "그 두 화면이 도우미를 쓰는가"를 함께 잠근다 — 다음에 누가 또 손으로 계산하면
 * 같은 시간대에 같은 방식으로 틀린다.
 *
 * 알림 훅(`useNotifications.ts`)이 같은 손계산을 마지막으로 들고 있었다. 상단바 알약은
 * D-day 인데 종 아이콘에는 "남은 준비 확인하기" 같은 알림이 새로 뜨는 식으로 같은 화면의
 * 두 곳이 서로 다른 날짜를 말했다. 그래서 지금은 세 곳을 잠근다.
 */

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..", "..");
const WEB = join(REPO_ROOT, "apps", "web", "src");

const SURFACES = [
  join(WEB, "components", "app", "TopNav.tsx"),
  join(WEB, "components", "app", "schedule", "ScheduleContent.tsx"),
  join(WEB, "hooks", "useNotifications.ts"),
];

const short = (p: string) => p.split(/[\\/]/).slice(-1)[0];
const read = (p: string) => readFileSync(p, "utf8");

/** 한국 시각을 그 순간의 UTC Date 로. KST = UTC+9. */
function atKst(ymd: string, hour: number, minute = 0): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour - 9, minute));
}

/** 손으로 하던 옛 계산 — 무엇이 틀렸는지 보이려고 그대로 옮겼다. */
function oldWay(weddingYmd: string, now: Date): number {
  return Math.ceil(
    (new Date(weddingYmd).getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
  );
}

/** 도우미가 쓰는 것과 같은 방식으로 '그 순간의 KST 자정'을 만든다. */
function kstMidnightAt(now: Date): Date {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 60 * 60 * 1000);
}

describe("새벽에도 D-day 가 하루 어긋나지 않는다", () => {
  const WEDDING = "2026-10-15";

  it.each([0, 3, 6, 8, 9, 12, 18, 23])(
    "예식 %s일 전 새벽·낮 어느 시각에도 같은 값이다",
    (hour) => {
      const now = atKst("2026-10-14", hour);
      expect(daysUntilWedding(WEDDING, kstMidnightAt(now))).toBe(1);
    },
  );

  it("예식 당일 새벽에 D-day 다 — 옛 계산은 D-1 이었다", () => {
    const dawn = atKst("2026-10-15", 3);
    expect(daysUntilWedding(WEDDING, kstMidnightAt(dawn))).toBe(0);
    // 측정기가 살아 있다: 옛 방식은 실제로 틀렸다.
    expect(oldWay(WEDDING, dawn), "옛 계산이 안 틀렸다면 이 검사는 무의미하다").toBe(1);
  });

  it("KST 0시와 8시 59분은 같은 날이다", () => {
    const midnight = atKst("2026-10-14", 0, 0);
    const beforeNine = atKst("2026-10-14", 8, 59);
    expect(daysUntilWedding(WEDDING, kstMidnightAt(midnight)))
      .toBe(daysUntilWedding(WEDDING, kstMidnightAt(beforeNine)));
    // 옛 방식은 이 둘이 갈렸다.
    expect(oldWay(WEDDING, midnight)).not.toBe(oldWay(WEDDING, atKst("2026-10-14", 12)));
  });

  it("기본 인자로도 동작한다 — 오늘 기준", () => {
    expect(daysUntilWedding(WEDDING)).toBe(daysUntilWedding(WEDDING, todayKstMidnight()));
  });
});

describe("세 곳이 손으로 계산하지 않는다", () => {
  it.each(SURFACES.map((f) => [short(f), f]))("%s 가 도우미를 쓴다", (_n, file) => {
    expect(read(file)).toContain("daysUntilWedding");
  });

  it.each(SURFACES.map((f) => [short(f), f]))(
    "%s 에 손으로 하는 D-day 계산이 없다",
    (_n, file) => {
      // 이 조합이 그 버그의 모양이다: 두 시각의 차이를 하루로 나눠 올림/내림.
      //
      // 처음엔 `Math\.ceil\([^)]*getTime\(\)[^)]*getTime\(\)` 로 썼다가 **변형을
      // 놓쳤다** — `new Date().getTime()` 의 괄호에서 `[^)]*` 가 끊긴다. 공백을
      // 지운 뒤 하루(밀리초)로 나누는 모양 자체를 본다.
      const dense = read(file).replace(/\s+/gu, "");
      expect(dense, "손으로 하는 날짜 차 계산이 남아 있다")
        .not.toMatch(/Math\.(ceil|floor|round)\(.{0,120}getTime\(\).{0,60}getTime\(\).{0,40}\/.{0,30}(86400000|1000\*60\*60\*24|24\*60\*60\*1000)/u);
    },
  );
});
