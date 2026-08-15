// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MediationConsentDialog from "./MediationConsentDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("MediationConsentDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onCancel = vi.fn();
  const onConfirm = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediationConsentDialog
          onCancel={onCancel}
          onConfirm={onConfirm}
        />,
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("states the raw-message boundary before consent", () => {
    expect(container.textContent).toContain(
      "상대방에게 직접 보낸 메시지나 비공개 대화는 자동으로 가져오지 않아요",
    );
    expect(container.textContent).toContain(
      "두 사람이 각각 확인해야 공동 결정으로 남아요",
    );
    expect(container.textContent).toContain(
      "생성된 초안은 함께 대화에 표시되어 상대방도 볼 수 있어요",
    );
  });

  it("cancels without creating a request", async () => {
    const cancelButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "취소");

    await act(async () => cancelButton?.click());

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("submits only the trimmed summary the user typed", async () => {
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea).not.toBeNull();

    await act(async () => {
      if (!textarea) return;
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(textarea, "  예산 상한선을 두고 의견이 달라요.  ");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const submitButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("이 요약으로"));
    expect(submitButton?.disabled).toBe(false);

    await act(async () => submitButton?.click());

    expect(onConfirm).toHaveBeenCalledWith(
      "예산 상한선을 두고 의견이 달라요.",
    );
  });
});
