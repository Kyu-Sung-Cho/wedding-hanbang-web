// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ScheduleContent, {
  SCHEDULE_EVENT_REPAIR_MESSAGE,
} from "./ScheduleContent";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type MockJourney = {
  wedding_date: string | null;
  progress: Record<string, unknown>;
};

const authState = vi.hoisted(
  (): {
    journey: MockJourney;
    updateJourney: ReturnType<typeof vi.fn>;
    profile: { id: string; name: string };
    partner: { id: string; name: string };
  } => ({
    journey: {
      wedding_date: null,
      progress: {},
    },
    updateJourney: vi.fn(),
    profile: {
      id: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
      name: "지은",
    },
    partner: {
      id: "4ed560aa-52e6-47d2-9595-612d0bfe2c7b",
      name: "수현",
    },
  }),
);

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => authState,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/components/app/schedule/TimelineView", () => ({
  default: ({
    events,
    onAddEvent,
    onEditEvent,
    onDeleteEvent,
  }: {
    events: Array<{
      id: string;
      date: string;
      title: string;
      createdAt: string;
      updatedAt: string;
    }>;
    onAddEvent: () => void;
    onEditEvent: (event: {
      id: string;
      date: string;
      title: string;
      createdAt: string;
      updatedAt: string;
    }) => void;
    onDeleteEvent: (eventId: string) => Promise<void>;
  }) => {
    const firstEvent = events[0];
    return (
      <div>
        <button type="button" onClick={onAddEvent}>
          테스트 일정 추가
        </button>
        <button
          type="button"
          onClick={() => {
            if (firstEvent) onEditEvent(firstEvent);
          }}
        >
          테스트 일정 수정
        </button>
        <button
          type="button"
          onClick={() => {
            if (firstEvent) void onDeleteEvent(firstEvent.id);
          }}
        >
          테스트 일정 삭제
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/app/schedule/CalendarView", () => ({
  default: () => null,
}));

vi.mock("@/components/app/schedule/CategoryChecklistModal", () => ({
  default: () => null,
}));

vi.mock("@/components/app/schedule/ImminentAlerts", () => ({
  default: () => null,
}));

vi.mock("@/components/app/schedule/EventFormModal", () => ({
  default: ({
    isOpen,
    onSave,
  }: {
    isOpen: boolean;
    onSave: (data: {
      date: string;
      title: string;
      status: "planned" | "completed";
      completionCriteria?: string;
      assignee?: {
        kind: "member";
        profileId: string;
      };
    }) => Promise<void>;
  }) => isOpen ? (
      <button
        type="button"
        onClick={() => void onSave({
          date: "2027-05-20",
          title: "드레스 최종 확인",
          status: "completed",
          completionCriteria: "수선 결과 확인",
          assignee: {
            kind: "member",
            profileId: "4ed560aa-52e6-47d2-9595-612d0bfe2c7b",
          },
        })}
      >
        테스트 실행 일정 저장
      </button>
    ) : null,
}));

const VALID_EVENT = {
  id: "event-valid",
  date: "2027-05-01",
  title: "스튜디오 미팅",
  createdAt: "2026-07-19T00:00:00.000Z",
  updatedAt: "2026-07-19T00:00:00.000Z",
};

const MALFORMED_LEGACY_EVENT = {
  id: "event-legacy",
  date: "2027-06-01",
  title: "타임스탬프 없는 레거시 일정",
};

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

describe("ScheduleContent event mutation integrity", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    authState.updateJourney.mockReset();
    authState.updateJourney.mockResolvedValue({ status: "applied" });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("blocks add, edit, and delete when a valid event is mixed with malformed legacy data", async () => {
    authState.journey = {
      wedding_date: null,
      progress: {
        __events: [VALID_EVENT, MALFORMED_LEGACY_EVENT],
      },
    };

    await act(async () => {
      root.render(<ScheduleContent />);
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      SCHEDULE_EVENT_REPAIR_MESSAGE,
    );

    await act(async () => {
      findButton(container, "테스트 일정 추가").click();
      findButton(container, "테스트 일정 수정").click();
      findButton(container, "테스트 일정 삭제").click();
      await Promise.resolve();
    });

    expect(authState.updateJourney).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      SCHEDULE_EVENT_REPAIR_MESSAGE,
    );
  });

  it("deletes from a valid event array while preserving unrelated raw progress", async () => {
    const unrelatedProgress = {
      status: "in_progress",
      legacyMetadata: {
        importedBy: "migration-v1",
        keepExactly: true,
      },
    };
    authState.journey = {
      wedding_date: null,
      progress: {
        __events: [VALID_EVENT],
        unrelated_category: unrelatedProgress,
      },
    };

    await act(async () => {
      root.render(<ScheduleContent />);
      await Promise.resolve();
    });

    await act(async () => {
      findButton(container, "테스트 일정 삭제").click();
      await Promise.resolve();
    });

    expect(authState.updateJourney).toHaveBeenCalledTimes(1);
    expect(authState.updateJourney).toHaveBeenCalledWith({
      progress: {
        __events: [],
        unrelated_category: unrelatedProgress,
      },
    });
  });

  it("persists canonical assignee, completion criteria, and status through the schedule save boundary", async () => {
    authState.journey = {
      wedding_date: null,
      progress: {
        unrelated_category: {
          status: "not_started",
        },
      },
    };

    await act(async () => {
      root.render(<ScheduleContent />);
      await Promise.resolve();
    });

    await act(async () => {
      findButton(container, "테스트 일정 추가").click();
      await Promise.resolve();
    });
    await act(async () => {
      findButton(container, "테스트 실행 일정 저장").click();
      await Promise.resolve();
    });

    expect(authState.updateJourney).toHaveBeenCalledTimes(1);
    const call = authState.updateJourney.mock.calls[0]?.[0] as {
      progress: Record<string, unknown>;
    };
    const events = call.progress.__events as Array<Record<string, unknown>>;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      date: "2027-05-20",
      title: "드레스 최종 확인",
      status: "completed",
      completionCriteria: "수선 결과 확인",
      assignee: {
        kind: "member",
        profileId: "4ed560aa-52e6-47d2-9595-612d0bfe2c7b",
      },
    });
    expect(JSON.stringify(events[0])).not.toContain("수현");
    expect(call.progress.unrelated_category).toEqual({
      status: "not_started",
    });
  });
});
