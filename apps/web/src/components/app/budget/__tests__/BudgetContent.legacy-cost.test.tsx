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

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useAuthStore.setState({ journey: LEGACY_COST_JOURNEY });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useAuthStore.setState({ journey: originalJourney });
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
});
