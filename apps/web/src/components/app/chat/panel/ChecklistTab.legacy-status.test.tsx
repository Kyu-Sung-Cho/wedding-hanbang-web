// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChecklistTab from "./ChecklistTab";

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    journey: {
      progress: {
        venue: { category: "venue", status: "completed" },
      },
    },
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("ChecklistTab legacy category truth", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows a reviewed status-only completion as item work still needing confirmation", async () => {
    await act(async () => root.render(<ChecklistTab />));

    const venue = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("예식·모임 장소"),
    );
    expect(venue?.textContent).toContain("0/8");
    expect(venue?.textContent).toContain("시작전");
    expect(venue?.textContent).not.toContain("완료");
  });
});
