// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProgressItem } from "@/types/database.types";

const mocks = vi.hoisted(() => ({
  journey: { progress: {} as Record<string, ProgressItem> },
  updateJourney: vi.fn(),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    journey: mocks.journey,
    updateJourney: mocks.updateJourney,
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
    mocks.journey = { progress: {} };
    mocks.updateJourney.mockReset();
    mocks.updateJourney.mockResolvedValue({ status: "applied" });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  async function render(categoryKey = "meeting") {
    await act(async () => root.render(<ChecklistCategoryTasks categoryKey={categoryKey} />));
  }

  function checkboxAt(index: number) {
    return container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[index];
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
    expect(request.progress.meeting.checklist?.[0]).toEqual({
      id: "meeting_01",
      label: "양쪽 부모님 첫 만남 날짜 조율",
      done: true,
    });
    expect(request.progress.meeting).not.toHaveProperty("tips");

    await act(async () => resolveSave?.({ status: "applied" }));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("저장했어요");
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
});
