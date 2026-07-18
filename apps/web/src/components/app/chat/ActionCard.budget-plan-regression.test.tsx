import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ActionCard from "./ActionCard";
import type { ToolExecutionResult } from "@/types/database.types";

// QA regression: .gstack/qa-reports/qa-report-127-0-0-1-3010-2026-07-18.md
// Every budget mutation must show the values it actually changed.

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    journey: { total_budget: 27_000_000, progress: {} },
    updateJourney: vi.fn(),
  }),
}));

function result(overrides: Partial<ToolExecutionResult>): ToolExecutionResult {
  return {
    toolName: "apply_budget_plan",
    toolInput: {
      total_budget: 30_000_000,
      allocations: [
        { category: "venue", budget: 12_000_000 },
        { category: "ring", budget: 3_000_000 },
      ],
    },
    toolOutput: {
      total_budget: 30_000_000,
      previous_budget: 27_000_000,
      allocations: [
        { category: "venue", budget: 12_000_000 },
        { category: "ring", budget: 3_000_000 },
        { category: "reserve", budget: 15_000_000 },
      ],
    },
    success: true,
    displayMessage: "총예산 3,000만원 기준으로 3개 항목의 배분을 적용했어요.",
    ...overrides,
  };
}

describe("ActionCard remaining budget mutation results", () => {
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

  it("shows the applied total and category allocations", async () => {
    await act(async () => {
      root.render(<ActionCard result={result({})} />);
    });

    const plan = container.querySelector('[aria-label="예산안 적용 결과"]');
    expect(plan?.textContent).toContain("3,000만원");
    expect(plan?.textContent).toContain("예식장");
    expect(plan?.textContent).toContain("1,200만원");
    expect(plan?.textContent).toContain("예물");
    expect(plan?.textContent).toContain("300만원");
    expect(plan?.textContent).toContain("예비비");
    expect(plan?.textContent).toContain("1,500만원");
  });

  it("shows amounts supplied while adding a custom budget category", async () => {
    await act(async () => {
      root.render(
        <ActionCard
          result={result({
            toolName: "add_custom_category",
            toolInput: { label: "포토부스", budget: 800_000, spent: 100_000 },
            toolOutput: { key: "custom_photo", label: "포토부스", created: true },
            displayMessage: '새 예산 항목 "포토부스"를 추가했어요.',
          })}
        />,
      );
    });

    const change = container.querySelector('[aria-label="포토부스 예산·지출 변경 결과"]');
    expect(change?.textContent).toContain("변경된 예산");
    expect(change?.textContent).toContain("80만원");
    expect(change?.textContent).toContain("변경된 지출");
    expect(change?.textContent).toContain("10만원");
  });
});
