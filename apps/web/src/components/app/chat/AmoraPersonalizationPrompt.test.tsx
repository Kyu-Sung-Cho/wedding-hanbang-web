import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AmoraPersonalizationConfirmation,
  AmoraQuickStart,
} from "./AmoraPersonalizationPrompt";
import { AMORA_QUICK_START_OPTIONS } from "@/lib/amora/personalization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("Amora personalization prompts", () => {
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

  it("asks one quick-start question and sends exactly the selected explicit option", async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(<AmoraQuickStart onSelect={onSelect} />);
    });

    expect(container.querySelectorAll("h2")).toHaveLength(1);
    expect(container.querySelectorAll("button")).toHaveLength(4);
    expect(container.textContent).toContain("지금 어떤 도움부터 받을까요?");
    expect(container.textContent).toContain(
      "이 선택만으로 성격을 판단하거나 예산·일정을 바꾸지 않아요.",
    );

    const comparison = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("선택지 비교부터"),
    );
    await act(async () => comparison?.click());

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(
      AMORA_QUICK_START_OPTIONS.find(
        (option) => option.mode === "comparison",
      ),
    );
  });

  it("requires a separate confirmation before saving the help style", async () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    await act(async () => {
      root.render(
        <AmoraPersonalizationConfirmation
          option={AMORA_QUICK_START_OPTIONS[0]}
          onConfirm={onConfirm}
          onDismiss={onDismiss}
        />,
      );
    });

    expect(container.textContent).toContain("앞으로 결정이 필요할 때");
    expect(container.textContent).toContain(
      "설정값 자체는 상대방과 공유하지 않아요",
    );
    expect(container.textContent).toContain("이대로 저장");
    expect(container.textContent).toContain("이번만");
    expect(
      container.querySelector('a[href="/settings/amora-style"]'),
    ).not.toBeNull();

    const buttons = container.querySelectorAll("button");
    await act(async () => buttons[0]?.click());
    await act(async () => buttons[1]?.click());
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
