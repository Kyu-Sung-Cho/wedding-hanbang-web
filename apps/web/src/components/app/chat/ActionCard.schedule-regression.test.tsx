import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ActionCard from "./ActionCard";
import type { ToolExecutionResult } from "@/types/database.types";

// QA regression: .gstack/qa-reports/qa-report-127-0-0-1-3010-2026-07-18.md
// A mutation card must describe the changed schedule item, not the whole current checklist.

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    journey: {
      progress: {
        venue: {
          category: "venue",
          status: "in_progress",
          checklist: [
            { id: "venue_01", label: "후보 예식장 찾기", done: true },
            { id: "venue_02", label: "견적 비교", done: false },
          ],
        },
      },
    },
    updateJourney: vi.fn(),
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

    const change = container.querySelector('[aria-label="드레스/턱시도 상태 변경 결과"]');
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

    const change = container.querySelector('[aria-label="예식장 체크리스트 변경 결과"]');
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
});
