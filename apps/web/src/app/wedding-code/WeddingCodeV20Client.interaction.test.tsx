// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WEDDING_CODE_V20_TOTAL } from "@/constants/weddingCodeV20";
import WeddingCodeV20Client from "./WeddingCodeV20Client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("WeddingCodeV20Client", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { window.history.replaceState(null, "", "/wedding-code"); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); });

  it("문장마다 5점 척도를 보여주고 마지막까지 건너뛰면 빈 결과를 안내한다", async () => {
    await act(async () => root.render(<WeddingCodeV20Client shareOrigin="https://hanbang.ai" />));
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("시작하기"))?.click());
    expect(container.querySelectorAll("[data-answer]")).toHaveLength(5);
    expect(container.querySelectorAll('[role="radiogroup"] [role="radio"]')).toHaveLength(5);
    expect(container.querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(0);
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="이전 문장"]')?.disabled).toBe(true);
    expect([...container.querySelectorAll("button")].find((button) => button.textContent?.includes("다음 문장"))?.disabled).toBe(true);
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("1");
    for (let index = 0; index < WEDDING_CODE_V20_TOTAL; index += 1) {
      const skip = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("지금은 답하기 어려워요"));
      await act(async () => skip?.click());
    }
    expect(container.querySelector('[data-result="solo-v20"]')?.getAttribute("data-empty")).toBe("");
    expect(container.textContent).toContain("아직 답한 문장이 없어요");
  });

  it("낮은 점수와 3점을 모두 결과에 남긴다", async () => {
    await act(async () => root.render(<WeddingCodeV20Client shareOrigin="https://hanbang.ai" />));
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("시작하기"))?.click());
    for (let index = 0; index < WEDDING_CODE_V20_TOTAL; index += 1) {
      const value = index === 0 ? "1" : index === 1 ? "3" : "5";
      await act(async () => container.querySelector<HTMLButtonElement>(`[data-answer="${value}"]`)?.click());
      expect(container.querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(1);
      expect(container.querySelector(`[data-answer="${value}"]`)?.getAttribute("aria-checked")).toBe("true");
      const next = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(index === WEDDING_CODE_V20_TOTAL - 1 ? "결과 보기" : "다음 문장"));
      expect(next?.disabled).toBe(false);
      await act(async () => next?.click());
    }
    expect(container.querySelector('[data-result="solo-v20"]')).not.toBeNull();
    expect(container.textContent).toContain("추가 비용까지 포함한 전체 금액을 먼저 확인하는 편이다.");
    expect(container.textContent).toContain("1 · 전혀 그렇지 않아요");
    expect(container.textContent).toContain("3 · 어느 쪽도 아니에요");
  });

  it("커플 결과에 비슷함의 기준과 다음 대화 질문을 함께 보여준다", async () => {
    await act(async () => root.render(
      <WeddingCodeV20Client
        shareOrigin="https://hanbang.ai"
        bothAnswers={{ first: { C1: 4 }, second: { C1: 5 } }}
      />,
    ));
    expect(container.textContent).toContain("한 단계 차이면 ‘비슷하게 답함’으로 묶었어요");
    expect(container.textContent).toContain("견적에서 각자 어떤 금액부터 확인하고 싶은가요?");
    expect(container.textContent).toContain("둘 다 건너뛴 문장 15개");
  });

  it("한 사람만 건너뛴 문장을 다른 답과 섞지 않는다", async () => {
    await act(async () => root.render(
      <WeddingCodeV20Client
        shareOrigin="https://hanbang.ai"
        bothAnswers={{ first: { C1: 5 }, second: {} }}
      />,
    ));
    expect(container.querySelector("[data-couple-differences]")?.textContent).toContain("두 사람이 함께 답한 문장이 없어요.");
    expect(container.querySelector("[data-couple-missing]")?.textContent).toContain("한 사람만 답한 문장");
    expect(container.querySelector("[data-couple-differences]")?.textContent).not.toContain("한 사람만 답했어요.");
  });
});
