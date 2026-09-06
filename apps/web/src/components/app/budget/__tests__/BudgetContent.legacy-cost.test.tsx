// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import BudgetContent from "../BudgetContent";
import { useAuthStore } from "@/stores/authStore";
import type { WeddingJourney } from "@/types/database.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const LEGACY_COST_JOURNEY: WeddingJourney = {
  id: "10000000-0000-4000-8000-000000000001",
  couple_id: "20000000-0000-4000-8000-000000000001",
  wedding_date: null,
  venue: null,
  total_budget: 1_000_000,
  progress: {
    venue: {
      status: "in_progress",
      // Historical web data stored small values in 만원 units. The value must
      // remain reviewable but must not become both budget and spend.
      cost: 500,
    },
  },
  state_revision: 0,
  created_at: "2026-07-31T00:00:00.000Z",
  updated_at: "2026-07-31T00:00:00.000Z",
};

describe("BudgetContent legacy cost boundary", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalJourney = useAuthStore.getState().journey;
  const originalIsDemo = useAuthStore.getState().isDemo;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useAuthStore.setState({ journey: LEGACY_COST_JOURNEY });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useAuthStore.setState({ journey: originalJourney, isDemo: originalIsDemo });
    document.body.replaceChildren();
  });

  it("excludes ambiguous legacy cost from totals while keeping it visible for review", async () => {
    await act(async () => root.render(<BudgetContent />));

    expect(container.textContent).toContain("용도 미확인 이전 금액");
    expect(container.textContent).toContain("결혼식장 500만원");
    expect(container.textContent).toContain("예산·기록 지출 합계에서 제외");
    expect(container.textContent).toContain("기록 지출");
    expect(container.textContent).toContain("결제 완료 여부와 별도");
    expect(container.textContent).not.toContain("예산 초과");
  });

  it("closes the payer choices with Escape and saves a choice without changing money", async () => {
    useAuthStore.setState({ isDemo: true, journey: { ...LEGACY_COST_JOURNEY, progress: {
      makeup: { category: "makeup", status: "in_progress", budget: 700_000, spent: 100_000, payer: "couple" },
    } } });
    await act(async () => root.render(<BudgetContent />));
    const row = container.querySelector('button[title="헤어·메이크업 예산 수정"]')!.closest("div.group")!;
    const toggle = row.querySelector<HTMLButtonElement>('button[title="분담 변경"]')!;
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await act(async () => toggle.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
    await act(async () => toggle.click());
    const option = Array.from(row.querySelectorAll<HTMLButtonElement>("button:not([title])")).find(button => button.textContent === "두 가족")!;
    await act(async () => option.click());
    expect(useAuthStore.getState().journey?.progress.makeup).toMatchObject({ payer: "both_parents", budget: 700_000, spent: 100_000, status: "in_progress" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("shows exact allocated and recorded amounts instead of rounding them to ten thousand won", async () => {
    useAuthStore.setState({ journey: { ...LEGACY_COST_JOURNEY, progress: {
      venue: { category: "venue", status: "completed", budget: 5_000, spent: 14_999 },
      reserve: { category: "reserve", status: "not_started", budget: 5_995_000 },
    } } });
    await act(async () => root.render(<BudgetContent />));
    expect(container.querySelector('button[title="결혼식장 예산 수정"]')?.textContent).toContain("5,000원");
    expect(container.querySelector('button[title="결혼식장 기록 지출 수정"]')?.textContent).toContain("14,999원");
    expect(container.querySelector('button[title="예비비·사용처 미정 예산 수정"]')?.textContent).toContain("5,995,000원");
    expect(container.textContent).toContain("1.4999");
  });

  it.each([5_000, 14_999, 1])("keeps an unchanged %i-won category amount exact when opening and saving the manwon editor", async (amount) => {
    useAuthStore.setState({ isDemo: true, journey: { ...LEGACY_COST_JOURNEY, progress: {
      venue: { category: "venue", status: "completed", budget: amount, spent: amount },
    } } });
    await act(async () => root.render(<BudgetContent />));
    for (const [label, field] of [["예산", "budget"], ["기록 지출", "spent"]] as const) {
      await act(async () => container.querySelector<HTMLButtonElement>(`button[title="결혼식장 ${label} 수정"]`)!.click());
      const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
      await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      expect(useAuthStore.getState().journey?.progress.venue[field]).toBe(amount);
      expect(useAuthStore.getState().journey?.progress.venue.status).toBe("completed");
    }
  });

  it("keeps a one-won precision total exact in the summary and unchanged total editor", async () => {
    useAuthStore.setState({ isDemo: true, journey: { ...LEGACY_COST_JOURNEY, total_budget: 14_999, progress: {} } });
    await act(async () => root.render(<BudgetContent />));
    expect(container.textContent).toContain("1.4999");
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="총 예산 수정"]')!.click());
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(useAuthStore.getState().journey?.total_budget).toBe(14_999);
  });
});
