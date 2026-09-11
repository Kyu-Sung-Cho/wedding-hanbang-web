// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BudgetContent from "../BudgetContent";
import { useAuthStore } from "@/stores/authStore";
import type { WeddingJourney } from "@/types/database.types";

// 기존 8칸 행/42px 통계의 클래스 고정 대신, 반응형 전환 때 잃기 쉬운 실제 정보를 지킨다.
// 브라우저에서의 320/390/768/1440px overflow는 별도 화면 검증으로 확인한다.
const sample: WeddingJourney = {
  id: "layout-journey", couple_id: "layout-couple", wedding_date: null, venue: null,
  total_budget: 20_000_000,
  progress: {
    makeup: { category: "makeup", status: "in_progress", budget: 800_000, spent: 100_001 },
    venue: { category: "venue", status: "not_started", budget: 12_000_000, spent: 0 },
  },
  state_revision: 1, created_at: "2026-09-11T00:00:00Z", updated_at: "2026-09-11T00:00:00Z",
};

describe("HTML 예산 레이아웃의 반응형 데이터 보존", () => {
  let root: Root;
  let container: HTMLDivElement;
  let original: ReturnType<typeof useAuthStore.getState>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    original = useAuthStore.getState();
    useAuthStore.setState({ isDemo: true, journey: sample });
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected request"); }));
    container = document.createElement("div"); document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useAuthStore.setState(original); container.remove(); vi.unstubAllGlobals();
  });

  it("세 요약과 모든 금액·분담 편집 버튼을 중복 없이 유지한다", async () => {
    await act(async () => root.render(createElement(BudgetContent)));
    expect(container.querySelector("[data-budget-summary]")?.children).toHaveLength(3);
    const category = container.querySelector('[data-budget-category="makeup"]')!;
    expect(category.querySelectorAll("[data-budget-status]")).toHaveLength(1);
    expect(category.querySelector("[data-budget-status]")?.textContent).toBe("진행중");
    for (const title of ["헤어·메이크업 예산 수정", "헤어·메이크업 기록 지출 수정", "분담 변경", "헤어·메이크업 삭제"]) {
      expect(category.querySelectorAll(`button[title="${title}"]`)).toHaveLength(1);
    }
    expect(category.textContent).toContain("100,001원");
    expect(category.textContent).toContain("80만원");
  });

  it("화면 폭이 바뀌어도 열린 금액 입력과 상태가 사라지지 않는다", async () => {
    await act(async () => root.render(createElement(BudgetContent)));
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="헤어·메이크업 예산 수정"]')!.click());
    const input = container.querySelector<HTMLInputElement>('input[aria-label="헤어·메이크업 예산 (만원)"]')!;
    for (const width of [320, 390, 768, 1024, 1440]) {
      await act(async () => {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
        window.dispatchEvent(new Event("resize"));
      });
      expect(container.querySelector("input")).toBe(input);
      expect(input.value).toBe("80");
      expect(container.querySelector('[data-budget-category="makeup"] [data-budget-status]')?.textContent).toBe("진행중");
    }
  });

  it("긴 원 단위 총액은 숫자를 줄이거나 반올림하지 않는다", async () => {
    useAuthStore.setState({ journey: { ...sample, total_budget: 987_654_321 } });
    await act(async () => root.render(createElement(BudgetContent)));
    const summary = container.querySelector("[data-budget-summary]")!;
    expect(summary.textContent).toContain("98,765.4321만원");
    expect(summary.children).toHaveLength(3);
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="총 예산 수정"]')!.click());
    expect(container.querySelector<HTMLInputElement>('input[aria-label="총 예산 (만원)"]')?.value).toBe("98765.4321");
  });
});
