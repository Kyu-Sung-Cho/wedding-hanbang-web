import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_CHAT_COMPOSER_HEIGHT_PX,
  useChatComposerAutoResize,
} from "./useChatComposerAutoResize";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function ComposerHarness({ value }: { value: string }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useChatComposerAutoResize(textareaRef, value);

  return <textarea ref={textareaRef} value={value} readOnly />;
}

describe("useChatComposerAutoResize", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalScrollHeight: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return (this as HTMLTextAreaElement).value === "상한을 넘는 아주 긴 초안"
          ? MAX_CHAT_COMPOSER_HEIGHT_PX + 80
          : 140;
      },
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    if (originalScrollHeight) {
      Object.defineProperty(
        HTMLTextAreaElement.prototype,
        "scrollHeight",
        originalScrollHeight,
      );
    } else {
      delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>)
        .scrollHeight;
    }
    document.body.replaceChildren();
  });

  it("expands a transferred Amora draft before the user reviews it", async () => {
    await act(async () => {
      root.render(<ComposerHarness value="날짜를 잡기 전에 둘이 먼저 맞춰볼 기준을 알려주세요." />);
    });

    expect(container.querySelector("textarea")?.style.height).toBe("140px");
  });

  it("caps very long drafts and resets after the draft is cleared", async () => {
    await act(async () => {
      root.render(<ComposerHarness value="상한을 넘는 아주 긴 초안" />);
    });
    expect(container.querySelector("textarea")?.style.height).toBe(
      `${MAX_CHAT_COMPOSER_HEIGHT_PX}px`,
    );

    await act(async () => {
      root.render(<ComposerHarness value="" />);
    });
    expect(container.querySelector("textarea")?.style.height).toBe("auto");
  });
});
