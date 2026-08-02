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
    isDemo: boolean;
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
    isDemo: false,
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
    onCancelEvent,
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
    onCancelEvent: (eventId: string) => Promise<void>;
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
            if (firstEvent) void onCancelEvent(firstEvent.id);
          }}
        >
          테스트 일정 취소 요청
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
    authState.profile = {
      id: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
      name: "테스트 사용자",
    };
    authState.isDemo = false;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("blocks add, edit, and cancellation when a valid event is mixed with malformed legacy data", async () => {
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
      findButton(container, "테스트 일정 취소 요청").click();
      await Promise.resolve();
    });

    expect(authState.updateJourney).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      SCHEDULE_EVENT_REPAIR_MESSAGE,
    );
  });

  it("soft-cancels from a valid event array while preserving unrelated raw progress", async () => {
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
      findButton(container, "테스트 일정 취소 요청").click();
      await Promise.resolve();
    });

    expect(authState.updateJourney).toHaveBeenCalledTimes(1);
    const call = authState.updateJourney.mock.calls[0]?.[0] as {
      progress: Record<string, unknown>;
    };
    const proposedEvents = call.progress.__events as Array<Record<string, unknown>>;
    expect(proposedEvents).toHaveLength(1);
    expect(proposedEvents[0]).toMatchObject({
      id: VALID_EVENT.id,
      date: VALID_EVENT.date,
      title: VALID_EVENT.title,
      createdAt: VALID_EVENT.createdAt,
      status: "cancelled",
      cancellation: {
        cancelledByProfileId: authState.profile.id,
      },
    });
    expect(proposedEvents[0].createdAt).toBe(VALID_EVENT.createdAt);
    expect(proposedEvents[0].updatedAt).toBe(
      (proposedEvents[0].cancellation as { cancelledAt: string }).cancelledAt,
    );
    expect(call.progress.unrelated_category).toEqual(unrelatedProgress);
  });

  it("describes a pending cancellation truthfully and keeps the stored event visible", async () => {
    const htmlLikeTitle = "<img src=x onerror=alert(1)>";
    const event = {
      ...VALID_EVENT,
      date: "2027-03-01",
      time: "14:00",
      title: htmlLikeTitle,
    };
    const serverSummary =
      `일정 취소: ${htmlLikeTitle} · 날짜: 2027-03-01 → 2027-03-01 · 시간: 14:00 → 14:00 · 상태: 예정 → 취소 · 취소 요청자: 예비 신부`;
    authState.updateJourney.mockResolvedValueOnce({
      status: "pending_partner",
      requestId: "27ea4536-2c66-46db-9a02-d2ca0f940399",
      summary: serverSummary,
    });
    authState.journey = {
      wedding_date: null,
      progress: { __events: [event] },
    };

    await act(async () => {
      root.render(<ScheduleContent />);
      await Promise.resolve();
    });
    await act(async () => {
      findButton(container, "테스트 일정 취소 요청").click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(serverSummary);
    expect(container.textContent).toContain("승인 전 기존 일정 유지");
    expect(container.textContent).toContain(htmlLikeTitle);
    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps demo cancellation auditable with a valid non-production actor id", async () => {
    authState.profile = { id: "demo", name: "데모 사용자" };
    authState.isDemo = true;
    authState.journey = {
      wedding_date: null,
      progress: { __events: [VALID_EVENT] },
    };

    await act(async () => {
      root.render(<ScheduleContent />);
      await Promise.resolve();
    });
    await act(async () => {
      findButton(container, "테스트 일정 취소 요청").click();
      await Promise.resolve();
    });

    const call = authState.updateJourney.mock.calls[0]?.[0] as {
      progress: { __events: Array<{ cancellation?: { cancelledByProfileId: string } }> };
    };
    expect(call.progress.__events[0]?.cancellation?.cancelledByProfileId).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it("shows cancelled events separately and restores them as planned", async () => {
    const serverSummary =
      "일정 복원: 스튜디오 미팅 · 날짜: 2027-05-01 → 2027-05-01 · 시간: 없음 → 없음 · 상태: 취소 → 예정 · 취소 기록: 있음 → 제거";
    authState.updateJourney.mockResolvedValueOnce({
      status: "pending_partner",
      requestId: "19e74b59-dfc6-4b26-a24f-6040bbb806af",
      summary: serverSummary,
    });
    authState.journey = {
      wedding_date: null,
      progress: {
        __events: [{
          ...VALID_EVENT,
          status: "cancelled",
          cancellation: {
            cancelledAt: "2026-08-01T12:30:00.000Z",
            cancelledByProfileId: authState.profile.id,
          },
          updatedAt: "2026-08-01T12:30:00.000Z",
        }],
      },
    };

    await act(async () => {
      root.render(<ScheduleContent />);
      await Promise.resolve();
    });
    expect(container.textContent).toContain("취소됨");
    expect(container.textContent).toContain(VALID_EVENT.title);
    expect(container.textContent).toContain("2026-08-01");

    await act(async () => {
      findButton(container, "복원 요청").click();
      await Promise.resolve();
    });
    const call = authState.updateJourney.mock.calls[0]?.[0] as {
      progress: Record<string, unknown>;
    };
    const restored = (call.progress.__events as Array<Record<string, unknown>>)[0];
    expect(restored.status).toBe("planned");
    expect(restored).not.toHaveProperty("cancellation");
    expect(container.textContent).toContain(serverSummary);
    expect(container.textContent).toContain(
      "파트너 승인 전에는 취소됨 상태가 유지됩니다.",
    );
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
