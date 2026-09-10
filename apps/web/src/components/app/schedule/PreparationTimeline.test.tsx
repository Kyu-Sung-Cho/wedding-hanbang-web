// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleEvent } from "@/types/database.types";
import type { ImminentCategory } from "@/utils/imminentChecklist";
import PreparationTimeline from "./PreparationTimeline";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function event(overrides: Partial<ScheduleEvent>): ScheduleEvent {
  return {
    id: "event", title: "예식 상담", date: "2026-09-20", status: "planned",
    createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", ...overrides,
  };
}

function item(index: number, hasScheduledEvent = false): ImminentCategory {
  return {
    key: `category-${index}`, label: `준비 항목 ${index}`, icon: "CalendarDays",
    status: "not_started", doneCount: 0, totalCount: 3, deadlineDaysLeft: 20,
    hasScheduledEvent, urgency: "soon",
  };
}

describe("준비 타임라인의 실제 일정과 날짜 미정 항목", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onEditEvent = vi.fn();
  const onCategoryClick = vi.fn();
  const onScheduleClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function draw(events: ScheduleEvent[] = [], items: ImminentCategory[] = [], weddingDate: string | null = null) {
    await act(async () => root.render(<PreparationTimeline
      events={events} items={items} today="2026-09-11" weddingDate={weddingDate}
      assigneeContext={{}} onAddEvent={vi.fn()} onEditEvent={onEditEvent}
      onCategoryClick={onCategoryClick} onScheduleClick={onScheduleClick} mutationBlocked={false}
    />));
  }

  it("등록된 앞으로의 일정만 날짜순으로 보여주고 편집에 원본을 전달한다", async () => {
    const first = event({ id: "first", title: "사진 촬영", date: "2026-09-15", time: "14:30", completionCriteria: "촬영 장소 확인" });
    const later = event({ id: "later", title: "드레스 픽업", date: "2026-10-01" });
    await draw([later, event({ id: "past", title: "지난 일정", date: "2026-09-10" }), first, event({ id: "cancelled", title: "취소한 일정", status: "cancelled" })]);
    const rows = [...container.querySelectorAll("article")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("사진 촬영");
    expect(rows[1].textContent).toContain("드레스 픽업");
    expect(rows[0].textContent).toContain("14:30");
    expect(rows[0].textContent).toContain("완료 기준 · 촬영 장소 확인");
    expect(container.textContent).not.toContain("지난 일정");
    expect(container.textContent).not.toContain("취소한 일정");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="사진 촬영 일정 수정"]')?.click());
    expect(onEditEvent).toHaveBeenCalledWith(first);
  });

  it("결혼식을 실제 날짜 사이에 두고 가까운 약속을 날짜 미정 목록보다 먼저 보여준다", async () => {
    const before = event({ id: "before", title: "식전 최종 확인", date: "2026-10-19" });
    const after = event({ id: "after", title: "신혼여행 출발", date: "2026-10-21" });
    await draw([after, before], Array.from({ length: 6 }, (_, index) => item(index)), "2026-10-20");
    const rows = [...container.querySelectorAll("article")];
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("식전 최종 확인");
    expect(rows[1].textContent).toContain("우리의 결혼식");
    expect(rows[2].textContent).toContain("신혼여행 출발");
    const firstUndated = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("준비 항목 0"));
    expect(firstUndated).toBeInstanceOf(HTMLButtonElement);
    expect(rows[2].compareDocumentPosition(firstUndated!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("날짜가 이미 있는 분야는 미정 카드로 중복 표시하지 않는다", async () => {
    await draw([], [item(1, true), item(2)]);
    expect(container.textContent).not.toContain("준비 항목 1");
    const categoryButton = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("준비 항목 2"));
    await act(async () => categoryButton?.click());
    expect(onCategoryClick).toHaveBeenCalledWith("category-2");
    expect(onScheduleClick).not.toHaveBeenCalled();
    const scheduleButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "날짜 잡기");
    await act(async () => scheduleButton?.click());
    expect(onScheduleClick).toHaveBeenCalledWith("category-2");
  });

  it("처음 접힌 항목도 모두보기에서 날짜를 정할 수 있다", async () => {
    await draw([], Array.from({ length: 6 }, (_, index) => item(index)));
    expect(container.textContent).not.toContain("준비 항목 5");
    const expand = container.querySelector<HTMLButtonElement>('[aria-expanded="false"]');
    await act(async () => expand?.click());
    expect(container.textContent).toContain("준비 항목 5");
    const scheduleButtons = [...container.querySelectorAll("button")].filter((button) => button.textContent === "날짜 잡기");
    await act(async () => scheduleButtons.at(-1)?.click());
    expect(onScheduleClick).toHaveBeenCalledWith("category-5");
  });
});
