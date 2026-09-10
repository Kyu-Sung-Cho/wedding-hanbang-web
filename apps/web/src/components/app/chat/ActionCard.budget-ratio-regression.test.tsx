import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import type { ToolExecutionResult } from "@/types/database.types";
import ActionCard from "./ActionCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const authState = vi.hoisted(() => ({
  journey: null as unknown,
  updateJourney: vi.fn(),
}));

vi.mock("@/stores/authStore", () => ({ useAuthStore: () => authState }));

const summaryResult: ToolExecutionResult = {
  toolName: "get_budget_summary",
  toolInput: {},
  toolOutput: {},
  success: true,
  displayMessage: "현재 예산 현황이에요.",
};

describe("예산 요약 카드의 지출 비율과 정확한 금액", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    authState.journey = null;
    authState.updateJourney.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function renderSummary(totalBudget: unknown, progress: Record<string, unknown>) {
    authState.journey = { total_budget: totalBudget, progress };
    await act(async () => root.render(<ActionCard result={summaryResult} />));
  }

  function exactSpans(text: string) {
    return [...container.querySelectorAll("span")].filter((span) => span.textContent === text);
  }

  it.each([
    [0, 35_000_000, "0%", "0%"],
    [1, 35_000_000, "0.1% 미만", "0%"],
    [123_000, 35_000_000, "약 0.4%", "0%"],
    [25_000, 100_000, "25%", "25%"],
    [99_600, 100_000, "99.6%", "100%"],
    [100_001, 100_000, "약 100%", "100%"],
    [120_000, 100_000, "120%", "100%"],
  ])("지출 %s / 예산 %s의 총·분야 문구를 정확히 표시하고 기존 막대는 유지한다", async (spent, budget, ratio, barWidth) => {
    await renderSummary(budget, { venue: { budget, spent } });

    expect(exactSpans(ratio)).toHaveLength(2);
    expect(container.querySelector<HTMLElement>('[style*="width"]')?.style.width).toBe(barWidth);
    expect(container.textContent).toContain("기록 지출은 결제 완료 여부와 별도예요.");
    expect(authState.updateJourney).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 0, -1, Number.MAX_SAFE_INTEGER + 1])(
    "총예산 %s에서는 기존처럼 요약 미니카드를 생략한다",
    async (totalBudget) => {
      await renderSummary(totalBudget, { venue: { budget: 100_000, spent: 1 } });
      expect(container.textContent).toContain("현재 예산 현황이에요.");
      expect(container.textContent).not.toContain("기록 지출 총");
      expect(container.textContent).not.toContain("NaN");
      expect(container.textContent).not.toContain("Infinity");
    },
  );

  it("분야 예산 미입력과 0원 예산을 비율 0%로 오인시키지 않는다", async () => {
    await renderSummary(35_000_000, {
      venue: { spent: 1 },
      studio: { budget: 0, spent: 2 },
    });

    expect(exactSpans("미입력")).toHaveLength(1);
    expect(exactSpans("0원")).toHaveLength(1);
    expect(exactSpans("0.1% 미만")).toHaveLength(1);
    expect(exactSpans("0%")).toHaveLength(0);
    expect([...container.querySelectorAll<HTMLElement>('[style*="width"]')].map((bar) => bar.style.width)).toEqual(["0%", "0%"]);
  });

  it("숨긴 분야·사용자 항목·명시 지출만 합산하는 기존 계약을 보존한다", async () => {
    const progress = {
      __hidden: ["venue"],
      venue: { budget: 20_000_000, spent: 5_000_000 },
      studio: { budget: 10_000_000, cost: 9_000_000, spent: 0 },
      custom_gifts: { label: "초대장·꽃·하객선물", budget: 1_500_000, spent: 123_000, payer: "couple", memo: "보존할 메모" },
    };
    const before = structuredClone(progress);
    await renderSummary(35_000_000, progress);

    expect(container.textContent).toContain("기록 지출 총 123,000원 / 3,500만원");
    expect(exactSpans("약 0.4%")).toHaveLength(1);
    expect(exactSpans(PLANNING_CATEGORY_LABELS.venue)).toHaveLength(0);
    expect(progress).toEqual(before);
    expect(authState.updateJourney).not.toHaveBeenCalled();
  });

  it("긴 정확 금액과 총·분야 비율의 모든 자릿수를 보존하고 막대만 100%로 제한한다", async () => {
    await renderSummary(1, { venue: { budget: 1, spent: 12_345_678_901 } });

    const amount = exactSpans("12,345,678,901원")[0];
    const totalText = exactSpans("기록 지출 총 12,345,678,901원 / 1원")[0];
    expect(amount).toBeDefined();
    expect(totalText).toBeDefined();
    expect(exactSpans("1,234,567,890,100%")).toHaveLength(2);
    expect(container.querySelector<HTMLElement>('[style*="width"]')?.style.width).toBe("100%");
  });
});
