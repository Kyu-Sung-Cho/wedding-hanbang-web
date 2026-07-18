import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ActionCard from "./ActionCard";

// QA regression: .gstack/qa-reports/qa-report-127-0-0-1-3010-2026-07-18.md
// A user-facing failure message must not disappear merely because its structured output is empty.

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({ journey: null, updateJourney: vi.fn() }),
}));

describe("ActionCard actionable failures", () => {
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

  it("shows a meaningful failure even when toolOutput is empty", async () => {
    await act(async () => {
      root.render(
        <ActionCard
          result={{
            toolName: "update_schedule_event",
            toolInput: { event_id: "missing-event" },
            toolOutput: {},
            success: false,
            displayMessage: "일정을 찾을 수 없습니다 (ID: missing-event)",
          }}
        />,
      );
    });

    expect(container.textContent).toContain("일정 변경");
    expect(container.textContent).toContain("일정을 찾을 수 없습니다");
  });

  it("keeps a silent internal failure hidden", async () => {
    await act(async () => {
      root.render(
        <ActionCard
          result={{
            toolName: "update_schedule_event",
            toolInput: { event_id: "missing-event" },
            toolOutput: {},
            success: false,
            displayMessage: "",
          }}
        />,
      );
    });

    expect(container.textContent).toBe("");
  });
});
