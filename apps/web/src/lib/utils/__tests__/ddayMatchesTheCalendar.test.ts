import { afterEach, describe, expect, it, vi } from "vitest";

import { buildAmoraLifecyclePlan } from "@/lib/amora/lifecycle";
import { daysUntilWedding } from "@/lib/utils/weddingDate";
import { daysUntilWedding as sharedDaysUntilWedding } from "@hanbang/shared";

/**
 * D-day 가 달력과 같은 수를 말하는가.
 *
 * ## QA 가 준 정확한 사례 (2026-09-02 라이브)
 *
 *   한국 시각 2026-09-02 16:56, 예식일 2027-05-14 → 기대 **D-254**, 화면 **D-255**
 *
 * 달력으로 세면 254다(2026-09-02 → 2026-12-31 이 120일, 2027-01-01 → 2027-05-14 가
 * 134일). 이 검사는 그 수를 **손으로 적지 않고** `Date.UTC` 차이로 계산해서 견준다 —
 * 기대값을 손으로 적으면 검사가 계산기와 같이 틀린다.
 *
 * ## 왜 시각을 여러 개 두는가
 *
 * 시간대 어긋남은 **하루 중 특정 구간에서만** 나타난다. UTC 로 읽는 실수는 한국
 * 00:00~09:00 에서만 하루가 밀리므로, 오후 한 시각만 재면 그 실수를 통째로 놓친다.
 * QA 가 잰 16:56 은 UTC 와 한국 날짜가 같은 시각이라 **그 구간이 아니다** — 그래서
 * 그 시각 하나만으로는 "고쳤다"고 말할 수 없다. 하루를 훑는다.
 */

const KST_HOURS_ACROSS_THE_DAY = [0, 1, 5, 8, 9, 12, 16, 20, 23];

/** 한국 시각 Y-M-D hh:mm 의 실제 순간. */
function kstInstant(ymd: string, hour: number, minute = 0): Date {
  const pad = (n: number) => String(n).padStart(2, "0");
  return new Date(`${ymd}T${pad(hour)}:${pad(minute)}:00+09:00`);
}

/** 달력 날짜 차이. 시간대가 끼어들 수 없는 계산이다. */
function calendarDaysBetween(fromYmd: string, toYmd: string): number {
  const toUtcDay = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86_400_000;
  };
  return toUtcDay(toYmd) - toUtcDay(fromYmd);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("QA 가 준 사례", () => {
  const TODAY = "2026-09-02";
  const WEDDING = "2027-05-14";

  it("달력이 말하는 수가 254다", () => {
    // 계산기가 맞는지부터 본다. 이 줄이 틀리면 아래가 전부 무의미하다.
    expect(calendarDaysBetween(TODAY, WEDDING)).toBe(254);
  });

  it("QA 가 잰 그 시각에 라운지가 254를 말한다", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: WEDDING,
      totalBudget: 0,
      progress: {},
      now: kstInstant(TODAY, 16, 56),
    });
    expect(plan.dday).toBe(254);
  });

  it("하루 어느 시각에 봐도 254다", () => {
    for (const hour of KST_HOURS_ACROSS_THE_DAY) {
      const now = kstInstant(TODAY, hour);
      const plan = buildAmoraLifecyclePlan({
        weddingDate: WEDDING,
        totalBudget: 0,
        progress: {},
        now,
      });
      expect(plan.dday, `한국 ${hour}시에 라운지 D-day 가 어긋난다`).toBe(254);

      vi.useFakeTimers();
      vi.setSystemTime(now);
      expect(daysUntilWedding(WEDDING), `한국 ${hour}시에 웹 D-day 가 어긋난다`).toBe(254);
      expect(
        sharedDaysUntilWedding(WEDDING, now.getTime()),
        `한국 ${hour}시에 앱 D-day 가 어긋난다`,
      ).toBe(254);
      vi.useRealTimers();
    }
  });
});

/**
 * 사례 하나만 고정하면 그 사례만 맞는 코드를 쓸 수 있다. 경계마다 훑는다.
 */
describe("D-day 가 달력과 어긋나는 날이 없다", () => {
  const CASES: Array<[today: string, wedding: string, why: string]> = [
    ["2026-09-02", "2027-05-14", "QA 사례"],
    ["2026-09-02", "2026-09-02", "예식 당일"],
    ["2026-09-02", "2026-09-03", "예식 하루 전"],
    ["2026-09-02", "2026-09-01", "예식이 지남"],
    ["2026-12-31", "2027-01-01", "해 넘김"],
    ["2027-02-28", "2027-03-01", "평년 2월 끝"],
    ["2028-02-28", "2028-03-01", "윤년 2월 끝 — 하루가 더 있다"],
    ["2028-02-29", "2028-03-01", "윤일 당일"],
    ["2026-09-02", "2028-02-29", "윤일을 지나 1년 반"],
    ["2026-03-01", "2026-03-31", "한 달 안"],
  ];

  it.each(CASES)("%s → %s (%s)", (today, wedding) => {
    const expected = calendarDaysBetween(today, wedding);
    for (const hour of KST_HOURS_ACROSS_THE_DAY) {
      const now = kstInstant(today, hour);
      expect(
        buildAmoraLifecyclePlan({ weddingDate: wedding, totalBudget: 0, progress: {}, now }).dday,
        `${today} 한국 ${hour}시 → ${wedding}`,
      ).toBe(expected);
      expect(
        sharedDaysUntilWedding(wedding, now.getTime()),
        `${today} 한국 ${hour}시 → ${wedding} (앱)`,
      ).toBe(expected);
    }
  });
});

/**
 * 예식일이 `YYYY-MM-DD` 가 아닌 모양으로 들어오면 어떻게 되나.
 *
 * `wedding_journeys.wedding_date` 는 `DATE` 열이라 Supabase 가 `"2027-05-14"` 를
 * 준다. 그런데 `lifecycle` 은 `new Date(value)` 로 무엇이든 받아 KST 달력 날짜로
 * 읽는다. 타임스탬프가 들어오면 **그 순간의 한국 날짜**가 되므로, 자정 근처
 * 값에서는 사람이 고른 날짜와 하루 달라질 수 있다. 그 동작을 여기에 못박아 둔다 —
 * 나중에 열 타입이 바뀌면 이 검사가 먼저 말한다.
 */
describe("예식일이 타임스탬프로 들어올 때의 동작을 못박는다", () => {
  const now = kstInstant("2026-09-02", 16, 56);

  it("한국 날짜가 같은 타임스탬프는 같은 수를 낸다", () => {
    // 2027-05-14T00:00:00Z = 한국 2027-05-14 09:00 → 같은 날
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2027-05-14T00:00:00.000Z",
      totalBudget: 0,
      progress: {},
      now,
    });
    expect(plan.dday).toBe(254);
  });

  it("한국 날짜가 넘어가는 타임스탬프는 하루 뒤가 된다", () => {
    // 2027-05-14T15:00:00Z = 한국 2027-05-15 00:00 → 다음 날
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2027-05-14T15:00:00.000Z",
      totalBudget: 0,
      progress: {},
      now,
    });
    expect(plan.dday).toBe(255);
  });

  it("엄격한 헬퍼는 타임스탬프를 아예 받지 않는다", () => {
    // `daysUntilWedding` 은 `YYYY-MM-DD` 만 받는다. 모양이 다르면 D-day 를
    // 지어내지 않고 null 을 준다.
    expect(daysUntilWedding("2027-05-14T15:00:00.000Z")).toBeNull();
    expect(sharedDaysUntilWedding("2027-05-14T15:00:00.000Z", now.getTime())).toBeNull();
  });
});
