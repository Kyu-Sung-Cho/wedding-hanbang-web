import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CANDIDATE6_NEUTRAL_CONVERSATION_CARDS,
  CANDIDATE6_RESEARCH_ITEMS,
} from "../candidate6";
import { Candidate6Prototype } from "../Candidate6Prototype";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text)
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`);
  return button;
}

describe("문 앞 화면", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Candidate6Prototype form="A" />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("첫 화면이 결과가 아니라 물음으로 시작한다", () => {
    expect(container.querySelector("h1")?.textContent).toBe("우리 얘기, 어디서부터 꺼낼까요");
  });

  /**
   * 재미가 시작 전에 한 번 터지는 자리다. 동시에 마지막 「주는 카드」가 회수하는
   * 씨앗이라, 이 문장이 없으면 S6의 「꺼내는 사람이 늘 나였다면」이 근거 없이 나온다.
   */
  it("문 앞의 한 문장이 있다", () => {
    const hook = container.querySelector<HTMLElement>("[data-intro-hook]");
    expect(hook).not.toBeNull();
    expect(hook?.textContent).toContain("결혼 준비 얘기를 꺼내는 사람이");
    expect(hook?.textContent).toContain("늘 같은 사람이다");
  });

  // 이 문장은 측정 앞에 오므로 프라이밍 경로가 될 수 있다. 어떤 문항의 anchor도
  // 미리 밀어주지 않아야 Form A/B 위치편향 상쇄가 유지된다.
  it("문 앞 문장이 어떤 anchor 원문도 포함하지 않는다", () => {
    const hook = container.querySelector<HTMLElement>("[data-intro-hook]")?.textContent ?? "";
    // 빈 문자열은 어떤 anchor도 포함하지 않으므로, 문장이 없으면 이 검사는 공허하다.
    expect(hook.length, "문 앞 문장이 없으면 이 검사는 아무것도 증명하지 않는다")
      .toBeGreaterThan(10);
    const anchors = CANDIDATE6_RESEARCH_ITEMS.flatMap((item) => [
      ...("leftAnchor" in item ? [item.leftAnchor] : []),
      ...("rightAnchor" in item ? [item.rightAnchor] : []),
    ]);
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(hook).not.toContain(anchor);
    }
  });

  /**
   * 사이클 3에서 카드 후보를 21장면 파생으로 바꾸면서 옛 중립 카드 3장은 흐름에서
   * 빠졌다. 그런데 첫 화면은 그중 한 장을 「마지막에 직접 고를 것」으로 계속 미리
   * 보여주고 있었다 — 끝까지 가도 만날 수 없는 카드다. 첫 화면이 지키지 못할 약속을
   * 하지 않는지 고정한다.
   */
  it("흐름에 없는 카드를 미리 약속하지 않는다", () => {
    const text = container.textContent ?? "";
    expect(CANDIDATE6_NEUTRAL_CONVERSATION_CARDS.length).toBeGreaterThan(0);
    for (const card of CANDIDATE6_NEUTRAL_CONVERSATION_CARDS) {
      expect(text, `퇴역 카드 "${card.title}"이 첫 화면에 남아 있다`).not.toContain(card.prompt);
      expect(text, `퇴역 카드 제목 "${card.title}"이 첫 화면에 남아 있다`)
        .not.toContain(card.title);
    }
  });

  it("무엇을 받게 되는지 결과가 아니라 절차로 알린다", () => {
    const text = container.textContent ?? "";
    expect(text).toContain("장면을 하나씩 보고, 마지막에 오늘 꺼낼 한 마디를 직접 고릅니다.");
    expect(text).toContain("지나온 장면은 마지막에 다시 모아 보여드려요.");
  });

  it("신뢰 3점과 시간 고지를 유지한다", () => {
    const text = container.textContent ?? "";
    expect(text).toContain("저장하지 않아요");
    expect(text).toContain("정답을 강요하지 않아요");
    expect(text).toContain("점수·유형·궁합이 없어요");
    expect(text).toContain("걸리는 시간은 실제 사용성 검증 뒤 정확하게 안내할게요");
  });

  // 기획서 카피 덱은 「첫 장면 보기」였지만 기존 라벨을 유지한다. 이 문자열을 바꾸면
  // 브라우저가 필요해 이 자리에서 검증할 수 없는 운영 QA 스크립트 2개
  // (`wedding-code-candidate6-{security,visual}-qa.mjs`)까지 깨진다. 순수 카피 취향에
  // 검증 못 하는 도구를 거는 교환은 하지 않는다.
  it("고르기 전에는 시작할 수 없다", () => {
    expect(buttonByText(container, "장면 시작하기").disabled).toBe(true);
  });

  it("판정 언어를 쓰지 않는다", () => {
    expect(container.textContent ?? "").not.toMatch(/성향|유형 결과|궁합을|정확도|테스트하기/);
  });
});
