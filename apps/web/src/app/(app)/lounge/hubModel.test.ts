import { afterEach, describe, expect, it, vi } from "vitest";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import type { ProgressItem, ScheduleEvent } from "@/types/database.types";
import { buildLoungePriorityItems, daysUntilLoungeEvent, getLoungeBudgetTotals } from "./hubModel";

describe("라운지 허브가 보여주는 실제 준비 기록", () => {
  afterEach(() => vi.useRealTimers());

  it("일정도 한국 날짜 기준으로 계산하고 무효 날짜를 숫자로 표시하지 않는다", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T15:30:00Z"));
    expect(daysUntilLoungeEvent("2026-09-11")).toBe(0);
    expect(daysUntilLoungeEvent("2026-09-12")).toBe(1);
    expect(daysUntilLoungeEvent("2026-02-30")).toBeNull();
    expect(daysUntilLoungeEvent("invalid")).toBeNull();
  });

  it("예산 화면처럼 숨긴 기본 분야를 빼고 직접 만든 항목과 예비비를 포함한다", () => {
    const progress: Record<string, ProgressItem> = {
      venue: { status: "in_progress", budget: 900_000, spent: 300_000 },
      studio: { status: "not_started", budget: 123_000 },
      reserve: { status: "not_started", budget: 1_000 },
      custom_trip: { status: "not_started", budget: 7_500, spent: 500 },
      greeting: { status: "completed", cost: 99_000 },
    };
    Object.assign(progress, { __hidden: ["venue"] });
    expect(getLoungeBudgetTotals(progress)).toEqual({ allocated: 131_500, spent: 500, photoAttireMakeup: 123_000 });
  });

  it("같은 분야를 한 번만 보여주고 완료·제외 분야 대신 다음 예정 일정을 함께 보여준다", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T03:00:00Z"));
    const progress: Record<string, ProgressItem> = {
      greeting: { status: "completed" },
      meeting: { status: "in_progress" },
      venue: { status: "not_applicable" },
    };
    const event: ScheduleEvent = { id: "event-1", title: "예산 확인", date: "2026-09-14", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" };
    const items = buildLoungePriorityItems(progress, "2026-12-20", [event]);
    const keys = items.flatMap((item) => item.kind === "checklist" ? [item.category.key] : []);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain("greeting");
    expect(keys).not.toContain("venue");
    expect(items).toHaveLength(5);
    expect(items[2]).toEqual({ kind: "schedule", event });
    expect(daysUntilLoungeEvent(event.date)).toBe(4);
  });

  it("날짜가 없어도 준비 중인 분야를 먼저 보여주되 기한을 지어내지 않는다", () => {
    const items = buildLoungePriorityItems({ makeup: { status: "in_progress" } }, null, []);
    expect(items[0].kind === "checklist" && items[0].category.key).toBe("makeup");
    expect(items.every((item) => item.kind === "checklist" && item.imminent === null)).toBe(true);
  });

  it("모든 분야가 완료 또는 제외면 새 할 일을 만들어내지 않는다", () => {
    const progress = Object.fromEntries(CATEGORY_CHECKLISTS.map(({ key }) => [key, { status: "completed" as const }]));
    expect(buildLoungePriorityItems(progress, "2026-12-20", [])).toEqual([]);
  });
});
