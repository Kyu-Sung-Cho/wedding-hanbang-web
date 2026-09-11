import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ActionCard from "./ActionCard";
import type { ToolExecutionResult } from "@/types/database.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const authState = vi.hoisted(() => ({ journey: null as unknown, updateJourney: vi.fn() }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: () => authState }));

function storedResult(): ToolExecutionResult {
  return {
    toolName: "get_budget_summary", toolInput: {}, success: true,
    displayMessage: "이 답변에서는 총예산 2,700만원과 기록 지출 150만원을 조회했어요.",
    toolOutput: {
      total_budget: 27_000_000, total_spent: 1_500_000,
      recorded_spend_basis: "explicit_spent_only", custom_categories_omitted: 0,
      categories: [{ key: "venue", label: "결혼식장", allocated: 10_000_000, allocated_is_set: true, spent: 1_500_000 }],
    },
  };
}

describe("예산 그래픽의 답변 당시 값과 현재 값 구분", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    authState.journey = { total_budget: 35_000_000, progress: { venue: { budget: 12_000_000, spent: 123_000 } } };
    authState.updateJourney.mockReset();
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); });
  async function render(result: ToolExecutionResult) { await act(async () => root.render(<ActionCard result={result} />)); }

  it("저장된 조회값은 예산 갱신·현재 계정 상태 변경 후에도 같은 당시 값으로 남는다", async () => {
    const result = storedResult(), original = structuredClone(result);
    await render(result);
    expect(container.textContent).toContain("이 답변에서 조회한 예산");
    expect(container.textContent).toContain("기록 지출 총 150만원 / 2,700만원");
    expect(container.textContent).not.toContain("123,000원");
    authState.journey = { total_budget: 91_000_000, progress: { __hidden: ["venue"], venue: { budget: 91_000_000, spent: 9_000_000 } } };
    await render(result);
    expect(container.textContent).toContain("기록 지출 총 150만원 / 2,700만원");
    expect(container.textContent).toContain("결혼식장");
    expect(container.textContent).not.toContain("9,100만원");
    expect(result).toEqual(original);
    expect(authState.updateJourney).not.toHaveBeenCalled();
  });

  it("당시 snapshot 없는 legacy 그래픽은 현재 상태라고 표시하고 원문 수치는 보존한다", async () => {
    await render({ ...storedResult(), toolOutput: {} });
    expect(container.textContent).toContain("현재 예산 상태");
    expect(container.textContent).toContain("이 답변 당시의 수치와 다를 수 있어요.");
    expect(container.textContent).toContain("기록 지출 총 123,000원 / 3,500만원");
    expect(container.textContent).toContain("이 답변에서는 총예산 2,700만원과 기록 지출 150만원을 조회했어요.");
    expect(container.textContent).not.toContain("이 답변에서 조회한 예산");
  });

  it.each([
    { categories: null }, { recorded_spend_basis: "legacy_cost" }, { total_budget: -1 },
    { total_spent: Number.MAX_SAFE_INTEGER + 1 }, { total_spent: 1.5 },
    { categories: [{ key: "venue", allocated: 10_000_000, allocated_is_set: true }] },
  ])("불완전하거나 invalid한 당시 결과 %j는 현재 값과 섞지 않는다", async (patch) => {
    const result = storedResult(); result.toolOutput = { ...result.toolOutput, ...patch };
    await render(result);
    expect(container.textContent).toContain("현재 예산 상태");
    expect(container.textContent).toContain("기록 지출 총 123,000원 / 3,500만원");
    expect(container.textContent).not.toContain("기록 지출 총 150만원");
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("당시 총예산 미설정 0과 명시 지출 0을 현재의 3,500만원으로 대체하지 않는다", async () => {
    const result = storedResult(); result.toolOutput = { ...result.toolOutput, total_budget: 0, total_spent: 0, categories: [] };
    await render(result);
    expect(container.textContent).toContain("이 답변에서 조회한 예산");
    expect(container.textContent).toContain("총예산 미설정");
    expect(container.textContent).not.toContain("3,500만원");
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("일부 custom 목록이 생략됐어도 당시 전체 지출 합계를 현재 항목으로 다시 더하지 않는다", async () => {
    const result = storedResult();
    result.toolOutput = { ...result.toolOutput, total_spent: 2_000_000, custom_categories_omitted: 1 };
    authState.journey = { total_budget: 35_000_000, progress: { custom_now: { budget: 500_000, spent: 400_000 } } };
    await render(result);
    expect(container.textContent).toContain("기록 지출 총 200만원 / 2,700만원");
    expect(container.textContent).not.toContain("40만원");
  });

  it("다른 계정의 legacy 결과로 바뀌면 이전 snapshot을 재사용하지 않는다", async () => {
    await render(storedResult());
    authState.journey = { total_budget: 100_000, progress: { venue: { budget: 100_000, spent: 1 } } };
    await render({ ...storedResult(), displayMessage: "새 계정의 이전 답변", toolOutput: {} });
    expect(container.textContent).toContain("현재 예산 상태");
    expect(container.textContent).toContain("기록 지출 총 1원 / 10만원");
    expect(container.textContent).not.toContain("150만원");
  });
});
