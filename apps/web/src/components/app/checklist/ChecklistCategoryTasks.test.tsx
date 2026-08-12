// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProgressItem } from "@/types/database.types";

const mocks = vi.hoisted(() => ({
  journey: { progress: {} as Record<string, ProgressItem>, state_revision: 7 } as {
    progress: Record<string, ProgressItem>;
    state_revision?: number;
  },
  profile: { id: "viewer-profile-id", name: "지은" } as { id: string; name: string } | null,
  partner: { id: "partner-profile-id", name: "민준" } as { id: string; name: string } | null,
  updateJourney: vi.fn(),
  refreshJourney: vi.fn(),
  isDemo: true,
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    journey: mocks.journey,
    profile: mocks.profile,
    partner: mocks.partner,
    updateJourney: mocks.updateJourney,
    refreshJourney: mocks.refreshJourney,
    isDemo: mocks.isDemo,
  }),
}));

import ChecklistCategoryTasks from "./ChecklistCategoryTasks";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};

describe("ChecklistCategoryTasks", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    mocks.journey = { progress: {}, state_revision: 7 };
    mocks.profile = { id: "viewer-profile-id", name: "지은" };
    mocks.partner = { id: "partner-profile-id", name: "민준" };
    mocks.updateJourney.mockReset();
    mocks.updateJourney.mockResolvedValue({ status: "applied" });
    mocks.refreshJourney.mockReset();
    mocks.refreshJourney.mockResolvedValue(true);
    mocks.isDemo = true;
    window.history.replaceState(null, "", "/wedding/checklist/meeting");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  async function render(categoryKey = "meeting") {
    await act(async () => root.render(<ChecklistCategoryTasks categoryKey={categoryKey} />));
  }

  function checkboxAt(index: number) {
    return container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[index];
  }

  async function changeControl(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
    const prototype = control instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    await act(async () => {
      valueSetter?.call(control, value);
      control.dispatchEvent(new Event("change", { bubbles: true }));
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("merges saved completion and preserves a saved-only legacy item", async () => {
    mocks.journey = {
      progress: {
        meeting: {
          category: "meeting",
          status: "in_progress",
          checklist: [
            { id: "meeting_01", label: "옛 라벨", done: true },
            { id: "meeting_personal", label: "우리만의 추가 확인", done: false },
          ],
        },
      },
    };

    await render();

    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(7);
    expect(checkboxAt(0).checked).toBe(true);
    expect(checkboxAt(0).labels?.[0]?.textContent).toContain(
      "양쪽 부모님 첫 만남 날짜 조율",
    );
    expect(container.textContent).toContain("양쪽 부모님 첫 만남 날짜 조율");
    expect(container.textContent).toContain("우리만의 추가 확인");
  });

  it("updates immediately and sends only canonical checklist state", async () => {
    let resolveSave: ((value: { status: "applied" }) => void) | undefined;
    mocks.updateJourney.mockReturnValue(new Promise((resolve) => {
      resolveSave = resolve;
    }));
    await render();

    await act(async () => checkboxAt(0).click());

    expect(checkboxAt(0).checked).toBe(true);
    expect(mocks.updateJourney).toHaveBeenCalledTimes(1);
    const request = mocks.updateJourney.mock.calls[0][0] as {
      progress: Record<string, ProgressItem>;
    };
    expect(request.progress.meeting.status).toBe("in_progress");
    expect(request.progress.meeting.checklist?.[0]).toMatchObject({
      id: "meeting_01",
      label: "양쪽 부모님 첫 만남 날짜 조율",
      done: true,
      state: "completed",
      completedByProfileId: "viewer-profile-id",
    });
    expect(request.progress.meeting.checklist?.[0].completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(request.progress.meeting).not.toHaveProperty("tips");

    await act(async () => resolveSave?.({ status: "applied" }));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("저장했어요");
  });

  it("pins a real save to the revision that rendered the edited item", async () => {
    mocks.isDemo = false;
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args;
      return new Response(
      JSON.stringify({
        error: "그 사이 준비 정보가 바뀌었어요.",
        code: "PLAN_CHANGE_STALE",
      }),
      { status: 409, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    await render();

    // Realtime이 store를 먼저 갱신해도 아직 렌더된 편집 기준은 revision 7이다.
    mocks.journey = { ...mocks.journey, state_revision: 8 };
    await act(async () => checkboxAt(0).click());

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.expected_revision).toBe(7);
    expect(body.progress_patch.meeting.checklist[0]).toMatchObject({
      id: "meeting_01",
      done: true,
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("그 사이");
    expect(mocks.updateJourney).not.toHaveBeenCalled();
  });

  it("separates routine details from a partner assignment approval", async () => {
    mocks.isDemo = false;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        expected_revision: number;
        progress_patch: Record<string, ProgressItem>;
      };
      if (body.expected_revision === 7) {
        return new Response(JSON.stringify({
          status: "applied",
          requestId: "33333333-3333-4333-8333-333333333333",
          journey: {
            couple_id: "22222222-2222-4222-8222-222222222222",
            state_revision: 8,
            progress: body.progress_patch,
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        status: "pending_partner",
        requestId: "44444444-4444-4444-8444-444444444444",
        summary: "부모님 첫 만남 · 날짜 조율: 담당 미정 → 민준",
      }), { status: 202, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await render();

    const detailsButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="양쪽 부모님 첫 만남 날짜 조율 상세 열기"]',
    );
    await act(async () => detailsButton?.click());
    const state = container.querySelector<HTMLSelectElement>(
      '[aria-label="양쪽 부모님 첫 만남 날짜 조율 상태"]',
    );
    const assignee = container.querySelector<HTMLSelectElement>(
      '[aria-label="양쪽 부모님 첫 만남 날짜 조율 담당자"]',
    );
    if (!state || !assignee) throw new Error("detail controls missing");
    await changeControl(state, "in_progress");
    await changeControl(assignee, "member:partner-profile-id");
    const save = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("변경 내용 저장"),
    );
    await act(async () => save?.click());

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    const second = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    expect(first.expected_revision).toBe(7);
    expect(first.progress_patch.meeting.checklist[0]).toMatchObject({
      state: "in_progress",
    });
    expect(first.progress_patch.meeting.checklist[0]).not.toHaveProperty("assignee");
    expect(second.expected_revision).toBe(8);
    expect(second.progress_patch.meeting.checklist[0]).toMatchObject({
      state: "in_progress",
      assignee: { kind: "member", profileId: "partner-profile-id" },
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("담당자 변경");
  });

  it("opens an item workspace with completion guidance and execution fields", async () => {
    await render();

    const detailsButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="양쪽 부모님 첫 만남 날짜 조율 상세 열기"]',
    );
    expect(detailsButton).not.toBeNull();
    await act(async () => detailsButton?.click());

    expect(detailsButton?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("완료 기준");
    expect(container.textContent).toContain("실전 팁");
    expect(container.textContent).toContain("주의");
    expect(container.querySelector('[aria-label="양쪽 부모님 첫 만남 날짜 조율 상태"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="양쪽 부모님 첫 만남 날짜 조율 담당자"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="양쪽 부모님 첫 만남 날짜 조율 항목 기한"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="양쪽 부모님 첫 만남 날짜 조율 메모"]')).not.toBeNull();
    expect(container.textContent).toContain("항목 기한 (파트너와 공유)");
    expect(container.textContent).toContain("둘이 보는 메모");
  });

  it("saves state, immutable assignee id, personal due date, and note together", async () => {
    await render();
    const itemLabel = "양쪽 부모님 첫 만남 날짜 조율";
    await act(async () => container.querySelector<HTMLButtonElement>(
      `button[aria-label="${itemLabel} 상세 열기"]`,
    )?.click());

    const state = container.querySelector<HTMLSelectElement>(`[aria-label="${itemLabel} 상태"]`);
    const assignee = container.querySelector<HTMLSelectElement>(`[aria-label="${itemLabel} 담당자"]`);
    const dueDate = container.querySelector<HTMLInputElement>(`[aria-label="${itemLabel} 항목 기한"]`);
    const note = container.querySelector<HTMLTextAreaElement>(`[aria-label="${itemLabel} 메모"]`);
    expect(state && assignee && dueDate && note).toBeTruthy();

    await changeControl(state!, "waiting");
    await changeControl(assignee!, "member:partner-profile-id");
    await changeControl(dueDate!, "2026-08-20");
    await changeControl(note!, "식사 가능 시간을 양가에 각각 확인함");
    await act(async () => Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("변경 내용 저장"),
    )?.click());

    const request = mocks.updateJourney.mock.calls[0][0] as {
      progress: Record<string, ProgressItem>;
    };
    expect(request.progress.meeting.checklist?.[0]).toMatchObject({
      id: "meeting_01",
      state: "waiting",
      done: false,
      assignee: { kind: "member", profileId: "partner-profile-id" },
      dueDate: "2026-08-20",
      note: "식사 가능 시간을 양가에 각각 확인함",
    });
  });

  it("keeps an existing partner assignment by stable profile id when details are saved again", async () => {
    mocks.journey = {
      progress: {
        meeting: {
          category: "meeting",
          status: "in_progress",
          checklist: [{
            id: "meeting_01",
            label: "양쪽 부모님 첫 만남 날짜 조율",
            done: false,
            state: "waiting",
            assignee: { kind: "member", profileId: "partner-profile-id" },
          }],
        },
      },
    };
    await render();
    const label = "양쪽 부모님 첫 만남 날짜 조율";
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${label} 상세 열기"]`)?.click());

    const assignee = container.querySelector<HTMLSelectElement>(`[aria-label="${label} 담당자"]`);
    expect(assignee?.value).toBe("member:partner-profile-id");
    expect(assignee?.selectedOptions[0]?.textContent).toContain("민준");
    await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("변경 내용 저장"))?.click());

    const request = mocks.updateJourney.mock.calls[0][0] as { progress: Record<string, ProgressItem> };
    expect(request.progress.meeting.checklist?.[0].assignee).toEqual({
      kind: "member",
      profileId: "partner-profile-id",
    });
  });

  it("hides the partner choice for a solo account without dropping a previously stored member id", async () => {
    mocks.partner = null;
    mocks.journey = {
      progress: {
        meeting: {
          category: "meeting",
          status: "in_progress",
          checklist: [{
            id: "meeting_01",
            label: "양쪽 부모님 첫 만남 날짜 조율",
            done: false,
            assignee: { kind: "member", profileId: "unavailable-member-id" },
          }],
        },
      },
    };
    await render();
    const label = "양쪽 부모님 첫 만남 날짜 조율";
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${label} 상세 열기"]`)?.click());

    const assignee = container.querySelector<HTMLSelectElement>(`[aria-label="${label} 담당자"]`);
    expect(Array.from(assignee?.options ?? []).some((option) => option.textContent?.includes("(파트너)"))).toBe(false);
    expect(assignee?.value).toBe("member:unavailable-member-id");
    expect(assignee?.selectedOptions[0]?.textContent).toBe("연결된 구성원");
  });

  it("shows who completed an item and when without exposing its note in the collapsed row", async () => {
    mocks.journey = {
      progress: {
        meeting: {
          category: "meeting",
          status: "in_progress",
          checklist: [{
            id: "meeting_01",
            label: "양쪽 부모님 첫 만남 날짜 조율",
            done: true,
            state: "completed",
            completedAt: "2026-08-12T03:00:00.000Z",
            completedByProfileId: "partner-profile-id",
            note: "가족 전화번호와 민감한 사정",
          }],
        },
      },
    };
    await render();

    const label = "양쪽 부모님 첫 만남 날짜 조율";
    const rowButton = container.querySelector<HTMLButtonElement>(`button[aria-label="${label} 상세 열기"]`);
    expect(rowButton?.textContent).not.toContain("가족 전화번호와 민감한 사정");
    await act(async () => rowButton?.click());
    expect(container.textContent).toContain("민준님이 8월 12일 완료");
  });

  it("does not invent completion provenance when editing a legacy completed item", async () => {
    mocks.journey = {
      progress: {
        meeting: {
          category: "meeting",
          status: "in_progress",
          checklist: [{
            id: "meeting_01",
            label: "legacy completed item",
            done: true,
            state: "completed",
          }],
        },
      },
    };
    await render();

    const row = container.querySelector<HTMLElement>("#task-meeting_01");
    await act(async () => row?.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click());
    const note = row?.querySelector<HTMLTextAreaElement>("textarea");
    expect(note).toBeTruthy();
    await changeControl(note!, "legacy memo");
    const saveButton = Array.from(row?.querySelectorAll<HTMLButtonElement>("button") ?? []).at(-1);
    await act(async () => saveButton?.click());

    const request = mocks.updateJourney.mock.calls[0][0] as { progress: Record<string, ProgressItem> };
    const saved = request.progress.meeting.checklist?.[0];
    expect(saved).toMatchObject({ state: "completed", done: true, note: "legacy memo" });
    expect(saved).not.toHaveProperty("completedAt");
    expect(saved).not.toHaveProperty("completedByProfileId");
  });

  it("does not send a second mutation while the first save is pending", async () => {
    let resolveSave: ((value: { status: "applied" }) => void) | undefined;
    mocks.updateJourney.mockReturnValue(new Promise((resolve) => {
      resolveSave = resolve;
    }));
    await render();

    await act(async () => checkboxAt(0).click());
    await act(async () => checkboxAt(1).click());

    expect(mocks.updateJourney).toHaveBeenCalledTimes(1);
    expect(checkboxAt(1).checked).toBe(false);

    await act(async () => resolveSave?.({ status: "applied" }));
  });

  it("rolls back optimistic state while a partner decision is pending", async () => {
    mocks.updateJourney.mockResolvedValue({ status: "pending_partner" });
    await render();

    await act(async () => checkboxAt(0).click());

    expect(checkboxAt(0).checked).toBe(false);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("확인 요청");
  });

  it("rolls back and exposes an alert when saving fails", async () => {
    mocks.updateJourney.mockRejectedValue(new Error("저장 연결을 확인해 주세요."));
    await render();

    await act(async () => checkboxAt(0).click());

    expect(checkboxAt(0).checked).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("저장 연결");
  });

  it("keeps a newer partner update when an older save request fails", async () => {
    let rejectSave: ((error: Error) => void) | undefined;
    mocks.updateJourney.mockReturnValue(new Promise((_resolve, reject) => {
      rejectSave = reject;
    }));
    await render();

    await act(async () => checkboxAt(0).click());
    expect(checkboxAt(0).checked).toBe(true);

    mocks.journey = {
      progress: {
        meeting: {
          category: "meeting",
          status: "in_progress",
          checklist: [{ id: "meeting_02", label: "장소", done: true }],
        },
      },
    };
    await act(async () => root.render(<ChecklistCategoryTasks categoryKey="meeting" />));
    expect(checkboxAt(0).checked).toBe(false);
    expect(checkboxAt(1).checked).toBe(true);

    await act(async () => rejectSave?.(new Error("이전 저장 실패")));
    expect(checkboxAt(0).checked).toBe(false);
    expect(checkboxAt(1).checked).toBe(true);
  });

  it("excludes the category without erasing previous completion", async () => {
    mocks.journey = {
      progress: {
        meeting: {
          category: "meeting",
          status: "not_applicable",
          checklist: [{ id: "meeting_01", label: "옛 라벨", done: true }],
        },
      },
    };
    await render();

    expect(checkboxAt(0).checked).toBe(true);
    expect(checkboxAt(0).disabled).toBe(true);
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("0");

    const restore = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("다시 준비 목록에 넣기"),
    );
    await act(async () => restore?.click());

    const request = mocks.updateJourney.mock.calls[0][0] as {
      progress: Record<string, ProgressItem>;
    };
    expect(request.progress.meeting.status).toBe("in_progress");
    expect(request.progress.meeting.checklist?.[0].done).toBe(true);
  });

  it("marks an applicable category as explicitly reviewed", async () => {
    await render();
    const confirm = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("우리에게 필요한 준비예요"),
    );
    expect(confirm).toBeTruthy();
    await act(async () => confirm?.click());

    const request = mocks.updateJourney.mock.calls[0][0] as {
      progress: Record<string, ProgressItem>;
    };
    expect(request.progress.meeting).toMatchObject({
      checklistReviewSource: "manual",
      checklistReviewedByProfileId: "viewer-profile-id",
    });
    expect(request.progress.meeting.checklistReviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("opens and focuses the canonical item named by the URL hash", async () => {
    window.location.hash = "#task-meeting_02";
    await render();
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 1)));

    const button = container.querySelector<HTMLButtonElement>("#task-toggle-meeting_02");
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(button);
    expect(container.querySelector("#task-details-meeting_02")).not.toBeNull();
  });
});
