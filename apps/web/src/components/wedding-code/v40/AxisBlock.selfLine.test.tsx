import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { meaningLine, strengthSentence, selfChoiceLine } from "@/lib/weddingCode/v40/copy";
import type { AxisQuotes, AxisResult, QuoteItem, SelfLine } from "@/lib/weddingCode/v40/types";
import { AxisBlock } from "./AxisBlock";
import { createHarness, type Harness } from "./inputTestKit";
import { ResultScreen } from "./ResultScreen";
import { bodyLine } from "./resultStyles";
import { FIXTURE_NAMES, resultCase, screenProps, textOf } from "./resultTestKit";
import { cx, noteText } from "./styles";

/**
 * 주제 블록의 「내가 마지막 정리에서 고른 쪽」 줄(4.1 단계 1)의 화면 시험.
 * 보이는 경우(뚜렷해요, 기울어요, 반반이에요)와 감추는 경우(대비가 있는 주제, 글자를 못 정한 주제, 다른 주제의 줄, 줄을 안 줌),
 * 세기 낱말 세 개, 줄의 자리(뚜렷해요·기울어요는 세기 문장 아래, 반반이에요는 두 글자의 뜻 아래), 줄의 글씨(메모 글씨, 줄바꿈 없는 덩어리),
 * 결과 화면 전체에서 줄이 나오는 주제와 대비 구역이 나뉘는 것을 확인한다.
 */
let harness: Harness;
beforeEach(() => {
  harness = createHarness();
});
afterEach(async () => {
  await harness.unmount();
  document.body.innerHTML = "";
});

function axisOf(name: string, axis: string): { readonly axis: AxisResult; readonly line: SelfLine | null } {
  const { result, selfLines } = resultCase(name);
  const index = result.axes.findIndex((each) => each.axis === axis);
  return { axis: result.axes[index], line: selfLines[index] };
}

const lineNodes = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>("[data-self-line]")];

function quoteOf(id: string, caption: string, text: string): QuoteItem {
  return { itemId: id, caption, facet: "limit", format: "pair", value: 4, text, label: `${caption}: ${text}` };
}

