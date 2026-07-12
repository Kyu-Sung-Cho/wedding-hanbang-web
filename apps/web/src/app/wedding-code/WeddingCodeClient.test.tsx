import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WEDDING_CODE_V05_QUESTIONS,
  WEDDING_CODE_V05_VERSION,
} from "@/constants/weddingCodeV05";
import WeddingCodeClient from "./WeddingCodeClient";

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("@/lib/analytics", () => ({
  captureEvent: vi.fn(),
}));

const PROGRESS_KEY = `wedding-code:${WEDDING_CODE_V05_VERSION}:progress`;

function findButton(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes(text));
}

describe("WeddingCodeClient progress safety", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/wedding-code");
    replaceMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("resumes corrupt progress at the first unanswered question, not the saved last index", async () => {
    const first = WEDDING_CODE_V05_QUESTIONS[0];
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify({
      answers: { [first.key]: first.options[0].value },
      qIndex: 999,
      step: "questions",
      expiresAt: Date.now() + 60_000,
    }));

    await act(async () => {
      root.render(<WeddingCodeClient />);
    });

    expect(container.textContent).toContain(WEDDING_CODE_V05_QUESTIONS[1].question);
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuetext"))
      .toBe("1개 응답 완료, 현재 2/16 문항");
  });

  it("requires two explicit clicks before deleting in-progress answers", async () => {
    await act(async () => {
      root.render(<WeddingCodeClient />);
    });
    await act(async () => {
      findButton(container, "바로 시작하기")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-pressed="false"]')?.click();
    });

    await act(async () => {
      findButton(container, "처음부터 다시")?.click();
    });

    expect(findButton(container, "한 번 더 눌러 답변 모두 지우기")).toBeDefined();
    expect(container.querySelector('[aria-pressed="true"]')).not.toBeNull();

    await act(async () => {
      findButton(container, "한 번 더 눌러 답변 모두 지우기")?.click();
    });

    expect(findButton(container, "바로 시작하기")).toBeDefined();
    expect(container.querySelector("[aria-pressed]")).toBeNull();
    expect(window.localStorage.getItem(PROGRESS_KEY)).toBeNull();
  });
});
