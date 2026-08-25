import { afterEach, describe, expect, it, vi } from "vitest";

import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";
import { daysUntilWedding } from "@hanbang/shared";

/**
 * 결혼식 날 아침에 아모라가 "D-1" 이라고 했다.
 *
 * D-day 를 `Math.ceil((예식일 - Date.now()) / 하루)` 로 셌다. 예식일 문자열은
 * UTC 자정으로 파싱되는데 `Date.now()` 는 실제 시각이라, **한국 새벽 00:00~09:00**
 * 에는 UTC 가 아직 전날이어서 남은 조각을 올림하면 하루가 더 나온다.
 * 하루 24시간 중 9시간이다.
 *
 *     예식일 2026-08-25, 한국시각 2026-08-25 06:00
 *       실제 D-Day  ->  "D-1"
 *
 * `packages/shared` 의 첫마디는 같은 사고를 겪고 이미 KST 로 고쳤고, 그 함수
 * 주석이 "모든 사용자-노출 날짜 계산은 이 헬퍼를 통과시킨다" 는 규칙을 적어
 * 두었다. 시스템 프롬프트와 `get_wedding_info` 만 그 규칙 밖에 있었다.
 *
 * 2026-08-25 적대적 검토가 지적했고 재현했다.
 */

/** 한국시각을 UTC 인스턴트로. */
function kst(y: number, m: number, d: number, hour: number): number {
  return Date.UTC(y, m - 1, d, hour - 9, 0, 0);
}

const CTX = {
  weddingDate: "2026-08-25",
  budget: 62_000_000,
  venue: null,
  progress: {},
  preparationStatus: null,
  brideName: "신부",
  groomName: "신랑",
  bookings: [],
  scheduleEvents: [],
  chatSummaries: [],
  pastConflicts: [],
  pastDecisions: [],
} as never;

afterEach(() => {
  vi.useRealTimers();
});

describe("예식 당일 새벽", () => {
  it.each([0, 3, 6, 8])(
    "한국 %i시에도 계산이 D-Day 다",
    (hour) => {
      // 이 구간이 깨져 있던 자리다. 09시부터는 UTC 와 날짜가 맞아 예전에도 옳았다.
      expect(daysUntilWedding("2026-08-25", kst(2026, 8, 25, hour))).toBe(0);
    },
  );

  it("프롬프트가 결혼식 날 아침에 D-Day 라고 적는다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(kst(2026, 8, 25, 6));
    const prompt = getWeddingPlannerSystemPrompt(CTX);
    expect(prompt).toContain("(D-Day!)");
    expect(prompt).not.toContain("(D-1)");
  });

  it("전날 새벽에는 D-1 이다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(kst(2026, 8, 24, 6));
    expect(getWeddingPlannerSystemPrompt(CTX)).toContain("(D-1)");
  });

  it("다음날 새벽에는 D+1 이다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(kst(2026, 8, 26, 6));
    expect(getWeddingPlannerSystemPrompt(CTX)).toContain("(D+1)");
  });

  it("낮 시간에는 예전에도 옳았고 지금도 옳다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(kst(2026, 8, 25, 15));
    expect(getWeddingPlannerSystemPrompt(CTX)).toContain("(D-Day!)");
  });
});

describe("계산할 수 없는 날짜", () => {
  it.each([null, "", "2026-13-01", "2026-02-30", "내년 봄"])(
    "%s 면 D-day 를 지어내지 않는다",
    (value) => {
      expect(daysUntilWedding(value, kst(2026, 8, 25, 6))).toBeNull();
    },
  );

  it("프롬프트도 D-day 표기를 비워 둔다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(kst(2026, 8, 25, 6));
    const prompt = getWeddingPlannerSystemPrompt({
      ...(CTX as object),
      weddingDate: "2026-02-30",
    } as never);
    expect(prompt).not.toContain("(D-");
    expect(prompt).not.toContain("(D+");
    expect(prompt).not.toContain("(D-Day!)");
  });
});
