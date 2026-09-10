// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleEvent } from "@/types/database.types";
import { updateEvent } from "@/utils/scheduleEvents";
import EventFormModal from "./EventFormModal";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const EVENT: ScheduleEvent = {
  id: "qa-manual-time",
  title: "둘이 예산 확인",
  date: "2026-09-14",
  time: "19:30",
  memo: "총예산과 미배정 금액 확인",
  categoryKey: "general",
  status: "planned",
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
};

describe("EventFormModal manual time submission", () => {
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

  function timeInput(): HTMLInputElement {
    const input = container.querySelector('input[name="schedule-time"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("Time input absent");
    return input;
  }

  function saveButton(): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button"))
      .find(element => element.textContent?.trim() === "수정");
    if (!(button instanceof HTMLButtonElement)) throw new Error("Save button absent");
    return button;
  }

  function nativeTimeEdit(value: string, eventType: "input" | "change") {
    const input = timeInput();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Native value setter absent");
    setter.call(input, value);
    input.dispatchEvent(new Event(eventType, { bubbles: true }));
  }

  it.each(["input", "change"] as const)(
    "submits the edited clock through a native %s event without changing other schedule fields",
    async eventType => {
      const onSave = vi.fn(async (draft: Parameters<typeof updateEvent>[2]) => {
        const progress = updateEvent({ __events: [EVENT] }, EVENT.id, draft);
        const events = progress.__events;
        expect(Array.isArray(events)).toBe(true);
        expect(events).toEqual([expect.objectContaining({
          ...EVENT,
          time: "19:45",
          updatedAt: expect.any(String),
        })]);
        expect(EVENT.time).toBe("19:30");
      });
      await act(async () => {
        root.render(<EventFormModal isOpen mode="edit" event={EVENT}
          defaultDate={null} onSave={onSave} onClose={vi.fn()} />);
      });
      expect(timeInput().value).toBe("19:30");

      await act(async () => nativeTimeEdit("19:45", eventType));
      expect(timeInput().value).toBe("19:45");
      expect(onSave).not.toHaveBeenCalled();

      // ScheduleContent retains editingEvent while its journey snapshot refreshes.
      await act(async () => {
        root.render(<EventFormModal isOpen mode="edit" event={EVENT}
          defaultDate={null} onSave={onSave} onClose={vi.fn()}
          assigneeContext={{}} />);
      });
      expect(timeInput().value).toBe("19:45");

      await act(async () => saveButton().click());
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        time: "19:45", title: EVENT.title, date: EVENT.date, memo: EVENT.memo,
        categoryKey: EVENT.categoryKey, status: "planned",
      }));
      expect(timeInput().value).toBe("19:45");
    },
  );

  it("preserves the actual clock edit when persistence rejects the request", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("internal RPC failure"));
    await act(async () => {
      root.render(<EventFormModal isOpen mode="edit" event={EVENT}
        defaultDate={null} onSave={onSave} onClose={vi.fn()} />);
    });
    await act(async () => nativeTimeEdit("19:45", "input"));
    await act(async () => saveButton().click());

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ time: "19:45" }));
    expect(timeInput().value).toBe("19:45");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("저장하지 못했어요");
    expect(container.textContent).not.toContain("internal RPC");
  });

});
