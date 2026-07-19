import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolExecutionResult } from "@/types/database.types";
import ActionCard from "./ActionCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const authState = vi.hoisted(() => ({
  journey: null as unknown,
  updateJourney: vi.fn(),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => authState,
}));

const summaryResult: ToolExecutionResult = {
  toolName: "get_budget_summary",
  toolInput: {},
  toolOutput: {},
  success: true,
  displayMessage: "현재 예산 현황이에요.",
};

describe("ActionCard invalid persisted budget containment", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    authState.updateJourney.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("ignores negative, fractional, and unsafe persisted amounts without crashing", async () => {
    authState.journey = {
      total_budget: 27_000_000,
      progress: {
        venue: { spent: -1, cost: -2 },
        studio: { spent: 1.5 },
        dress: { cost: 1.25 },
        makeup: { budget: -1, spent: Number.MAX_SAFE_INTEGER + 1 },
      },
    };

    await act(async () => {
      root.render(<ActionCard result={summaryResult} />);
    });

    expect(container.textContent).toContain("총 0원 / 2,700만원");
    expect(container.textContent).not.toContain("NaN");
    expect(container.textContent).not.toContain("Infinity");
  });

  it("omits the summary when the persisted total budget is unsafe", async () => {
    authState.journey = {
      total_budget: Number.MAX_SAFE_INTEGER + 1,
      progress: { venue: { spent: 1_000_000 } },
    };

    await act(async () => {
      root.render(<ActionCard result={summaryResult} />);
    });

    expect(container.textContent).toContain("현재 예산 현황이에요.");
    expect(container.textContent).not.toContain("총 ");
  });
});
