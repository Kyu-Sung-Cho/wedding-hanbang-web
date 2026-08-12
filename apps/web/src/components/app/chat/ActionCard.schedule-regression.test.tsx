import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ActionCard from "./ActionCard";
import type { ProgressItem, ToolExecutionResult } from "@/types/database.types";

// QA regression: .gstack/qa-reports/qa-report-127-0-0-1-3010-2026-07-18.md
// A mutation card must describe the changed schedule item, not the whole current checklist.

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const actionMocks = vi.hoisted(() => ({
  updateJourney: vi.fn(),
  progress: {
    venue: {
      category: "venue",
      status: "in_progress",
      checklist: [
        { id: "venue_01", label: "후보 예식장 찾기", done: true },
        { id: "venue_02", label: "견적 비교", done: false },
      ],
    },
  } as Record<string, ProgressItem>,
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    profile: { id: "11111111-1111-4111-8111-111111111111", name: "나" },
    journey: {
      progress: actionMocks.progress,
    },
    updateJourney: actionMocks.updateJourney,
  }),
}));

function result(overrides: Partial<ToolExecutionResult> = {}): ToolExecutionResult {
  return {
    toolName: "update_task_status",
    toolInput: { category: "dress", status: "completed" },
    toolOutput: { category: "dress", status: "completed" },
    success: true,
    displayMessage: "드레스/턱시도 상태를 완료로 변경했어요.",
    ...overrides,
  };
}

describe("ActionCard schedule mutation regression", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    actionMocks.progress.venue.status = "in_progress";
    actionMocks.updateJourney.mockReset();
    actionMocks.updateJourney.mockResolvedValue({ status: "applied" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("shows the status that changed instead of an unrelated checklist summary", async () => {
    await act(async () => {
      root.render(<ActionCard result={result()} />);
    });

    const change = container.querySelector('[aria-label="드레스·예식 정장 상태 변경 결과"]');
    expect(change?.textContent).toContain("완료");
    expect(container.textContent).not.toContain("후보 예식장 찾기");
    expect(container.textContent).not.toContain("1/2");
  });

  it("shows only the checklist item that changed", async () => {
    await act(async () => {
      root.render(
        <ActionCard
          result={result({
            toolName: "toggle_checklist_item",
            toolInput: { category: "venue", item_id: "venue_02", done: true },
            toolOutput: {
              category: "venue",
              item_id: "venue_02",
              item_label: "견적 비교",
              done: true,
              new_status: "completed",
            },
            displayMessage: '예식장의 "견적 비교" 항목을 완료로 변경했어요.',
          })}
        />,
      );
    });

    const change = container.querySelector('[aria-label="결혼식장 체크리스트 변경 결과"]');
    expect(change?.textContent).toContain("견적 비교");
    expect(change?.textContent).toContain("완료");
    expect(container.textContent).not.toContain("후보 예식장 찾기");
    expect(container.textContent).not.toContain("1/2");
  });

  it("does not append the current schedule to a failed mutation", async () => {
    await act(async () => {
      root.render(
        <ActionCard
          result={result({
            toolOutput: { error: "no_change" },
            success: false,
            displayMessage: "이미 같은 진행 상태로 설정되어 있어요.",
          })}
        />,
      );
    });

    expect(container.textContent).toContain("이미 같은 진행 상태");
    expect(container.textContent).not.toContain("후보 예식장 찾기");
    expect(container.textContent).not.toContain("1/2");
  });

  it("keeps done, state, and completion audit consistent when the summary card toggles an item", async () => {
    await act(async () => {
      root.render(
        <ActionCard
          result={result({
            toolName: "get_schedule_summary",
            toolInput: {},
            toolOutput: { progress_percent: 50 },
            displayMessage: "현재 준비 현황입니다.",
          })}
        />,
      );
    });

    const quoteButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("비교할 장소 후보 정리"));
    expect(quoteButton).toBeDefined();
    await act(async () => {
      quoteButton?.click();
    });

    const update = actionMocks.updateJourney.mock.calls[0]?.[0] as {
      progress: Record<string, ProgressItem>;
    };
    const changed = update.progress.venue.checklist?.find((item) => item.id === "venue_02");
    expect(changed).toMatchObject({
      done: true,
      state: "completed",
      completedByProfileId: "11111111-1111-4111-8111-111111111111",
    });
    expect(changed?.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(update.progress.venue.status).toBe("completed");
  });

  it("does not expose item toggles for a category explicitly excluded by the couple", async () => {
    actionMocks.progress.venue.status = "not_applicable";
    await act(async () => {
      root.render(<ActionCard result={result({
        toolName: "get_schedule_summary",
        toolInput: {},
        toolOutput: { progress_percent: 50 },
        displayMessage: "현재 준비 현황입니다.",
      })} />);
    });

    expect(container.textContent).not.toContain("견적 비교");
    expect(actionMocks.updateJourney).not.toHaveBeenCalled();
  });

  it("materializes a reviewed legacy completion as unconfirmed canonical work", async () => {
    actionMocks.progress.venue = {
      category: "venue",
      status: "completed",
    };
    await act(async () => {
      root.render(<ActionCard result={result({
        toolName: "get_schedule_summary",
        toolInput: {},
        toolOutput: { progress_percent: 0 },
        displayMessage: "현재 준비 현황입니다.",
      })} />);
    });

    expect(container.textContent).toContain("결혼식장");
    expect(container.textContent).toContain("0/8");
    expect(container.textContent).toContain("원하는 결혼식장 형태 정하기");
  });
});
