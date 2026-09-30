import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axisInfo, letterInfo, loweredStrengthSentence } from "@/constants/weddingCodeV40";
import {
  V40_COPY,
  evenOneSidedLine,
  evenSideAnswersHeading,
  letterHeading,
  meaningLine,
  oppositeMeaningLine,
  strengthSentence,
} from "@/lib/weddingCode/v40/copy";
import type { AxisQuotes, AxisResult, QuoteItem } from "@/lib/weddingCode/v40/types";
import { AxisBlock } from "./AxisBlock";
import { isLoweredToEven } from "./CodeLine";
import { click, createHarness, type Harness } from "./inputTestKit";
import { buttonByText, hasButton, resultCase, textOf } from "./resultTestKit";

let harness: Harness;
beforeEach(() => {
  harness = createHarness();
});
afterEach(async () => {
  await harness.unmount();
});

function axisOf(name: string, axis: string): { readonly axis: AxisResult; readonly quotes: AxisQuotes } {
  const { result, quotes } = resultCase(name);
  const index = result.axes.findIndex((each) => each.axis === axis);
  return { axis: result.axes[index], quotes: quotes[index] };
}

function quote(id: string, caption: string, text: string): QuoteItem {
  return { itemId: id, caption, facet: "limit", format: "pair", value: 4, text, label: `${caption}: ${text}` };
}

