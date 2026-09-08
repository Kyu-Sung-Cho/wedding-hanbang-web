import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AmoraNoteSaveSheet from "./AmoraNoteSaveSheet";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("아모라 저장 시트의 입력과 오류 접근성", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onSave = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function renderSheet(error: string | null = null, busy = false) {
    await act(async () => root.render(
      <AmoraNoteSaveSheet content="함께 확인할 답변" busy={busy} error={error} onSave={onSave} onClose={vi.fn()} />,
    ));
    return document.querySelector<HTMLElement>('[role="dialog"]')!;
  }

  function memoToggle(dialog: HTMLElement) {
    return Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("메모"))!;
  }

  it("메모 추가는 연결된 입력칸에 초점을 옮긴다", async () => {
    const dialog = await renderSheet();
    const toggle = memoToggle(dialog);
    toggle.focus();
    await act(async () => toggle.click());
    const textarea = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(document.activeElement).toBe(textarea);
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)?.contains(textarea)).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(textarea.maxLength).toBe(500);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("메모를 접고 다시 열어도 500자 입력을 보존하고 초점을 복구한다", async () => {
    const dialog = await renderSheet();
    const toggle = memoToggle(dialog);
    await act(async () => toggle.click());
    const textarea = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    const memo = "가".repeat(500);
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(textarea, memo);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    textarea.focus();
    await act(async () => toggle.click());
    expect(document.activeElement).toBe(toggle);
    expect(dialog.querySelector("textarea")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => toggle.click());
    const reopened = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(reopened.value).toBe(memo);
    expect(document.activeElement).toBe(reopened);
    await act(async () => dialog.querySelector<HTMLButtonElement>("[data-amora-confirm]")!.click());
    expect(onSave).toHaveBeenCalledExactlyOnceWith(memo);
  });

  it("저장 오류가 생겨도 입력칸을 유지하고 재시도할 수 있다", async () => {
    const dialog = await renderSheet();
    await act(async () => memoToggle(dialog).click());
    const textarea = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    textarea.focus();
    await renderSheet("저장 결과를 확인하지 못했어요. 다시 확인해 주세요.");
    const error = dialog.querySelector<HTMLElement>('[role="alert"]')!;
    expect(error.textContent).toContain("저장 결과");
    expect(dialog.querySelector<HTMLButtonElement>("[data-amora-confirm]")!.disabled).toBe(false);
    expect(document.activeElement).toBe(textarea);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("메모 입력 중 Escape로 닫으면 저장 버튼에 돌아가고 저장하지 않는다", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <>
        <button onClick={() => setOpen(true)}>답변 저장</button>
        {open && <AmoraNoteSaveSheet content="공유 답변" busy={false} error={null} onSave={onSave} onClose={() => setOpen(false)} />}
      </>;
    }
    await act(async () => root.render(<Harness />));
    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    trigger.focus();
    await act(async () => trigger.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () => memoToggle(dialog).click());
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onSave).not.toHaveBeenCalled();
  });
});
