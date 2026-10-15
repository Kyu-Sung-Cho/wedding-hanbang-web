// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import AppPreviewCard from "@/components/landing/redesign/AppPreviewCard";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("landing Amora example selector", () => {
  it("switches AI examples and the actual initial lounge screen without requests or record writes", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const fetchCall = vi.fn();
    vi.stubGlobal("fetch", fetchCall);
    const saveRecord = vi.spyOn(Storage.prototype, "setItem");
    const removeRecord = vi.spyOn(Storage.prototype, "removeItem");

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    try {
      await act(async () => root.render(createElement(AppPreviewCard)));

      const controls = host.querySelector('[role="group"]');
      expect(controls?.getAttribute("aria-label")).toBe("어떻게 쓰는지 눌러 보세요");
      const buttons = [...(controls?.querySelectorAll("button") ?? [])];
      expect(buttons.map((button) => button.textContent)).toEqual([
        "첫 질문", "저장 전 확인", "라운지 첫 화면",
      ]);
      const panel = host.querySelector('[aria-live="polite"][aria-atomic="true"]');
      expect(panel).toBeTruthy();
      expect(host.querySelector("figure > figcaption"), "예시 고지는 figure의 직계 figcaption이어야 한다").toBeTruthy();
      for (const button of buttons) {
        expect(button.type).toBe("button");
        expect(button.getAttribute("aria-controls")).toBe(panel?.id);
        expect(button.className).toContain("min-h-11");
        expect(button.className).toContain("focus-visible:ring-2");
      }

      const verifyScene = (selected: number, evidence: string[]) => {
        expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(
          buttons.map((_, index) => String(index === selected)),
        );
        const copy = panel?.textContent ?? "";
        for (const phrase of evidence) expect(copy).toContain(phrase);
        const note = host.querySelector("figcaption")?.textContent ?? "";
        if (selected === 2) {
          expect(note).toContain("실제 웨딩라운지를 캡처했어요");
          expect(note).toContain("준비 기록은 이 화면에서 바꿀 수 없어요");
          expect(note).not.toContain("AI 답변");
        } else {
          expect(note).toContain("기능을 설명하는 예시예요");
          expect(note).toContain("이 화면에서는 대화하거나 저장할 수 없어요");
          expect(note).toContain("AI 답변에는 오류가 있을 수 있어요");
        }
      };

      // 첫 방문자는 기록 결과보다 먼저, 질문에서 상담 준비로 이어지는 예시를 본다.
      verifyScene(0, ["하객은 100명 정도야", "아모라의 답변 · AI 생성", "하객 100명을 기준으로 식대", "최소 보증 인원", "상담 전"]);
      expect(panel?.textContent).not.toContain("배정 예산");

      await act(async () => buttons[2].click());
      verifyScene(2, ["웨딩라운지에서 준비 현황을 확인해요", "준비 내용을 입력하기 전의 실제 서비스 화면이에요"]);
      const loungeImage = panel?.querySelector("img");
      expect(loungeImage).toBeTruthy();
      expect(decodeURIComponent(loungeImage?.getAttribute("src") ?? "")).toContain("/images/landing-lounge-mobile.jpg");
      expect(loungeImage?.getAttribute("alt")).toContain("예식일과 다음 일정은 미정");
      expect(loungeImage?.getAttribute("alt")).toContain("체크리스트 진행·예산 배정·기록 지출은 아직 없는 상태");
      expect(loungeImage?.getAttribute("width")).toBe("375");
      expect(loungeImage?.getAttribute("height")).toBe("520");
      expect(panel?.textContent).not.toContain("1,000만 원");
      expect(panel?.textContent).not.toContain("아모라의 답변 · AI 생성");

      await act(async () => buttons[0].click());
      verifyScene(0, ["하객은 100명 정도야", "아모라의 답변 · AI 생성", "하객 100명을 기준으로 식대", "최소 보증 인원", "상담 전"]);
      expect(panel?.textContent).not.toContain("배정 예산");

      await act(async () => buttons[1].click());
      verifyScene(1, ["결혼식장 예산은 1,000만 원", "아모라의 답변 · AI 생성", "저장할 내용 확인하기", "저장 전", "직접 확인하고 저장해야"]);
      expect(panel?.textContent).not.toContain("하객은 100명 정도야");

      await act(async () => buttons[2].click());
      verifyScene(2, ["웨딩라운지에서 준비 현황을 확인해요", "준비 내용을 입력하기 전의 실제 서비스 화면이에요"]);
      expect(panel?.textContent).not.toContain("저장 전");
      expect(fetchCall).not.toHaveBeenCalled();
      expect(saveRecord).not.toHaveBeenCalled();
      expect(removeRecord).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
