// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CopyScriptButton from "./CopyScriptButton";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("CopyScriptButton", () => {
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
    vi.restoreAllMocks();
  });

  function mockClipboard(writeText: (text: string) => Promise<void>) {
    const write = vi.fn(writeText);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: write },
    });
    return write;
  }

  it("exposes a unique accessible name and confirms a successful copy", async () => {
    const writeText = mockClipboard(async () => undefined);
    await act(async () => {
      root.render(
        <CopyScriptButton text="안녕하세요" label="양가에 날짜 여쭙기 대화 문장" />,
      );
    });

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button?.getAttribute("aria-label")).toBe(
      "양가에 날짜 여쭙기 대화 문장 복사",
    );
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith("안녕하세요");
    expect(button?.textContent).toContain("복사됨");
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "대화 문장을 복사했어요.",
    );
  });

  it("shows a visible recovery state when clipboard access fails", async () => {
    mockClipboard(async () => {
      throw new Error("clipboard denied");
    });
    await act(async () => {
      root.render(
        <CopyScriptButton text="안녕하세요" label="업체에 조건 확인하기 대화 문장" />,
      );
    });

    const button = container.querySelector<HTMLButtonElement>("button");
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(button?.textContent).toContain("복사 실패");
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "복사하지 못했어요. 문장을 직접 선택해 복사해 주세요.",
    );
  });
});
