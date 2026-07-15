import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BudgetContent from "../BudgetContent";

const mocks = vi.hoisted(() => ({
  updateJourney: vi.fn(),
  updateJourneyLocal: vi.fn(),
  mutateBudgetCategory: vi.fn(),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    journey: {
      id: "journey-1",
      couple_id: "couple-1",
      wedding_date: "2026-10-10",
      venue: null,
      total_budget: 50_000_000,
      progress: {
        venue: {
          category: "venue",
          status: "in_progress",
          checklist: [{ id: "venue_01", label: "계약서 확인", done: false }],
          budget: 20_000_000,
          spent: 10_000_000,
          cost: 9_000_000,
        },
      },
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    },
    isDemo: false,
    updateJourney: mocks.updateJourney,
    updateJourneyLocal: mocks.updateJourneyLocal,
  }),
}));

vi.mock("@/lib/budget/budgetCategoryClient", () => ({
  mutateBudgetCategory: mocks.mutateBudgetCategory,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("BudgetContent atomic category persistence", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function buttonWithText(text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => candidate.textContent?.includes(text));
    if (!button) throw new Error(`Missing button: ${text}`);
    return button;
  }

  function inputInsideLabel(text: string): HTMLInputElement {
    const label = Array.from(container.querySelectorAll<HTMLLabelElement>("label"))
      .find((candidate) => candidate.textContent?.includes(text));
    const input = label?.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error(`Missing input: ${text}`);
    return input;
  }

  it("saves a field through the narrow mutation and applies only server-authoritative progress", async () => {
    const authoritativeProgress = {
      venue: {
        category: "venue",
        status: "completed",
        checklist: [{ id: "venue_01", label: "계약서 확인", done: true }],
        budget: 35_000_000,
        spent: 10_000_000,
      },
      __events: [{ id: "evt_partner" }],
    };
    mocks.mutateBudgetCategory.mockResolvedValue({
      progress: authoritativeProgress,
      categoryKey: "venue",
    });

    act(() => root.render(<BudgetContent />));
    act(() => {
      buttonWithText("편집").click();
    });
    const input = inputInsideLabel("내 계획 예산");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "3500");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      buttonWithText("직접 입력한 값 저장").click();
      await Promise.resolve();
    });

    expect(mocks.mutateBudgetCategory).toHaveBeenCalledWith({
      categoryKey: "venue",
      set: { budget: 35_000_000 },
      remove: undefined,
      visibility: "visible",
    });
    expect(mocks.updateJourneyLocal).toHaveBeenCalledWith({ progress: authoritativeProgress });
    expect(mocks.updateJourney).not.toHaveBeenCalled();
  });

  it("resets spent and its legacy cost without deleting checklist or status", async () => {
    const authoritativeProgress = {
      venue: {
        category: "venue",
        status: "in_progress",
        checklist: [{ id: "venue_01", label: "계약서 확인", done: false }],
        budget: 20_000_000,
      },
    };
    mocks.mutateBudgetCategory.mockResolvedValue({
      progress: authoritativeProgress,
      categoryKey: "venue",
    });

    act(() => root.render(<BudgetContent />));
    await act(async () => {
      buttonWithText("이전 기록 지우기").click();
      await Promise.resolve();
    });

    expect(mocks.mutateBudgetCategory).toHaveBeenCalledWith({
      categoryKey: "venue",
      remove: ["spent", "cost", "payer"],
    });
    expect(mocks.updateJourneyLocal).toHaveBeenCalledWith({ progress: authoritativeProgress });
  });
});
