import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventFormModal from "../EventFormModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("EventFormModal delete safety", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("requires a second explicit click before deleting an event", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(
      <EventFormModal
        isOpen
        mode="edit"
        event={{
          id: "evt_1",
          date: "2026-08-30",
          title: "드레스 피팅",
          createdAt: "2026-07-13T00:00:00.000Z",
          updatedAt: "2026-07-13T00:00:00.000Z",
        }}
        defaultDate={null}
        onSave={vi.fn()}
        onDelete={onDelete}
        onClose={vi.fn()}
      />,
    ));

    const findDeleteButton = () => Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("삭제"));
    await act(async () => {
      findDeleteButton()?.click();
      await Promise.resolve();
    });
    expect(onDelete).not.toHaveBeenCalled();

    await act(async () => {
      findDeleteButton()?.click();
      await Promise.resolve();
    });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
