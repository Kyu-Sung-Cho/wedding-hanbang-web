import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCandidate6Journey } from "../candidate6";
import { CANDIDATE6_INTERLUDE_SENTENCES, interludeIndexes } from "../candidate6SceneText";
import { Candidate6Prototype } from "../Candidate6Prototype";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const JOURNEY = buildCandidate6Journey("A", "not_applicable", "ES_FIRST");
const INTERLUDES = interludeIndexes(JOURNEY.length);

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

function rhythmLabel(container: HTMLElement): string {
  return container.querySelector<HTMLElement>("[data-scene-rhythm]")?.textContent ?? "";
}

function isInterlude(container: HTMLElement): boolean {
  return container.querySelector("[data-interlude]") !== null;
}

describe("이야기 리듬 · 막간 · 황혼", () => {
  let root: Root;
  let container: HTMLDivElement;

  async function mount(applicability: string) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Candidate6Prototype form="A" />));
    await act(async () => radioInsideLabel(container, applicability).click());
    await act(async () => buttonByText(container, "장면 시작하기").click());
  }

  /** 현재 문항에 답하고 넘긴다. 막간이 나오면 넘기고 몇 번 나왔는지 센다. */
  async function answerAndAdvance(isLast: boolean): Promise<boolean> {
    const choice = container.querySelector('input[value^="bipolar-"], input[value^="impact-"]');
    await act(async () => (choice as HTMLInputElement).click());
    await act(async () =>
      buttonByText(container, isLast ? "지나온 장면 보기" : "다음").click());
    if (isInterlude(container)) {
      await act(async () => buttonByText(container, "넘기기").click());
      return true;
    }
    return false;
  }

  beforeEach(async () => {
    await mount("둘이 정하기로 했어요");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("진행률 바를 쓰지 않는다 — 숫자가 아니라 말로 알린다", () => {
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.querySelector("[style*='width']")).toBeNull();
    expect(rhythmLabel(container)).toBe("첫 장면");
  });

  it("전체 장면 수는 보조기술에도 같은 값으로 준다", () => {
    const total = container.querySelector<HTMLElement>("[data-scene-total]");
    expect(total?.dataset.sceneTotal).toBe(String(JOURNEY.length));
    expect(total?.className).toContain("sr-only");
  });

  it("마지막 세 장에서 숫자가 문장으로 바뀐다", async () => {
    const seen: string[] = [];
    for (let index = 0; index < JOURNEY.length; index += 1) {
      seen.push(rhythmLabel(container));
      await answerAndAdvance(index === JOURNEY.length - 1);
    }
    expect(seen[0]).toBe("첫 장면");
    expect(seen[3]).toBe("장면 4");
    expect(seen[JOURNEY.length - 3]).toBe("세 장 남았어요");
    expect(seen[JOURNEY.length - 2]).toBe("다음이 마지막");
    expect(seen[JOURNEY.length - 1]).toBe("마지막 한 장");
  });

  it("막간은 정해진 위치에서만, 자동 넘김 없이 나온다", async () => {
    let interludeCount = 0;
    for (let index = 0; index < JOURNEY.length; index += 1) {
      if (await answerAndAdvance(index === JOURNEY.length - 1)) interludeCount += 1;
    }
    expect(interludeCount).toBe(INTERLUDES.length);
    expect(interludeCount).toBeLessThanOrEqual(3);
  });

  it("막간 화면에는 넘기기 버튼 하나뿐이고 입력이 없다", async () => {
    for (let index = 0; index < INTERLUDES[0]; index += 1) {
      const choice = container.querySelector('input[value^="bipolar-"], input[value^="impact-"]');
      await act(async () => (choice as HTMLInputElement).click());
      await act(async () => buttonByText(container, "다음").click());
    }
    expect(isInterlude(container)).toBe(true);
    const sheet = container.querySelector<HTMLElement>("[data-interlude]");
    expect(CANDIDATE6_INTERLUDE_SENTENCES).toContain(sheet?.dataset.interlude);
    expect(sheet?.textContent).toContain(sheet?.dataset.interlude);
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  // 막간이 응답에 따라 달라지면 특정 응답을 보상하는 장치가 된다. 위치만의 함수여야 한다.
  it("막간 위치는 응답 종류와 무관하다 — 넘기기를 골라도 같다", async () => {
    const withNormal: number[] = [];
    for (let index = 0; index < JOURNEY.length; index += 1) {
      if (await answerAndAdvance(index === JOURNEY.length - 1)) withNormal.push(index);
    }

    await act(async () => root.unmount());
    document.body.replaceChildren();
    await mount("둘이 정하기로 했어요");

    const withEscape: number[] = [];
    for (let index = 0; index < JOURNEY.length; index += 1) {
      const escapeToggle = [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("딱 맞는 답이 없어요"));
      if (escapeToggle) await act(async () => escapeToggle.click());
      const escapeChoice = container.querySelector('input[value^="escape-"]');
      if (escapeChoice) {
        await act(async () => (escapeChoice as HTMLInputElement).click());
      } else {
        const choice = container.querySelector('input[value^="bipolar-"], input[value^="impact-"]');
        await act(async () => (choice as HTMLInputElement).click());
      }
      await act(async () =>
        buttonByText(container, index === JOURNEY.length - 1 ? "지나온 장면 보기" : "다음").click());
      if (isInterlude(container)) {
        withEscape.push(index);
        await act(async () => buttonByText(container, "넘기기").click());
      }
    }

    // 빈 배열끼리 비교하면 막간이 아예 없어도 통과한다 — 공허한 단정을 막는다.
    expect(withNormal.length, "막간이 한 번도 안 나오면 이 검사는 아무것도 증명하지 않는다")
      .toBe(INTERLUDES.length);
    expect(withNormal.length).toBeGreaterThan(0);
    expect(withEscape).toEqual(withNormal);
  });

  it("마지막 세 장에서 배경이 깊어지고 마지막 한 장만 champagne 테두리를 쓴다", async () => {
    const backgrounds: string[] = [];
    const borders: boolean[] = [];
    for (let index = 0; index < JOURNEY.length; index += 1) {
      const shell = container.querySelector<HTMLElement>("[data-dusk]");
      backgrounds.push(shell?.dataset.dusk ?? "");
      borders.push(container.querySelector("[data-dusk-edge]") !== null);
      await answerAndAdvance(index === JOURNEY.length - 1);
    }
    const tail = backgrounds.slice(-3);
    expect(new Set(tail).size, `마지막 세 장 배경이 같다: ${tail.join(", ")}`).toBe(3);
    expect(backgrounds.slice(0, -3).every((value) => value === backgrounds[0])).toBe(true);
    expect(borders.filter(Boolean)).toHaveLength(1);
    expect(borders[JOURNEY.length - 1]).toBe(true);
  });

  // 완료에 고유 연출이 붙으면 특정 응답을 보상하는 장치가 된다.
  it("마지막 장면의 다음 버튼이 중간 장면과 같은 전환을 쓴다", async () => {
    const transitionOf = (element: HTMLElement) =>
      element.className.split(/\s+/).filter((token) => /transition|duration|ease/.test(token))
        .sort().join(" ");

    const middle = transitionOf(buttonByText(container, "다음"));
    for (let index = 0; index < JOURNEY.length - 1; index += 1) {
      await answerAndAdvance(false);
    }
    const last = transitionOf(buttonByText(container, "지나온 장면 보기"));
    expect(last).toBe(middle);
  });

  it("주변 의견을 듣는 21장면에서도 총수와 막간 규칙이 맞는다", async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    await mount("의견을 들을 사람이 있어요");

    const longJourney = buildCandidate6Journey("A", "applicable", "ES_FIRST");
    expect(container.querySelector<HTMLElement>("[data-scene-total]")?.dataset.sceneTotal)
      .toBe(String(longJourney.length));
  });
});

