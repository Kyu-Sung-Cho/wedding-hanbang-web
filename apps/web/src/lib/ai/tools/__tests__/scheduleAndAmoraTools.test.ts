import { describe, expect, it } from "vitest";
import type { ToolExecutionContext } from "../toolTypes";
import {
  executeGetScheduleEvents,
  executeGetScheduleSummary,
} from "../scheduleTools";

function createContext(progress: Record<string, unknown>): ToolExecutionContext {
  return {
    coupleId: "couple-1",
    weddingContext: {
      weddingDate: "2026-10-10",
      budget: 50_000_000,
      venue: null,
      progress:
        progress as unknown as ToolExecutionContext["weddingContext"]["progress"],
    },
  };
}

describe("read-only schedule tools", () => {
  it("derives the schedule summary only from user-recorded progress", () => {
    const result = executeGetScheduleSummary(
      createContext({
        venue: { category: "venue", status: "completed" },
        studio: { category: "studio", status: "in_progress" },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({
      total: 2,
      progress_percent: 50,
    });
    expect(result.toolOutput.completed).toEqual(
      expect.arrayContaining(["예식장"]),
    );
    expect(result.toolOutput.in_progress).toEqual(
      expect.arrayContaining(["스튜디오"]),
    );
  });

  it("does not turn untouched templates into unfinished work", () => {
    const result = executeGetScheduleSummary(createContext({}));

    expect(result.toolOutput).toMatchObject({
      total: 0,
      completed: [],
      in_progress: [],
      not_started: [],
      progress_percent: 0,
    });
    expect(result.displayMessage).toContain("사용자가 직접 시작한 준비 기록이 없습니다");
  });

  it("reads a date range without changing the stored event collection", () => {
    const events = [
      { id: "one", date: "2026-07-10", title: "상견례" },
      { id: "two", date: "2026-08-10", title: "드레스 투어" },
    ];
    const context = createContext({ __events: events });

    const result = executeGetScheduleEvents(
      { from_date: "2026-07-01", to_date: "2026-07-31" },
      context,
    );

    expect(result.toolOutput).toMatchObject({
      count: 1,
      events: [{ id: "one", date: "2026-07-10", title: "상견례" }],
    });
    expect(
      (context.weddingContext.progress as Record<string, unknown>).__events,
    ).toBe(events);
  });
});
