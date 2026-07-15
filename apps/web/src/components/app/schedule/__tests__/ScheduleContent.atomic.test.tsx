import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScheduleContent from "../ScheduleContent";

const mocks = vi.hoisted(() => {
  class ScheduleEventConflictError extends Error {
    constructor(
      message: string,
      readonly progress: Record<string, unknown>,
    ) {
      super(message);
    }
  }
  class ChecklistItemConflictError extends Error {
    constructor(
      message: string,
      readonly progress: Record<string, unknown>,
    ) {
      super(message);
    }
  }
  return {
    updateJourney: vi.fn(),
    updateJourneyLocal: vi.fn(),
    mutateScheduleEvent: vi.fn(),
    mutateChecklistItem: vi.fn(),
    ScheduleEventConflictError,
    ChecklistItemConflictError,
    timelineOnDeleteEvent: undefined as undefined | ((eventId: string) => void),
  };
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    journey: {
      id: "journey-1",
      couple_id: "couple-1",
      wedding_date: "2026-10-10",
      venue: null,
      total_budget: 0,
      progress: { __events: [] },
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    },
    isDemo: false,
    updateJourney: mocks.updateJourney,
    updateJourneyLocal: mocks.updateJourneyLocal,
  }),
}));

vi.mock("@/lib/schedule/scheduleEventClient", () => ({
  mutateScheduleEvent: mocks.mutateScheduleEvent,
  ScheduleEventConflictError: mocks.ScheduleEventConflictError,
}));

vi.mock("@/lib/checklist/checklistItemClient", () => ({
  mutateChecklistItem: mocks.mutateChecklistItem,
  ChecklistItemConflictError: mocks.ChecklistItemConflictError,
}));

