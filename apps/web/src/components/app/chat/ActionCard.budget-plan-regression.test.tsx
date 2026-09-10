import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ActionCard from "./ActionCard";
import type { ToolExecutionResult } from "@/types/database.types";
import { buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
import { getPersistableToolResults } from "@/lib/ai/placeSearchResultPolicy";

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
    expect(plan?.textContent).toContain("결혼식장");
    expect(plan?.textContent).toContain("1,200만원");
    expect(plan?.textContent).toContain("결혼반지·기념 선물");
    expect(plan?.textContent).toContain("300만원");
    expect(plan?.textContent).toContain("예비비·사용처 미정");
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

    const change = container.querySelector('[aria-label="포토부스 예산·기록 지출 변경 결과"]');
    expect(change?.textContent).toContain("변경된 예산");
    expect(change?.textContent).toContain("80만원");
    expect(change?.textContent).toContain("변경된 기록 지출");
    expect(change?.textContent).toContain("10만원");
  });

  it("keeps the actual custom allocation name when the receipt is rendered again from persisted metadata", async () => {
    const operation = buildAmoraAtomicToolOperation("apply_budget_plan", {
      total_budget: 35_000_000,
      allocations: [{ category: "custom", label: "초대장·꽃·하객선물", budget: 1_500_000 }],
    }, {
      coupleId: "10000000-0000-4000-8000-000000000001",
      requestKey: "chat:20000000-0000-4000-8000-000000000001:30000000-0000-4000-8000-000000000001",
      requestAttemptCount: 1,
      providerCallIndex: 1,
      weddingContext: { weddingDate: null, budget: 0, venue: null, progress: {} },
    });
    expect(operation.result.success).toBe(true);
    const before = JSON.stringify(operation.result);
    const persisted = getPersistableToolResults(JSON.parse(JSON.stringify([operation.result])));
    expect(persisted).toHaveLength(1);

    for (const receipt of [operation.result, persisted[0]]) {
      await act(async () => root.render(<ActionCard result={receipt} />));
      const plan = container.querySelector('[aria-label="예산안 적용 결과"]');
      expect(plan?.textContent).toContain("초대장·꽃·하객선물");
      expect(plan?.textContent).toContain("150만원");
      expect(plan?.textContent).toContain("3,500만원");
      expect(plan?.textContent).not.toContain("custom_");
      if (receipt === operation.result) {
        await act(async () => root.unmount());
        root = createRoot(container);
      }
    }
    expect(JSON.stringify(operation.result)).toBe(before);
  });

  it("shows the custom name from legacy input-only receipts", async () => {
    await act(async () => root.render(<ActionCard result={result({
      toolInput: { total_budget: 2_000_000, allocations: [{ category: "custom", label: "초대장·꽃·하객선물", budget: 1_500_000 }] },
      toolOutput: { total_budget: 2_000_000, remainder_to_reserve: 500_000 },
    })} />));
    const plan = container.querySelector('[aria-label="예산안 적용 결과"]');
    expect(plan?.textContent).toContain("초대장·꽃·하객선물");
    expect(plan?.textContent).toContain("150만원");
    expect(plan?.textContent).toContain("예비비·사용처 미정");
    expect(plan?.textContent).toContain("50만원");
    expect(plan?.textContent).not.toContain("custom");
  });

  it.each([undefined, "   ", "초대장\u202e", "초대장\n꽃", "가".repeat(61), { value: "초대장" }])("does not expose a custom key or borrow an unrelated proposed name when the applied label is %j", async (label) => {
    await act(async () => root.render(<ActionCard result={result({
      toolInput: { allocations: [{ category: "custom", label: "다른 제안의 이름", budget: 9_900_000 }] },
      toolOutput: { total_budget: 1_500_000, allocations: [{ category: "custom_19324031db47e6ee6f64cb6a", label, budget: 1_500_000 }] },
    })} />));
    const plan = container.querySelector('[aria-label="예산안 적용 결과"]');
    expect(plan?.textContent).toContain("사용자 항목");
    expect(plan?.textContent).toContain("150만원");
    expect(plan?.textContent).not.toMatch(/custom_|다른 제안의 이름|990만원/);
  });

  it("uses a generic budget label for an unknown category instead of exposing its raw key", async () => {
    await act(async () => root.render(<ActionCard result={result({
      toolOutput: { total_budget: 123_456, allocations: [{ category: "legacy_internal_key", budget: 123_456 }] },
    })} />));
    const plan = container.querySelector('[aria-label="예산안 적용 결과"]');
    expect(plan?.textContent).toContain("예산 항목");
    expect(plan?.textContent).toContain("123,456원");
    expect(plan?.textContent).not.toContain("legacy_internal_key");
  });

  it("keeps standard category names authoritative over a supplied custom label", async () => {
    await act(async () => root.render(<ActionCard result={result({
      toolOutput: { total_budget: 12_000_000, allocations: [{ category: "venue", label: "잘못된 이름", budget: 12_000_000 }] },
    })} />));
    const plan = container.querySelector('[aria-label="예산안 적용 결과"]');
    expect(plan?.textContent).toContain("결혼식장");
    expect(plan?.textContent).toContain("1,200만원");
    expect(plan?.textContent).not.toContain("잘못된 이름");
  });

  it("renders separate legacy custom rows with equal amounts without duplicate React keys", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await act(async () => root.render(<ActionCard result={result({
        toolInput: {
          total_budget: 1_000_000,
          allocations: [
            { category: "custom", label: "초대장", budget: 500_000 },
            { category: "custom", label: "하객선물", budget: 500_000 },
          ],
        },
        toolOutput: { total_budget: 1_000_000 },
      })} />));
      const plan = container.querySelector('[aria-label="예산안 적용 결과"]');
      expect(plan?.textContent).toContain("초대장50만원");
      expect(plan?.textContent).toContain("하객선물50만원");
      expect(error.mock.calls.flat().join(" ")).not.toMatch(/same key|unique.*key/i);
    } finally {
      error.mockRestore();
    }
  });

  it.each([
    [4_999, "4,999원"],
    [5_000, "5,000원"],
    [15_000, "15,000원"],
  ] as const)("shows an exact won amount when %i is not a whole 만원", async (amount, expected) => {
    await act(async () => {
      root.render(
        <ActionCard
          result={result({
            toolName: "add_custom_category",
            toolInput: { label: "소액 항목", budget: amount },
            toolOutput: { key: "custom_small", label: "소액 항목", created: true },
            displayMessage: '새 예산 항목 "소액 항목"을 추가했어요.',
          })}
        />,
      );
    });

    const change = container.querySelector('[aria-label="소액 항목 예산 변경 결과"]');
    expect(change?.textContent).toContain(expected);
  });
});
