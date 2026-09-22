// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WEDDING_CODE_V20_TOTAL } from "@/constants/weddingCodeV20";
import { captureWeddingCodeEvent } from "@/lib/analytics";
import WeddingCodeEntryClient from "./WeddingCodeEntryClient";
import WeddingCodeV20Client from "./WeddingCodeV20Client";

vi.mock("@/lib/analytics", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/analytics")>(),
  captureWeddingCodeEvent: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * prove-guard 영수증 (2026-09-22): 아래 단언은 그대로 두고 V20 UI 소스만 하나씩 변형했다.
 * - restart의 resetLocal() 제거 → 연속 다시 답하기 테스트 실패(exit 1).
 * - 완료 이벤트가 nextAnswers 대신 이전 answers를 세게 변경 → 마지막 skip 테스트 실패(exit 1).
 * - second 응답이 없어도 공유 URL을 만들게 변경 → 상대 링크 all-skip 공유 테스트 실패(exit 1).
 * 각 변형 후 원래 소스를 정확히 복원했고 세 경우 모두 해당 동작 단언에서 실패했다.
 */
describe("WeddingCodeV20Client", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { vi.clearAllMocks(); window.history.replaceState(null, "", "/wedding-code"); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); });

  async function clickButton(label: string) {
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
    expect(button, `${label} 버튼이 있어야 해요`).toBeDefined();
    await act(async () => button?.click());
  }

  it("부모가 다시 시작을 처리해도 v20 자체는 두 번 연속 빈 응답으로 초기화한다", async () => {
    const onRestart = vi.fn();
    await act(async () => root.render(<WeddingCodeV20Client shareOrigin="https://hanbang.ai" onRestart={onRestart} />));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await clickButton("시작하기");
      expect(container.querySelector('[data-question="C1"]')).not.toBeNull();
      expect(container.querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(0);
      await act(async () => container.querySelector<HTMLButtonElement>('[data-answer="5"]')?.click());
      await clickButton("다음 문장");
      for (let index = 1; index < WEDDING_CODE_V20_TOTAL; index += 1) await clickButton("지금은 답하기 어려워요");
      expect(container.textContent).toContain("답한 1문장");
      await clickButton("다시 답하기");
      expect(container.querySelector('[aria-label="웨딩코드 소개"]')).not.toBeNull();
      expect(container.querySelector('[data-result="solo-v20"]')).toBeNull();
    }
    expect(vi.mocked(captureWeddingCodeEvent).mock.calls.filter(([event]) => event === "wedding_code_restarted")).toHaveLength(2);
    expect(onRestart).toHaveBeenCalledTimes(2);
  });

  it("마지막 답을 고른 뒤 건너뛰면 완료 이벤트와 결과 모두 그 답을 제외한다", async () => {
    await act(async () => root.render(<WeddingCodeV20Client shareOrigin="https://hanbang.ai" />));
    await clickButton("시작하기");
    for (let index = 0; index < WEDDING_CODE_V20_TOTAL - 1; index += 1) await clickButton("지금은 답하기 어려워요");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-answer="5"]')?.click());
    await clickButton("지금은 답하기 어려워요");
    expect(container.querySelector('[data-result="solo-v20"]')?.hasAttribute("data-empty")).toBe(true);
    expect(captureWeddingCodeEvent).toHaveBeenCalledWith("wedding_code_completed", expect.objectContaining({ answered_count: 0 }));
    expect(vi.mocked(captureWeddingCodeEvent).mock.calls.filter(([event]) => event === "wedding_code_completed")).toHaveLength(1);
  });

  it("상대 링크에서 전부 건너뛰면 커플 결과 링크를 만들지 않는다", async () => {
    window.history.replaceState(null, "", "/wedding-code#v=v2.0-agreement&a=5---------------");
    await act(async () => root.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" />));
    await clickButton("나도 답해보기");
    for (let index = 0; index < WEDDING_CODE_V20_TOTAL; index += 1) await clickButton("지금은 답하기 어려워요");
    expect(container.querySelector('[data-result="couple-v20"]')).not.toBeNull();
    expect(container.textContent).toContain("나중에 답한 사람은 모든 문장을 건너뛰었어요. 둘이 비교할 답이 없어 결과 링크를 만들지 않았어요.");
    expect(container.querySelector('[data-share-box="v20"]')).toBeNull();
    expect(container.querySelector('input[aria-label="웨딩코드 공유 링크"]')).toBeNull();
  });

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
    expect(container.querySelector('[data-share-box="v20"]')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[aria-label="웨딩코드 공유 링크"]')?.value).toContain("&b=5---------------");
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