vi.mock("../TimelineView", () => ({
  default: ({ onAddEvent, onToggleChecklistItem, onDeleteEvent }: {
    onAddEvent: () => void;
    onToggleChecklistItem: (
      categoryKey: string,
      item: { id: string; label: string; done: boolean },
    ) => void;
    onDeleteEvent?: (eventId: string) => void;
  }) => {
    mocks.timelineOnDeleteEvent = onDeleteEvent;
    return (
      <>
        <button data-testid="open-add" onClick={onAddEvent}>일정 추가</button>
        <button
          data-testid="schedule-checklist"
          onClick={() => onToggleChecklistItem("meeting", {
            id: "meeting_01",
            label: "상견례 일정 조율",
            done: false,
          })}
        >
          체크리스트 일정 연결
        </button>
      </>
    );
  },
}));
vi.mock("../CalendarView", () => ({ default: () => null }));
vi.mock("../CategoryChecklistModal", () => ({ default: () => null }));
vi.mock("../ImminentAlerts", () => ({ default: () => null }));
vi.mock("../EventFormModal", () => ({
  default: ({ isOpen, onSave }: {
    isOpen: boolean;
    onSave: (data: { date: string; title: string }) => Promise<void>;
  }) => isOpen ? (
    <button
      data-testid="save-event"
      onClick={() => void onSave({
        date: "2026-08-20",
        title: "드레스 최종 피팅",
      }).catch(() => undefined)}
    >
      저장
    </button>
  ) : null,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ScheduleContent atomic event persistence", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.timelineOnDeleteEvent = undefined;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("adds through the stable-id server mutation and applies only validated authoritative progress", async () => {
    const authoritativeProgress = {
      __events: [{
        id: "evt_partner",
        date: "2026-08-19",
        title: "파트너 일정",
        createdAt: "2026-07-13T00:00:00.000Z",
        updatedAt: "2026-07-13T00:00:00.000Z",
      }],
    };
    mocks.mutateScheduleEvent.mockResolvedValue({
      progress: authoritativeProgress,
      event: authoritativeProgress.__events[0],
      eventId: "evt_partner",
    });

    act(() => root.render(<ScheduleContent />));
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="open-add"]')?.click());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="save-event"]')?.click();
      await Promise.resolve();
    });

    expect(mocks.mutateScheduleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "add",
        event: expect.objectContaining({
          id: expect.stringMatching(/^evt_/),
          date: "2026-08-20",
          title: "드레스 최종 피팅",
        }),
      }),
    );
    expect(mocks.updateJourneyLocal).toHaveBeenCalledWith({
      progress: authoritativeProgress,
    });
    expect(mocks.updateJourney).not.toHaveBeenCalled();
  });

  it("does not expose an unconfirmed one-click delete action in the timeline", () => {
    act(() => root.render(<ScheduleContent />));

    expect(mocks.timelineOnDeleteEvent).toBeUndefined();
  });

  it("replaces stale client progress with validated latest progress when a partner wins the edit", async () => {
    const latestProgress = {
      __events: [{
        id: "evt_partner",
        date: "2026-08-22",
        title: "파트너가 먼저 저장한 일정",
        createdAt: "2026-07-13T00:00:00.000Z",
        updatedAt: "2026-07-13T01:00:00.000Z",
      }],
    };
    mocks.mutateScheduleEvent.mockRejectedValue(
      new mocks.ScheduleEventConflictError("다른 기기에서 변경되었습니다.", latestProgress),
    );

    act(() => root.render(<ScheduleContent />));
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="open-add"]')?.click());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="save-event"]')?.click();
      await Promise.resolve();
    });

    expect(mocks.updateJourneyLocal).toHaveBeenCalledWith({ progress: latestProgress });
  });

  it("connects a checklist date through the atomic event mutation before saving checklist state", async () => {
    mocks.mutateScheduleEvent.mockImplementation(async (mutation: {
      operation: string;
      event: { id: string };
    }) => {
      const progress = { __events: [mutation.event] };
      return { progress, event: mutation.event, eventId: mutation.event.id };
    });
    const checklistProgress = {
      __events: [{ id: "evt_checklist" }],
      meeting: {
        category: "meeting",
        status: "in_progress",
        checklist: [{ id: "meeting_01", label: "상견례 일정 조율", done: true }],
      },
    };
    mocks.mutateChecklistItem.mockResolvedValue({
      progress: checklistProgress,
      categoryKey: "meeting",
      itemId: "meeting_01",
      item: checklistProgress.meeting.checklist[0],
    });

    act(() => root.render(<ScheduleContent />));
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="schedule-checklist"]')?.click();
    });
    const dateInput = container.querySelector<HTMLInputElement>('section input[type="date"]');
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(dateInput, "2026-08-26");
      dateInput?.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    const promptButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("section button"),
    );
    await act(async () => {
      promptButtons.at(-1)?.click();
      await Promise.resolve();
    });

    expect(mocks.mutateScheduleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "add",
        event: expect.objectContaining({ date: "2026-08-26" }),
      }),
    );
    expect(mocks.mutateChecklistItem).toHaveBeenCalledWith({
      categoryKey: "meeting",
      itemId: "meeting_01",
      done: true,
      expectedDone: false,
    });
    expect(mocks.updateJourneyLocal).toHaveBeenCalledWith({ progress: checklistProgress });
    expect(mocks.updateJourney).not.toHaveBeenCalled();
  });

  it("keeps the checklist prompt open with a clear error when its follow-up save fails", async () => {
    mocks.mutateChecklistItem.mockRejectedValue(
      new Error("체크리스트를 저장하지 못했습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요."),
    );
    mocks.mutateScheduleEvent.mockImplementation(async (mutation: {
      event: { id: string };
    }) => ({
      progress: { __events: [mutation.event] },
      event: mutation.event,
      eventId: mutation.event.id,
    }));

    act(() => root.render(<ScheduleContent />));
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="schedule-checklist"]')?.click();
    });
    const dateInput = container.querySelector<HTMLInputElement>('section input[type="date"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        dateInput,
        "2026-08-27",
      );
      dateInput?.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("section button"),
    );
    await act(async () => {
      buttons.at(-1)?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "체크리스트를 저장하지 못했습니다",
    );
    expect(container.querySelector("section")).not.toBeNull();
  });
});
