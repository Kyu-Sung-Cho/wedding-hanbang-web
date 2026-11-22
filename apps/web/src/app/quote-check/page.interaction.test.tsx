// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { analyzeAmoraQuoteCheck, getQuoteCheckItems } from "@/lib/amora/quoteCheck";
import AmoraQuoteCheckPage from "./page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("AmoraQuoteCheckPage interaction", () => {
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
    vi.unstubAllGlobals();
  });

  it("counts only explicit included or unused decisions", async () => {
    const itemCount = getQuoteCheckItems("studio", "other").length;

    await act(async () => root.render(<AmoraQuoteCheckPage />));

    const firstGroup = container.querySelector<HTMLElement>('[role="group"]');
    expect(firstGroup).toBeTruthy();
    expect(container.textContent).toContain(`정리 0/${itemCount}`);

    const [includedButton, notNeededButton, unknownButton] =
      Array.from(firstGroup?.querySelectorAll<HTMLButtonElement>("button") ?? []);

    expect(unknownButton.getAttribute("aria-pressed")).toBe("true");

    await act(async () => includedButton.click());
    expect(includedButton.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain(`정리 1/${itemCount}`);

    await act(async () => notNeededButton.click());
    expect(notNeededButton.getAttribute("aria-pressed")).toBe("true");
    expect(includedButton.getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).toContain(`정리 1/${itemCount}`);

    await act(async () => unknownButton.click());
    expect(unknownButton.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain(`정리 0/${itemCount}`);
  });

  it("discloses the subset of questions and items carried into a conversation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ analysis: analyzeAmoraQuoteCheck({
      category: "studio", region: "other", quotePriceManwon: 0, includedItemIds: [],
    }) })));
    await act(async () => root.render(<AmoraQuoteCheckPage />));
    const calculate = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("체크리스트 결과 보기"));
    expect(calculate).toBeDefined();
    await act(async () => calculate!.click());
    const total = getQuoteCheckItems("studio", "other").length;
    expect(container.textContent).not.toContain("개이 아직");
    expect(container.textContent).toContain(`확인 필요 ${total}개 중 우선 질문`);
    // 2026-11-22 커뮤니티를 닫아 "커뮤니티에 직접 공유하기"(글쓰기)를 뺐다. 이제 아모라 대화에만 넘긴다.
    expect(container.textContent).toContain(`대화에는 확인 필요 ${total}개 중 우선 8개를 전달해요`);
    expect(container.textContent).not.toContain("커뮤니티");
    const chat = [...container.querySelectorAll("a")].find(link => link.textContent?.includes("아모라에게 이어서 묻기"));
    const prompt = new URL(chat!.href, "https://hanbang.ai").searchParams.get("prefill");
    expect(prompt).toContain(`확인 필요 ${total}개 중 우선 8개`);
  });
});
