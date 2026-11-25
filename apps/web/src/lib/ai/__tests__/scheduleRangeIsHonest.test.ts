import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { executeGetScheduleEvents } from "@/lib/ai/tools/scheduleTools";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

/**
 * "등록된 일정 알려줘" 에 "없어요" 라고 답했다.
 *
 * 기본 조회 창이 오늘부터 30일인데, **결혼식은 보통 6~18개월 뒤라 등록된 일정
 * 대부분이 그 밖에 있다.** 2026-08-24 운영 실측: 2027-04-10 에 "본식 리허설"이
 * 있는데 아모라는 "현재 등록된 예정 일정은 없어요" 라고 답했다. 조회 기간을
 * 밝히기는 했으니 거짓말은 아니지만, 사용자가 물은 것에 대한 답이 아니다.
 *
 * 창은 그대로 둔다 — "이번 달 일정" 같은 질문에는 그 창이 맞다. 대신 **밖에
 * 무엇이 있는지 함께 준다.**
 */

const FAR = "2027-04-10";

function ctxWith(events: unknown[]): ToolExecutionContext {
  return {
    coupleId: "00000000-0000-0000-0000-000000000000",
    requestKey: "chat:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002",
    requestAttemptCount: 1,
    currentUserText: "",
    weddingContext: {
      weddingDate: null,
      budget: 0,
      venue: null,
      progress: { __events: events } as never,
    },
  };
}

const FAR_EVENT = {
  id: "evt_far_0001",
  date: FAR,
  title: "본식 리허설",
  status: "planned",
  categoryKey: "mc",
  createdAt: "2026-08-24T12:26:42.472Z",
  updatedAt: "2026-08-24T12:26:42.472Z",
};

describe("조회 창 밖의 일정을 숨기지 않는다", () => {
  // 기본 조회 창은 오늘(KST)부터 30일이다. 시계를 고정하지 않으면 2027-03-11 부터
  // FAR 가 창 안에 들어오고, FAR 가 지나면 지난 일정이 되어 코드 변경 없이 깨진다.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T03:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("창 안이 비어도 밖에 있다는 것을 알려준다", () => {
    const result = executeGetScheduleEvents({}, ctxWith([FAR_EVENT]));
    const out = result.toolOutput as {
      count: number;
      outside_range_count: number;
      next_outside_range: { date: string; title: string } | null;
    };
    expect(out.count).toBe(0);
    expect(out.outside_range_count).toBe(1);
    expect(out.next_outside_range?.date).toBe(FAR);
    expect(result.displayMessage).toContain("이 기간 밖에 1개 더 있음");
    expect(result.displayMessage).toContain("본식 리허설");
  });

  it("창 안에 있으면 밖 안내를 붙이지 않는다", () => {
    const result = executeGetScheduleEvents(
      { from_date: "2027-04-01", to_date: "2027-04-30" },
      ctxWith([FAR_EVENT]),
    );
    const out = result.toolOutput as { count: number; outside_range_count: number };
    expect(out.count).toBe(1);
    expect(out.outside_range_count).toBe(0);
    expect(result.displayMessage).not.toContain("기간 밖에");
  });

  it("일정이 아예 없으면 밖 안내도 없다", () => {
    const result = executeGetScheduleEvents({}, ctxWith([]));
    const out = result.toolOutput as { outside_range_count: number };
    expect(out.outside_range_count).toBe(0);
    expect(result.displayMessage).not.toContain("기간 밖에");
  });

  it("취소된 일정은 planned 조회의 밖 안내에 섞이지 않는다", () => {
    const result = executeGetScheduleEvents(
      {},
      ctxWith([{ ...FAR_EVENT, id: "evt_far_0002", status: "cancelled" }]),
    );
    const out = result.toolOutput as { outside_range_count: number };
    expect(out.outside_range_count).toBe(0);
  });
});
