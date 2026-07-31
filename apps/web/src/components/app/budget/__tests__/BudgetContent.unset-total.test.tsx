// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import BudgetContent from "../BudgetContent";
import { useAuthStore } from "@/stores/authStore";
import type { WeddingJourney } from "@/types/database.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const JOURNEY_WITHOUT_TOTAL_BUDGET: WeddingJourney = {
  id: "10000000-0000-4000-8000-000000000001",
  couple_id: "20000000-0000-4000-8000-000000000001",
  wedding_date: null,
  venue: null,
  total_budget: 0,
  progress: {
    venue: {
      status: "in_progress",
      budget: 2_000_000,
      spent: 1_000_000,
    },
  },
  state_revision: 0,
  created_at: "2026-07-31T00:00:00.000Z",
  updated_at: "2026-07-31T00:00:00.000Z",
};

describe("BudgetContent total-budget trust boundary", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalJourney = useAuthStore.getState().journey;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useAuthStore.setState({ journey: JOURNEY_WITHOUT_TOTAL_BUDGET });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useAuthStore.setState({ journey: originalJourney });
    document.body.replaceChildren();
  });

  it("does not present an unentered total as zero or claim that spending exceeded it", async () => {
    await act(async () => {
      root.render(<BudgetContent />);
    });

    expect(container.textContent).toContain("미입력");
    expect(container.textContent).toContain("계산 전");
    expect(container.textContent).toContain(
      "총 예산을 입력하면 남은 금액을 계산해요",
    );
    expect(container.textContent).not.toContain("예산 초과");
  });
});