/**
 * press feedback은 **손가락이 집는 방향으로 뜬다**(기획 §6-2). 그리고 다섯 답·escape
 * 4택·모든 버튼에 **완전히 동일하게** 적용해야 특정 응답 차등이 0이 된다(§3 S0).
 *
 * 2026-07-28 감사: 다섯 답과 escape 4택이 오히려 반대 방향(가라앉음)이었고 주/보조
 * 버튼에는 `active:` 변형이 아예 없었다. 반전이 들어간 곳은 라벨과 카드 후보 행뿐이었다.
 */
describe("press feedback이 전 표면에서 같다", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Candidate6Prototype form="A" />));
    await act(async () => radioInsideLabel(container, "둘이 정하기로 했어요").click());
    await act(async () => buttonByText(container, "장면 시작하기").click());
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  const pressOf = (element: HTMLElement) =>
    element.className.split(/\s+/).filter((token) => token.startsWith("active:")).sort().join(" ");

  it("다섯 답이 전부 같은 press를 쓴다 — 특정 응답 차등 0", () => {
    const cells = [...container.querySelectorAll<HTMLElement>("label")]
      .filter((label) => label.querySelector('input[value^="bipolar-"], input[value^="impact-"]'));
    expect(cells.length, "다섯 답을 못 찾았다").toBe(5);

    const presses = new Set(cells.map(pressOf));
    expect(presses.size, `답마다 press가 다르다: ${[...presses].join(" / ")}`).toBe(1);
    expect([...presses][0], "press가 비어 있다").not.toBe("");
  });

  it("누르면 가라앉지 않고 뜬다 — 손가락이 집는 방향", () => {
    const cell = [...container.querySelectorAll<HTMLElement>("label")]
      .find((label) => label.querySelector('input[value^="bipolar-"]'))!;
    const press = pressOf(cell);
    expect(press, "위로 뜨는 이동이 없다").toContain("active:-translate-y-");
    expect(press, "축소는 가라앉는 방향이다").not.toMatch(/active:scale-\[0\./);
  });

  it("주 버튼과 답이 같은 press를 쓴다", () => {
    const cell = [...container.querySelectorAll<HTMLElement>("label")]
      .find((label) => label.querySelector('input[value^="bipolar-"]'))!;
    expect(pressOf(buttonByText(container, "다음"))).toBe(pressOf(cell));
  });
});
