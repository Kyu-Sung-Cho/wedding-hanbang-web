import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ActionCard from "./ActionCard";
import type { ToolExecutionResult } from "@/types/database.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    journey: {
      total_budget: 27_000_000,
      progress: {
        ring: {
          category: "ring",
          status: "not_started",
          budget: 3_000_000,
          spent: 0,
        },
        studio: {
          category: "studio",
          status: "completed",
          cost: 9_000_000,
        },
      },
    },
    updateJourney: vi.fn(),
  }),
}));

function result(overrides: Partial<ToolExecutionResult>): ToolExecutionResult {
  return {
    toolName: "update_category_budget",
    toolInput: { category: "ring", budget: 3_000_000 },
    toolOutput: {
      category: "ring",
      budget: 3_000_000,
      progress_key: "ring",
      progress_value: {
        category: "ring",
        status: "not_started",
        budget: 3_000_000,
        spent: 0,
      },
    },
    success: true,
    displayMessage: "예물 예산 300만원으로 설정되었습니다.",
    ...overrides,
  };
}

describe("ActionCard budget results", () => {
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

  it("shows the changed category budget instead of the spending summary", async () => {
    await act(async () => {
      root.render(<ActionCard result={result({})} />);
    });

    expect(container.querySelector('[aria-label="결혼반지·기념 선물 예산 변경 결과"]')).not.toBeNull();
    expect(container.textContent).toContain("예산");
    expect(container.textContent).toContain("300만원");
    expect(container.textContent).not.toContain("총 0원 / 2,700만원");
    expect(container.textContent).not.toContain("0%");
  });

  it("shows the previous and changed total budget without spending rows", async () => {
    await act(async () => {
      root.render(
        <ActionCard
          result={result({
            toolName: "update_budget",
            toolInput: { total_budget: 30_000_000 },
            toolOutput: { total_budget: 30_000_000, previous_budget: 27_000_000 },
            displayMessage: "총예산을 2,700만원에서 3,000만원으로 변경했어요.",
          })}
        />,
      );
    });

    const change = container.querySelector('[aria-label="총 예산 변경 결과"]');
    expect(change?.textContent).toContain("2,700만원");
    expect(change?.textContent).toContain("3,000만원");
    expect(container.textContent).not.toContain("예식장");
    expect(container.textContent).not.toContain("0%");
  });

  it("labels a spending-only mutation as a spending change", async () => {
    await act(async () => {
      root.render(
        <ActionCard
          result={result({
            toolInput: { category: "ring", spent: 500_000 },
            toolOutput: { category: "ring", spent: 500_000 },
            displayMessage: "예물 기록 지출 50만원으로 설정되었습니다.",
          })}
        />,
      );
    });

    expect(container.textContent).toContain("카테고리 기록 지출 변경");
    expect(container.querySelector('[aria-label="결혼반지·기념 선물 기록 지출 변경 결과"]')).not.toBeNull();
    expect(container.textContent).toContain("변경된 기록 지출");
    expect(container.textContent).toContain("50만원");
    expect(container.textContent).not.toContain("총 0원 / 2,700만원");
  });

  it("keeps the spending summary for an explicit budget-summary result", async () => {
    await act(async () => {
      root.render(
        <ActionCard
          result={result({
            toolName: "get_budget_summary",
            toolInput: {},
            toolOutput: { total_budget: 27_000_000, total_spent: 0 },
            displayMessage: "현재 예산 현황입니다.",
          })}
        />,
      );
    });

    expect(container.textContent).toContain("기록 지출 총 0원 / 2,700만원");
    expect(container.textContent).toContain("0%");
    expect(container.textContent).toContain("결제 완료 여부와 별도");
    expect(container.textContent).not.toContain("900만원");
  });
});