describe("AxisBlock: 뚜렷해요, 기울어요", () => {
  it("기본으로 보이는 것: 주제, 글자와 세기, 뜻과 반대쪽 뜻, 세기 문장, 두 인용 묶음", async () => {
    const { axis, quotes } = axisOf("swua-example", "money");
    expect(axis.letter).toBe("S");
    expect(axis.shownBand).toBe("lean");
    await harness.render(<AxisBlock axis={axis} quotes={quotes} onReview={vi.fn()} />);
    const block = harness.container.querySelector("section")!;
    expect(block.querySelector("h2")?.textContent).toBe(axisInfo("money").title);
    expect(block.querySelector("[data-axis-heading]")?.textContent).toBe("S 장면 먼저 · 기울어요");
    const paragraphs = [...block.querySelectorAll("p")].map((node) => node.textContent);
    expect(paragraphs).toContain(meaningLine("S"));
    expect(paragraphs).toContain(oppositeMeaningLine("S"));
    expect(paragraphs).toContain(strengthSentence("money", "S", "lean"));
    expect([...block.querySelectorAll("[data-quote-group] h3")].map((node) => node.textContent)).toEqual([
      V40_COPY.block.answersMineHeading,
      V40_COPY.block.answersOppositeHeading,
    ]);
  });

  it("내가 고른 답은 최대 세 줄, 반대로 고른 답은 최대 두 줄이고 없으면 없다고 적는다", async () => {
    const { axis } = axisOf("swua-example", "money");
    const many: AxisQuotes = {
      kind: "settled",
      own: [quote("a", "가", "하나"), quote("b", "나", "둘"), quote("c", "다", "셋")],
      opposite: [],
    };
    await harness.render(<AxisBlock axis={axis} quotes={many} onReview={vi.fn()} />);
    const groups = harness.container.querySelectorAll("[data-quote-group]");
    expect(groups[0].querySelectorAll("li")).toHaveLength(3);
    expect(groups[0].querySelectorAll("li")[0].textContent).toBe("가: 하나");
    expect(groups[1].querySelectorAll("li")).toHaveLength(0);
    expect(textOf(groups[1])).toContain(V40_COPY.block.noOppositeLine);
    const none: AxisQuotes = { kind: "settled", own: [], opposite: [quote("d", "라", "넷")] };
    await harness.render(<AxisBlock axis={axis} quotes={none} onReview={vi.fn()} />);
    expect(textOf(harness.container.querySelectorAll("[data-quote-group]")[0])).toContain(V40_COPY.block.noAnswersLine);
    expect(harness.container.querySelectorAll("[data-quote-group]")[1].querySelectorAll("li")).toHaveLength(1);
  });

  it("코어가 더 많이 줘도 화면은 최대 줄 수를 지킨다", async () => {
    const { axis } = axisOf("swua-example", "money");
    const five = ["가", "나", "다", "라", "마"].map((caption, index) => quote(`q${index}`, caption, `글${index}`));
    await harness.render(<AxisBlock axis={axis} quotes={{ kind: "settled", own: five, opposite: five }} onReview={vi.fn()} />);
    const groups = harness.container.querySelectorAll("[data-quote-group]");
    expect(groups[0].querySelectorAll("li")).toHaveLength(3);
    expect(groups[1].querySelectorAll("li")).toHaveLength(2);
    const even = axisOf("swua-example", "support").axis;
    await harness.render(<AxisBlock key="even" axis={even} quotes={{ kind: "even", front: five, back: five }} onReview={vi.fn()} />);
    const sides = harness.container.querySelectorAll("[data-quote-group]");
    expect(sides[0].querySelectorAll("li")).toHaveLength(2);
    expect(sides[1].querySelectorAll("li")).toHaveLength(2);
  });

  it("더 보기: 처음에는 접혀 있고 열면 네 줄, 대화 제안 한 줄, 해 볼 것 한 줄, 다시 보기가 보인다", async () => {
    const onReview = vi.fn();
    const { axis, quotes } = axisOf("swua-example", "process");
    await harness.render(<AxisBlock axis={axis} quotes={quotes} onReview={onReview} />);
    const toggle = buttonByText(harness.container, V40_COPY.block.moreToggle);
    const region = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(region.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // 접혀 있어도 글은 문서에 있다
    const info = letterInfo("W");
    for (const line of info.appearances) expect(textOf(region)).toContain(line);
    expect(textOf(region)).toContain(`${V40_COPY.block.appearancesHeading}`);
    expect(textOf(region)).toContain(`둘이 이야기해 봐요: ${info.talk}`);
    expect(textOf(region)).toContain(`이렇게 해 봐요: ${info.tryThis}`);
    // 반대쪽 글자의 모습은 이 주제가 뚜렷하게 W 쪽일 때 나오지 않는다
    expect(textOf(region)).not.toContain(letterInfo("D").appearances[0]);
    await click(toggle);
    expect(region.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toBe(V40_COPY.block.lessToggle);
    await click(buttonByText(region, V40_COPY.block.reviewAxisButton));
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(onReview).toHaveBeenCalledWith("process");
    await click(toggle);
    expect(region.hidden).toBe(true);
  });

  it("다시 보기 단추는 어느 주제의 것인지 주제 제목을 설명으로 가리킨다", async () => {
    const { axis, quotes } = axisOf("swua-example", "scope");
    await harness.render(<AxisBlock axis={axis} quotes={quotes} onReview={vi.fn()} />);
    const button = buttonByText(harness.container, V40_COPY.block.reviewAxisButton);
    expect(document.getElementById(button.getAttribute("aria-describedby")!)?.textContent).toBe(axisInfo("scope").title);
  });

  it("세기와 맞지 않는 인용이 와도 죽지 않고 인용 없이 그린다", async () => {
    const { axis } = axisOf("swua-example", "money");
    await harness.render(<AxisBlock axis={axis} quotes={{ kind: "none" }} onReview={vi.fn()} />);
    const text = textOf(harness.container);
    expect(text).toContain(V40_COPY.block.noAnswersLine);
    expect(text).toContain(V40_COPY.block.noOppositeLine);
  });
});

describe("AxisBlock: 반반이에요", () => {
  it("두 글자의 뜻을 같은 무게로 적고 한쪽으로 답했다는 말과 반대쪽이라는 말이 없다", async () => {
    const { axis } = axisOf("swua-example", "support");
    expect(axis.shownBand).toBe("even");
    // 문항 문구(인용)에 기대지 않도록 인용 없이 화면이 만드는 글만 본다.
    await harness.render(<AxisBlock axis={axis} quotes={{ kind: "even", front: [], back: [] }} onReview={vi.fn()} />);
    const text = textOf(harness.container);
    expect(harness.container.querySelector("[data-axis-heading]")?.textContent).toBe(letterHeading("A", "even"));
    expect(text).toContain(meaningLine("H"));
    expect(text).toContain(meaningLine("A"));
    expect(text).toContain(V40_COPY.block.evenAppearancesNote);
    expect(text).not.toContain("반대쪽");
    expect(text).not.toContain("반대로 고른 답");
    expect(text).not.toContain(V40_COPY.block.answersMineHeading);
    for (const letter of ["H", "A"] as const) expect(text).not.toContain(letterInfo(letter).answerSentence);
    // 뜻 줄은 앞 글자, 뒤 글자 순서로 코드에 적은 글자와 상관없이 고정이다
    const paragraphs = [...harness.container.querySelectorAll("p")].map((node) => node.textContent);
    expect(paragraphs.indexOf(meaningLine("H"))).toBeLessThan(paragraphs.indexOf(meaningLine("A")));
  });

  it("두 방향으로 고른 답을 각각 최대 두 줄씩 나란히, 없으면 없다고 적는다", async () => {
    const { axis } = axisOf("swua-example", "support");
    const quotes: AxisQuotes = { kind: "even", front: [quote("a", "가", "하나"), quote("b", "나", "둘")], back: [] };
    await harness.render(<AxisBlock axis={axis} quotes={quotes} onReview={vi.fn()} />);
    const groups = [...harness.container.querySelectorAll("[data-quote-group]")];
    expect(groups.map((group) => group.querySelector("h3")?.textContent)).toEqual([
      evenSideAnswersHeading("H"),
      evenSideAnswersHeading("A"),
    ]);
    expect(groups[0].querySelectorAll("li")).toHaveLength(2);
    expect(textOf(groups[1])).toContain(V40_COPY.block.noSideAnswersLine);
  });

  it("더 보기에는 두 글자의 첫 줄과 두 글자의 대화 제안이 같은 비중으로 들어 있다", async () => {
    const { axis, quotes } = axisOf("swua-example", "support");
    const onReview = vi.fn();
    await harness.render(<AxisBlock axis={axis} quotes={quotes} onReview={onReview} />);
    const region = document.getElementById(buttonByText(harness.container, V40_COPY.block.moreToggle).getAttribute("aria-controls")!)!;
    const text = textOf(region);
    for (const letter of ["H", "A"] as const) {
      const info = letterInfo(letter);
      expect(text).toContain(info.appearances[0]);
      expect(text).not.toContain(info.appearances[1]);
      expect(text).toContain(`둘이 이야기해 봐요: ${info.talk}`);
      expect(text).toContain(`이렇게 해 봐요: ${info.tryThis}`);
    }
    await click(buttonByText(harness.container, V40_COPY.block.moreToggle));
    await click(buttonByText(region, V40_COPY.block.reviewAxisButton));
    expect(onReview).toHaveBeenCalledWith("support");
  });

  it("임시 글자는 제목 줄에 임시라고 적고 여전히 반반이에요로 그린다", async () => {
    const { axis, quotes } = axisOf("provisional-tie", "support");
    expect(axis.provisional).toBe(true);
    await harness.render(<AxisBlock axis={axis} quotes={quotes} onReview={vi.fn()} />);
    const heading = harness.container.querySelector("[data-axis-heading]")!.textContent!;
    expect(heading).toBe(letterHeading(axis.letter!, "even", true));
    expect(heading.endsWith("반반이에요 · 임시")).toBe(true);
    expect(textOf(harness.container)).not.toContain(V40_COPY.block.answersOppositeHeading);
  });

  it("고른 답이 한쪽에만 있는 반반이에요는 세기 문장 아래에 그 사정을 한 줄로 풀어 준다(양쪽에 있거나 양쪽에 없으면 붙이지 않는다)", async () => {
    const { axis } = axisOf("swua-example", "support");
    expect(isLoweredToEven(axis)).toBe(false);
    const sideOnly = (which: "front" | "back"): AxisQuotes =>
      which === "front" ? { kind: "even", front: [quote("a", "가", "하나")], back: [] } : { kind: "even", front: [], back: [quote("b", "나", "둘")] };
    await harness.render(<AxisBlock axis={axis} quotes={sideOnly("front")} onReview={vi.fn()} />);
    expect(harness.container.querySelector("[data-even-one-sided]")?.textContent).toBe(evenOneSidedLine("H"));
    await harness.render(<AxisBlock key="back" axis={axis} quotes={sideOnly("back")} onReview={vi.fn()} />);
    expect(harness.container.querySelector("[data-even-one-sided]")?.textContent).toBe(evenOneSidedLine("A"));
    const both: AxisQuotes = { kind: "even", front: [quote("a", "가", "하나")], back: [quote("b", "나", "둘")] };
    await harness.render(<AxisBlock key="both" axis={axis} quotes={both} onReview={vi.fn()} />);
    expect(harness.container.querySelector("[data-even-one-sided]")).toBeNull();
    await harness.render(<AxisBlock key="none" axis={axis} quotes={{ kind: "even", front: [], back: [] }} onReview={vi.fn()} />);
    expect(harness.container.querySelector("[data-even-one-sided]")).toBeNull();
    // 문장은 한쪽으로 기울었다고 하지 않고 모인 정도가 약하다고만 말한다
    expect(evenOneSidedLine("H")).not.toContain("쪽으로 답했어요");
  });

  it("힌트가 기울어요를 반반이에요로 낮춘 주제는 「크게 기울지 않았어요」라고 하지 않고 세기를 낮췄다고 말한다", async () => {
    const { result, quotes } = resultCase("rhythm-hint");
    const index = result.axes.findIndex((axis) => isLoweredToEven(axis));
    expect(index).toBeGreaterThanOrEqual(0);
    const axis = result.axes[index];
    await harness.render(<AxisBlock axis={axis} quotes={quotes[index]} onReview={vi.fn()} />);
    const text = textOf(harness.container);
    expect(text).toContain(loweredStrengthSentence(axis.letter!));
    expect(text).not.toContain("어느 쪽으로도 크게 기울지 않았어요");
    // 한쪽에만 답이 있어도 「모인 정도가 약해서」라는 풀이는 붙이지 않는다(낮춘 주제는 약하지 않았다)
    expect(harness.container.querySelector("[data-even-one-sided]")).toBeNull();
    // 세기 문장에 한쪽으로 모였다는 말도 없다
    expect(text).not.toContain("쪽으로 답했어요");
    expect(text).toContain(V40_COPY.block.evenAppearancesNote);
  });

  it("힌트가 뚜렷해요를 기울어요로 낮춘 주제는 기울어요 문장이 그대로 참이라 낮춘 주제로 치지 않는다", () => {
    const { result } = resultCase("skip-hint");
    for (const axis of result.axes) {
      if (axis.band === "clear" && axis.shownBand === "lean") expect(isLoweredToEven(axis)).toBe(false);
      if (axis.band === "even") expect(isLoweredToEven(axis)).toBe(false);
    }
  });

  it("힌트로 세기가 낮아진 주제(기울어요에서 반반이에요)는 낮춘 세기로 반반이에요처럼 그린다", async () => {
    const { result, quotes } = resultCase("rhythm-hint");
    const index = result.axes.findIndex((axis) => axis.band === "lean" && axis.shownBand === "even");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(quotes[index].kind).toBe("even");
    await harness.render(<AxisBlock axis={result.axes[index]} quotes={quotes[index]} onReview={vi.fn()} />);
    const info = axisInfo(result.axes[index].axis);
    const text = textOf(harness.container);
    expect(text).toContain(evenSideAnswersHeading(info.front));
    expect(text).toContain(evenSideAnswersHeading(info.back));
    expect(text).not.toContain(letterInfo(info.front).answerSentence);
    expect(text).not.toContain(letterInfo(info.back).answerSentence);
  });
});

describe("AxisBlock: 더 보기 단추", () => {
  it("테두리가 있는 단추이고 화살표가 열림과 닫힘을 보이며 이름은 더 보기, 접기 그대로다", async () => {
    const { axis, quotes } = axisOf("swua-example", "process");
    await harness.render(<AxisBlock axis={axis} quotes={quotes} onReview={vi.fn()} />);
    const toggle = buttonByText(harness.container, V40_COPY.block.moreToggle);
    // 테두리 없는 글자만 있으면 설명 글처럼 보인다: 다른 보조 단추(이 주제 답 다시 보기)와 같은 모양이다
    // (전환 효과 클래스에도 border-color 가 들어 있어서 낱말 그대로 border 인 클래스를 본다)
    expect(toggle.className).toMatch(/(^| )border( |$)/u);
    const closedIcon = toggle.querySelector("svg");
    expect(closedIcon?.getAttribute("aria-hidden")).toBe("true");
    await click(toggle);
    expect(toggle.textContent).toBe(V40_COPY.block.lessToggle);
    const openIcon = toggle.querySelector("svg");
    expect(openIcon?.getAttribute("aria-hidden")).toBe("true");
    expect(openIcon?.outerHTML).not.toBe(closedIcon?.outerHTML);
  });
});

describe("AxisBlock: 글자를 못 정한 주제", () => {
  it("잘 모르겠어요로 넘긴 질문이 없고 「제 상황과 안 맞아요」뿐이면 없는 넘어간 질문 다시 보기를 약속하지 않는다", async () => {
    const { axis, quotes } = axisOf("unusable-axis", "scope");
    expect(axis.skipped).toBeGreaterThan(0);
    await harness.render(<AxisBlock axis={axis} quotes={quotes} onReview={vi.fn()} />);
    expect(textOf(harness.container)).toContain(V40_COPY.block.unusableNote);
    expect(textOf(harness.container)).not.toContain(V40_COPY.block.unusableNoteNotApplicable);
    const notApplicableOnly: AxisResult = { ...axis, skipped: 0, notApplicable: 5 };
    await harness.render(<AxisBlock key="na" axis={notApplicableOnly} quotes={quotes} onReview={vi.fn()} />);
    expect(textOf(harness.container)).toContain(V40_COPY.block.unusableNoteNotApplicable);
    expect(textOf(harness.container)).not.toContain(V40_COPY.block.unusableNote);
    // 그 주제 답 다시 보기 단추는 그대로 있다(열여섯 질문을 모두 다시 연다)
    expect(hasButton(harness.container, V40_COPY.block.reviewAxisButton)).toBe(true);
  });

  it("이유를 되풀이하지 않고 다시 볼 수 있다는 말과 다시 보기만, 접지 않고 보인다", async () => {
    const onReview = vi.fn();
    const { axis, quotes } = axisOf("unusable-axis", "scope");
    expect(axis.letter).toBeNull();
    await harness.render(<AxisBlock axis={axis} quotes={quotes} onReview={onReview} />);
    const block = harness.container.querySelector("section")!;
    expect(block.getAttribute("data-band")).toBe("none");
    expect(block.querySelector("h2")?.textContent).toBe(axisInfo("scope").title);
    expect(textOf(block)).toContain(V40_COPY.block.unusableNote);
    expect(block.querySelector("[data-axis-heading], [data-fold], h3")).toBeNull();
    expect(hasButton(block, V40_COPY.block.moreToggle)).toBe(false);
    await click(buttonByText(block, V40_COPY.block.reviewAxisButton));
    expect(onReview).toHaveBeenCalledWith("scope");
  });
});