describe("AxisBlock: 마지막 정리에서 고른 쪽 줄이 보이는 경우", () => {
  it("기울어요 주제: 세기 문장 바로 아래에 「내가 마지막 정리에서 고른 쪽: 「S 장면 먼저」 · 꽤 가까워요」 한 줄이 있다", async () => {
    // swua-example: 돈 S 기울어요, 직접 고른 쪽은 S 꽤(같은 쪽이라 대비가 없다)
    const { axis, line } = axisOf("swua-example", "money");
    expect(axis).toMatchObject({ letter: "S", shownBand: "lean", contrast: null });
    expect(line).toEqual({ axis: "money", side: "back", letter: "S", level: 2 });
    await harness.render(<AxisBlock axis={axis} quotes={{ kind: "none" }} selfLine={line} onReview={vi.fn()} />);
    const nodes = lineNodes(harness.container);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].tagName).toBe("P");
    expect(nodes[0].textContent).toBe("내가 마지막 정리에서 고른 쪽: 「S 장면 먼저」 · 꽤 가까워요");
    expect(nodes[0].getAttribute("data-self-line")).toBe("money");
    // 세기 문장 바로 다음 문단이다.
    const strength = [...harness.container.querySelectorAll("p")].find((node) => node.textContent === strengthSentence("money", "S", "lean"));
    expect(strength).toBeDefined();
    expect(strength!.nextElementSibling).toBe(nodes[0]);
  });

  it("뚜렷해요 주제: 세기 문장 아래, 내가 고른 답 위에 있다", async () => {
    const { axis, line } = axisOf("swua-example", "process");
    expect(axis).toMatchObject({ letter: "W", shownBand: "clear" });
    const own = { kind: "settled", own: [], opposite: [] } as const;
    await harness.render(<AxisBlock axis={axis} quotes={own} selfLine={line} onReview={vi.fn()} />);
    const node = lineNodes(harness.container)[0];
    expect(node.textContent).toBe("내가 마지막 정리에서 고른 쪽: 「W 같이 하기」 · 아주 가까워요");
    const strength = [...harness.container.querySelectorAll("p")].find((each) => each.textContent === strengthSentence("process", "W", "clear"))!;
    expect(strength.nextElementSibling).toBe(node);
    const firstGroup = harness.container.querySelector("[data-quote-group]")!;
    expect(node.compareDocumentPosition(firstGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("반반이에요 주제: 세기 문장에서 떨어져 두 글자의 뜻 아래, 답 목록 위에 있다", async () => {
    const { axis, line } = axisOf("swua-example", "support");
    expect(axis).toMatchObject({ letter: "A", shownBand: "even" });
    await harness.render(<AxisBlock axis={axis} quotes={{ kind: "even", front: [], back: [] }} selfLine={line} onReview={vi.fn()} />);
    const node = lineNodes(harness.container)[0];
    expect(node.textContent).toBe("내가 마지막 정리에서 고른 쪽: 「A 할 일 먼저」 · 조금 가까워요");
    const paragraphs: HTMLElement[] = [...harness.container.querySelectorAll<HTMLElement>("p")];
    const heading = paragraphs.findIndex((each) => each.hasAttribute("data-axis-heading"));
    expect(heading).toBe(0);
    // 제목 줄, 세기 문장(「코드에는 한 글자만 …」), (한쪽 답 풀이가 있으면 그 줄), 두 글자의 뜻 두 줄, 직접 고른 쪽 줄 순서다.
    // 「코드에는 한 글자만 적을 수 있어서 …를 적었어요」 바로 다음에 오면 그 이유나 모순으로 읽히므로 두 글자의 뜻 뒤로 뺀다.
    const strengthIndex = paragraphs.findIndex((each) => each.textContent === strengthSentence("support", "A", "even"));
    expect(strengthIndex).toBe(1);
    expect(paragraphs[strengthIndex].textContent).toContain("코드에는 한 글자만");
    const frontMeaning = paragraphs.findIndex((each) => each.textContent === meaningLine("H"));
    const backMeaning = paragraphs.findIndex((each) => each.textContent === meaningLine("A"));
    const lineIndex = paragraphs.indexOf(node);
    expect(frontMeaning).toBeGreaterThan(strengthIndex);
    expect(backMeaning).toBe(frontMeaning + 1);
    expect(lineIndex).toBe(backMeaning + 1);
    expect(paragraphs[lineIndex - 1].textContent).toBe(meaningLine("A"));
    expect(paragraphs[strengthIndex].nextElementSibling).not.toBe(node);
    const firstGroup = harness.container.querySelector("[data-quote-group]")!;
    expect(node.compareDocumentPosition(firstGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("반반이에요 주제에서 코드 글자와 직접 고른 쪽 글자가 다르면 그 줄 바로 아래에 이유 한 줄이 있고, 같으면 없다(최종 점검 Q1)", async () => {
    const { axis, line } = axisOf("swua-example", "support");
    expect(axis).toMatchObject({ letter: "A", shownBand: "even" });
    // 같은 글자(A): 이유 줄이 없다.
    await harness.render(<AxisBlock axis={axis} quotes={{ kind: "even", front: [], back: [] }} selfLine={line} onReview={vi.fn()} />);
    expect(harness.container.querySelector("[data-even-self-differs]")).toBeNull();
    // 다른 글자(H 아주): 줄 바로 아래에 이유가 나온다.
    const opposite: SelfLine = { axis: "support", side: "front", letter: "H", level: 3 };
    await harness.render(<AxisBlock key="differs" axis={axis} quotes={{ kind: "even", front: [], back: [] }} selfLine={opposite} onReview={vi.fn()} />);
    const note = harness.container.querySelector<HTMLElement>("[data-even-self-differs]");
    expect(note).not.toBeNull();
    expect(note!.textContent).toBe("답이 거의 반반이라 글자는 아주 작은 차이로 정해졌어요. 그래서 마지막에 직접 고른 쪽과 달라요.");
    expect(note!.className).toBe(noteText);
    expect(lineNodes(harness.container)[0].nextElementSibling).toBe(note);
    // 직접 고른 쪽 줄을 안 그리는 때(줄을 안 줌)에는 이유 줄도 없다.
    await harness.render(<AxisBlock key="none" axis={axis} quotes={{ kind: "even", front: [], back: [] }} onReview={vi.fn()} />);
    expect(harness.container.querySelector("[data-even-self-differs]")).toBeNull();
    // 세기를 한 단계 낮춰 반반이에요가 된 주제는 거의 반반이 아니라서 이 말을 붙이지 않는다.
    const lowered: AxisResult = { ...axis, band: "lean", shownBand: "even" };
    await harness.render(<AxisBlock key="lowered" axis={lowered} quotes={{ kind: "even", front: [], back: [] }} selfLine={opposite} onReview={vi.fn()} />);
    expect(lineNodes(harness.container)).toHaveLength(1);
    expect(harness.container.querySelector("[data-even-self-differs]")).toBeNull();
  });

  it("한쪽 답 풀이가 있는 반반이에요 주제도 줄은 두 글자의 뜻 아래에 있다", async () => {
    const { axis, line } = axisOf("swua-example", "support");
    const oneSided: AxisQuotes = { kind: "even", front: [], back: [quoteOf("b", "나", "둘")] };
    await harness.render(<AxisBlock axis={axis} quotes={oneSided} selfLine={line} onReview={vi.fn()} />);
    const paragraphs: HTMLElement[] = [...harness.container.querySelectorAll<HTMLElement>("p")];
    const oneSidedNote = harness.container.querySelector("[data-even-one-sided]");
    expect(oneSidedNote).not.toBeNull();
    const lineIndex = paragraphs.indexOf(lineNodes(harness.container)[0]);
    expect(lineIndex).toBeGreaterThan(paragraphs.indexOf(oneSidedNote as HTMLElement));
    expect(paragraphs[lineIndex - 1].textContent).toBe(meaningLine("A"));
  });

  it("줄은 본문이 아니라 작고 흐린 메모 글씨이고, 글자 이름과 세기 낱말은 줄바꿈 없이 붙어 있으며 두 줄로 접히면 줄 길이를 고른다", async () => {
    const { axis, line } = axisOf("swua-example", "money");
    await harness.render(<AxisBlock axis={axis} quotes={{ kind: "none" }} selfLine={line} onReview={vi.fn()} />);
    const node = lineNodes(harness.container)[0];
    // 시스템이 말하는 세기 문장(본문 글씨)과 같은 무게가 아니다.
    expect(node.className).toBe(cx(noteText, "text-balance"));
    expect(node.className).not.toBe(bodyLine);
    expect(node.className).not.toContain("text-[var(--hb-text-body)]");
    const strength = [...harness.container.querySelectorAll("p")].find((each) => each.textContent === strengthSentence("money", "S", "lean"))!;
    expect(strength.className).toBe(bodyLine);
    // 「내가 …」 머리말은 줄바꿈 자리를 가진 보통 글이고, 뒤의 두 덩어리는 갈라지지 않는다.
    const nowrap = [...node.querySelectorAll<HTMLElement>("span.whitespace-nowrap")];
    expect(nowrap.map((each) => each.textContent)).toEqual(["「S 장면 먼저」 ·", "꽤 가까워요"]);
    expect(node.textContent).toBe(selfChoiceLine(line!));
    // 덩어리 밖의 글은 머리말과 공백뿐이다.
    const outside = [...node.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent);
    expect(outside.join("")).toBe("내가 마지막 정리에서 고른 쪽:  ");
  });

  it("고른 세기에 따라 조금, 꽤, 아주 가까워요로 적는다", async () => {
    const { axis } = axisOf("swua-example", "money");
    const expected = { 1: "조금 가까워요", 2: "꽤 가까워요", 3: "아주 가까워요" } as const;
    for (const level of [1, 2, 3] as const) {
      const line: SelfLine = { axis: "money", side: "front", letter: "V", level };
      await harness.render(<AxisBlock key={level} axis={axis} quotes={{ kind: "none" }} selfLine={line} onReview={vi.fn()} />);
      expect(lineNodes(harness.container)[0].textContent).toBe(`내가 마지막 정리에서 고른 쪽: 「V 조건 먼저」 · ${expected[level]}`);
      expect(selfChoiceLine(line)).toBe(lineNodes(harness.container)[0].textContent);
    }
  });

  it("고른 방향의 글자를 적는다(모인 쪽 글자가 아니다)", async () => {
    // 돈 주제가 S 쪽으로 모였어도 직접 고른 쪽이 V 조금(대비 조건 미달)이면 V 를 적는다.
    const { axis } = axisOf("swua-example", "money");
    const line: SelfLine = { axis: "money", side: "front", letter: "V", level: 1 };
    await harness.render(<AxisBlock axis={axis} quotes={{ kind: "none" }} selfLine={line} onReview={vi.fn()} />);
    const text = lineNodes(harness.container)[0].textContent ?? "";
    expect(text).toContain("「V 조건 먼저」");
    expect(text).not.toContain("S 장면 먼저");
  });
});

describe("AxisBlock: 마지막 정리에서 고른 쪽 줄을 그리지 않는 경우", () => {
  it("줄을 주지 않았거나 null 이면 없다", async () => {
    const { axis } = axisOf("swua-example", "money");
    await harness.render(<AxisBlock axis={axis} quotes={{ kind: "none" }} onReview={vi.fn()} />);
    expect(lineNodes(harness.container)).toHaveLength(0);
    await harness.render(<AxisBlock key="null" axis={axis} quotes={{ kind: "none" }} selfLine={null} onReview={vi.fn()} />);
    expect(lineNodes(harness.container)).toHaveLength(0);
    expect(textOf(harness.container)).not.toContain("마지막 정리에서 고른 쪽");
  });

  it("직접 고른 쪽 대비가 있는 주제에는 줄을 받아도 그리지 않는다(대비 문장이 같은 사실을 말한다)", async () => {
    // self-contrast: 준비 주제는 W 쪽으로 모였는데 직접 고른 쪽은 D 아주
    const { result } = resultCase("self-contrast");
    const contrasted = result.axes.filter((each) => each.contrast !== null);
    expect(contrasted.length).toBeGreaterThan(0);
    for (const axis of contrasted) {
      const line: SelfLine = { axis: axis.axis, side: axis.contrast!.selfSide, letter: axis.contrast!.selfLetter, level: axis.contrast!.selfLevel };
      await harness.render(<AxisBlock key={axis.axis} axis={axis} quotes={{ kind: "none" }} selfLine={line} onReview={vi.fn()} />);
      expect(lineNodes(harness.container), axis.axis).toHaveLength(0);
      expect(textOf(harness.container)).not.toContain("마지막 정리에서 고른 쪽");
    }
  });

  it("글자를 못 정한 주제에는 줄을 받아도 그리지 않는다", async () => {
    const { result } = resultCase("unusable-axis");
    const unusable = result.axes.find((each) => each.letter === null)!;
    const line: SelfLine = { axis: unusable.axis, side: "front", letter: "U", level: 3 };
    expect(unusable.axis).toBe("scope");
    await harness.render(<AxisBlock axis={unusable} quotes={{ kind: "none" }} selfLine={line} onReview={vi.fn()} />);
    expect(lineNodes(harness.container)).toHaveLength(0);
    expect(textOf(harness.container)).not.toContain("마지막 정리에서 고른 쪽");
  });

  it("다른 주제의 줄은 그리지 않는다(순서가 어긋나도 엉뚱한 주제에 붙지 않는다)", async () => {
    const { axis } = axisOf("swua-example", "money");
    const other = axisOf("swua-example", "process").line!;
    await harness.render(<AxisBlock axis={axis} quotes={{ kind: "none" }} selfLine={other} onReview={vi.fn()} />);
    expect(lineNodes(harness.container)).toHaveLength(0);
  });
});

describe("ResultScreen: 주제 블록마다 줄이 붙고 대비 구역과 겹치지 않는다", () => {
  async function renderScreen(name: string, overrides: Parameters<typeof screenProps>[1] = {}) {
    const props = screenProps(name, overrides);
    await harness.render(<ResultScreen {...props} />);
    return props;
  }

  it("swua-example: 네 주제 모두 자기 선택에 답했고 대비가 없어서 블록마다 한 줄씩 있다", async () => {
    await renderScreen("swua-example");
    const lines = lineNodes(harness.container);
    expect(lines.map((node) => node.textContent)).toEqual([
      "내가 마지막 정리에서 고른 쪽: 「S 장면 먼저」 · 꽤 가까워요",
      "내가 마지막 정리에서 고른 쪽: 「W 같이 하기」 · 아주 가까워요",
      "내가 마지막 정리에서 고른 쪽: 「U 둘이 정하기」 · 꽤 가까워요",
      "내가 마지막 정리에서 고른 쪽: 「A 할 일 먼저」 · 조금 가까워요",
    ]);
    for (const axis of ["money", "process", "scope", "support"]) {
      const block = harness.container.querySelector(`[data-axis-block="${axis}"]`)!;
      expect(lineNodes(block)).toHaveLength(1);
    }
    expect(harness.container.querySelector('[data-result-section="contrast"]')).toBeNull();
  });

  it("self-contrast: 대비가 있는 주제는 대비 구역이 말하고 그 블록에는 줄이 없으며, 없는 주제에는 줄이 있다", async () => {
    await renderScreen("self-contrast");
    const { result } = resultCase("self-contrast");
    const contrast = harness.container.querySelector('[data-result-section="contrast"]')!;
    expect(lineNodes(contrast)).toHaveLength(0);
    let withLine = 0;
    let withContrast = 0;
    for (const axis of result.axes) {
      const block = harness.container.querySelector(`[data-axis-block="${axis.axis}"]`)!;
      if (axis.contrast !== null) {
        withContrast += 1;
        expect(lineNodes(block), axis.axis).toHaveLength(0);
        expect(contrast.querySelector(`[data-contrast-axis="${axis.axis}"]`), axis.axis).not.toBeNull();
      } else {
        withLine += 1;
        expect(lineNodes(block), axis.axis).toHaveLength(1);
        expect(contrast.querySelector(`[data-contrast-axis="${axis.axis}"]`), axis.axis).toBeNull();
      }
    }
    expect(withContrast).toBeGreaterThan(0);
    expect(withLine).toBeGreaterThan(0);
    // 한 주제에 두 번 나오지 않는다: 직접 고른 쪽 사실은 줄이나 대비 문장 중 하나로만 말한다.
    expect(lineNodes(harness.container)).toHaveLength(withLine);
  });

  it("고정 표본 전부: 줄이 있는 주제는 글자가 있고 대비가 없으며 자기 선택에 답한 주제뿐이다", async () => {
    let total = 0;
    for (const name of FIXTURE_NAMES) {
      const { result, selfLines } = resultCase(name);
      await harness.unmount();
      harness = createHarness();
      await renderScreen(name);
      const shown = lineNodes(harness.container);
      if (result.code === null) {
        // 관문이 닫힌 결과에는 주제 블록이 없다.
        expect(shown, name).toHaveLength(0);
        continue;
      }
      const expected = result.axes.flatMap((axis, index) => {
        const line = selfLines[index];
        return line !== null && axis.letter !== null && axis.contrast === null ? [selfChoiceLine(line)] : [];
      });
      expect(shown.map((node) => node.textContent), name).toEqual(expected);
      total += shown.length;
    }
    expect(total).toBeGreaterThan(15);
  });

  it("selfLines 를 주지 않으면 줄이 없다(글은 그대로다)", async () => {
    await renderScreen("swua-example", { selfLines: undefined });
    expect(lineNodes(harness.container)).toHaveLength(0);
    expect(textOf(harness.container)).not.toContain("마지막 정리에서 고른 쪽");
  });
});
