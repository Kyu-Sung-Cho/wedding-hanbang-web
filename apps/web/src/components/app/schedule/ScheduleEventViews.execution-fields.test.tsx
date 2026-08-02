// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CalendarView from "./CalendarView";
import TimelineView from "./TimelineView";
import type { ScheduleEvent } from "@/types/database.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const VIEWER_ID = "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2";
const PARTNER_ID = "4ed560aa-52e6-47d2-9595-612d0bfe2c7b";

const EVENT: ScheduleEvent = {
  id: "evt-execution",
  date: "2026-07-15",
  time: "14:30",
  title: "사회자 최종 확인",
  status: "completed",
  completionCriteria: "진행 순서와 도착 시간을 모두 확인",
  assignee: {
    kind: "member",
    profileId: PARTNER_ID,
  },
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const ASSIGNEE_CONTEXT = {
  viewer: { id: VIEWER_ID, name: "지은" },
  partner: { id: PARTNER_ID, name: "수현" },
};

describe("schedule execution field presentation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("shows status, canonical assignee meaning, and completion criteria in calendar detail", async () => {
    await act(async () => {
      root.render(
        <CalendarView
          weddingDate={null}
          events={[EVENT]}
          onAddEvent={vi.fn()}
          onEditEvent={vi.fn()}
          assigneeContext={ASSIGNEE_CONTEXT}
        />,
      );
      vi.runAllTimers();
    });

    const dayButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "15",
    );
    if (!(dayButton instanceof HTMLButtonElement)) {
      throw new Error("event day not found");
    }

    await act(async () => dayButton.click());

    expect(container.textContent).toContain("완료");
    expect(container.textContent).toContain("담당 · 수현 (파트너)");
    expect(container.textContent).toContain("14:30");
    expect(container.textContent).toContain(
      "진행 순서와 도착 시간을 모두 확인",
    );
  });

  it("shows the same execution fields on the direct-event timeline row", async () => {
    await act(async () => {
      root.render(
        <TimelineView
          progress={{}}
          events={[EVENT]}
          onToggleChecklistItem={vi.fn()}
          assigneeContext={ASSIGNEE_CONTEXT}
        />,
      );
    });

    expect(container.textContent).toContain("사회자 최종 확인");
    expect(container.textContent).toContain("완료");
    expect(container.textContent).toContain("수현 (파트너)");
    expect(container.textContent).toContain("14:30");
    expect(container.textContent).toContain(
      "완료 기준 · 진행 순서와 도착 시간을 모두 확인",
    );
  });

  it("does not request cancellation before explicit confirmation", async () => {
    const onCancelEvent = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        <TimelineView
          progress={{}}
          events={[EVENT]}
          onToggleChecklistItem={vi.fn()}
          onCancelEvent={onCancelEvent}
          assigneeContext={ASSIGNEE_CONTEXT}
        />,
      );
    });

    const cancelButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="사회자 최종 확인 일정 취소 요청"]',
    );
    if (!cancelButton) throw new Error("cancel button not rendered");

    await act(async () => cancelButton.click());
    expect(onCancelEvent).not.toHaveBeenCalled();

    const confirmButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "취소 요청 보내기",
    );
    if (!(confirmButton instanceof HTMLButtonElement)) {
      throw new Error("cancel confirmation not rendered");
    }
    await act(async () => {
      confirmButton.click();
      await Promise.resolve();
    });
    expect(onCancelEvent).toHaveBeenCalledTimes(1);
  });
});
