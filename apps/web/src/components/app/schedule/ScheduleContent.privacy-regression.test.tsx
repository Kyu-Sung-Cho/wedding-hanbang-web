// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChecklistSchedulePrompt } from "./ScheduleContent";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const LEGACY_MEMO =
  "\uC608\uC57D \uC790\uB3D9 \uB4F1\uB85D \u00B7 booking 018f4dc8-0ac2-7df5-9f5d-2e8fd1c43b21 \u00B7 15,000\uC6D0";
const SAFE_MEMO = "\uC608\uC57D \uC790\uB3D9 \uB4F1\uB85D \u00B7 15,000\uC6D0";

describe("checklist schedule memo privacy", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("never exposes or submits a legacy booking UUID", async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        <ChecklistSchedulePrompt
          pending={{
            categoryKey: "studio",
            itemId: "book-studio",
            itemLabel: "\uC2A4\uD29C\uB514\uC624 \uC608\uC57D",
            categoryLabel: "\uC2A4\uD29C\uB514\uC624",
            existingEvent: {
              id: "event-1",
              date: "2027-05-01",
              title: "\uC2A4\uD29C\uB514\uC624",
              memo: LEGACY_MEMO,
              categoryKey: "studio",
              createdAt: "2026-07-19T00:00:00.000Z",
              updatedAt: "2026-07-19T00:00:00.000Z",
            },
          }}
          onClose={vi.fn()}
          onComplete={onComplete}
        />,
      );
      await Promise.resolve();
    });

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea?.value).toBe(SAFE_MEMO);
    expect(container.textContent).not.toContain("018f4dc8");

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(textarea, LEGACY_MEMO);
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelectorAll<HTMLButtonElement>("button").item(2).click();
      await Promise.resolve();
    });

    expect(onComplete).toHaveBeenCalledWith({
      date: "2027-05-01",
      memo: SAFE_MEMO,
    });
  });
});
