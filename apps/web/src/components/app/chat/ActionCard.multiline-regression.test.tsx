import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ActionCard from "./ActionCard";

// QA regression: .gstack/qa-reports/qa-report-127-0-0-1-3010-2026-07-18.md
// Market-price and allocation tools intentionally return line-broken summaries.

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({ journey: null, updateJourney: vi.fn() }),
}));

describe("ActionCard multiline result formatting", () => {
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

  it("preserves the line structure of a market-price result", async () => {
    const displayMessage = "[전국 예식장 시세]\n대관료: 300만원\n식대: 8만원";

    await act(async () => {
      root.render(
        <ActionCard
          result={{
            toolName: "get_market_price",
            toolInput: { category: "venue" },
            toolOutput: { sourceName: "한국소비자원" },
            success: true,
            displayMessage,
          }}
        />,
      );
    });

    const message = Array.from(container.querySelectorAll("p"))
      .find((candidate) => candidate.textContent === displayMessage);
    expect(message).toBeDefined();
    expect(message?.classList.contains("whitespace-pre-line")).toBe(true);
  });
});
