import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

function radioInsideLabel(container: HTMLElement, text: string): HTMLInputElement {
  const label = [...container.querySelectorAll("label")].find((candidate) =>
    candidate.textContent?.includes(text)
  );
  const input = label?.querySelector("input[type=radio]");
  if (!(input instanceof HTMLInputElement)) throw new Error(`Radio not found: ${text}`);
  return input;
}

describe("Candidate 6 zero-I/O consumer prototype", () => {
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

  it("starts with an honest promise, no inferred result, and no unmeasured duration claim", () => {
    expect(container.textContent).toContain("우리 대화는 어디서부터 시작하면 편할까?");
    expect(container.textContent).toContain("점수·유형·궁합이 없어요");
    expect(container.textContent).toContain("걸리는 시간은 실제 사용성 검증 뒤 정확하게 안내할게요");
    expect(container.textContent).not.toContain("3분 테스트");
    expect(buttonByText(container, "장면 시작하기").disabled).toBe(true);
  });

  it("requires applicability, keeps optional stakeholder items out, and never auto-advances", async () => {
    await act(async () => radioInsideLabel(container, "둘이 정하기로 했어요").click());
    expect(buttonByText(container, "장면 시작하기").disabled).toBe(false);

    await act(async () => buttonByText(container, "장면 시작하기").click());
    const progress = container.querySelector('[role="progressbar"]');
    expect(progress?.getAttribute("aria-valuenow")).toBe("1");
    expect(progress?.getAttribute("aria-valuemax")).toBe("19");
    expect(container.textContent).toContain("축하할 장소나 진행 방식 두 개를 마지막으로 비교하는 장면");
    expect(container.textContent).toContain("첫째 많이");
    expect(container.textContent).toContain("첫째 조금");
    expect(container.textContent).toContain("나란히");
    expect(container.textContent).toContain("둘째 조금");
    expect(container.textContent).toContain("둘째 많이");
    expect(container.textContent).toContain("아래에서 5개 답을 비교하세요 ↓");
    expect(buttonByText(container, "선택 확인하고 다음").disabled).toBe(true);

    const firstChoice = container.querySelector(
      'input[name="candidate6-C6-DS1"][value="bipolar--2"]'
    );
    expect(firstChoice).toBeInstanceOf(HTMLInputElement);
    await act(async () => (firstChoice as HTMLInputElement).click());

    expect(container.textContent).toContain("장면 1");
    expect(buttonByText(container, "선택 확인하고 다음").disabled).toBe(false);
  });

  it("moves focus to the next question heading only after explicit confirmation", async () => {
    await act(async () => radioInsideLabel(container, "둘이 정하기로 했어요").click());
    await act(async () => buttonByText(container, "장면 시작하기").click());
    await act(async () =>
      (
        container.querySelector(
          'input[name="candidate6-C6-DS1"][value="bipolar-0"]'
        ) as HTMLInputElement
      ).click()
    );
    await act(async () => buttonByText(container, "선택 확인하고 다음").click());

    const heading = container.querySelector("h1[tabindex='-1']");
    expect(heading?.textContent).toContain("이 한 행동은 지금 나에게 어떤 영향을 줄까요?");
    expect(document.activeElement).toBe(heading);
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("2");
    expect(container.textContent).toContain("첫 후보 목록을 둘이 함께 만든다");
  });

  it("presents the neutral impact response with the same meaning visually and to assistive tech", async () => {
    await act(async () => radioInsideLabel(container, "둘이 정하기로 했어요").click());
    await act(async () => buttonByText(container, "장면 시작하기").click());
    await act(async () =>
      (
        container.querySelector(
          'input[name="candidate6-C6-DS1"][value="bipolar-0"]'
        ) as HTMLInputElement
      ).click()
    );
    await act(async () => buttonByText(container, "선택 확인하고 다음").click());

    const neutral = container.querySelector(
      'input[name="candidate6-C6-JI1"][value="impact-neutral_impact"]'
    );
    expect(neutral).toBeInstanceOf(HTMLInputElement);
    expect(neutral?.getAttribute("aria-label")).toBe("도움도 방해도 거의 없어요");
    expect(neutral?.closest("label")?.textContent).toContain("거의 없음");
  });

  it("adds exactly two stakeholder scenes only when explicitly applicable", async () => {
    await act(async () => radioInsideLabel(container, "의견을 들을 사람이 있어요").click());
    await act(async () => buttonByText(container, "장면 시작하기").click());
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuemax")).toBe("21");
  });

  it("finishes with a directly selected neutral card instead of an inferred type", async () => {
    await act(async () => radioInsideLabel(container, "둘이 정하기로 했어요").click());
    await act(async () => buttonByText(container, "장면 시작하기").click());

    for (let index = 0; index < 19; index += 1) {
      const choice = container.querySelector(
        'input[value^="bipolar-"], input[value^="impact-"]'
      );
      expect(choice, `question ${index + 1}`).toBeInstanceOf(HTMLInputElement);
      await act(async () => (choice as HTMLInputElement).click());
      const label = index === 18 ? "대화 카드 고르기" : "선택 확인하고 다음";
      await act(async () => buttonByText(container, label).click());
    }

    expect(container.textContent).toContain("오늘 실제로 꺼내고 싶은 대화를 골라주세요");
    expect(buttonByText(container, "내 카드 보기").disabled).toBe(true);
    await act(async () => buttonByText(container, "이번 선택은 조건부터 맞춰볼까").click());
    await act(async () => buttonByText(container, "내 카드 보기").click());

    expect(container.textContent).toContain("오늘의 대화 카드");
    expect(container.textContent).toContain("내가 직접 고른 대화 주제예요");
    expect(container.textContent).toContain("오늘은 이 한 문장만 꺼내도 충분해요");
    expect(container.textContent).toContain("새로고침하면 사라집니다");
    expect(container.textContent).not.toMatch(/살펴본 장면|모름·상황 차이·넘김/);
    expect(container.textContent).not.toMatch(/궁합 점수|정확도|희귀도|상위 \d+%/);
  });
});
