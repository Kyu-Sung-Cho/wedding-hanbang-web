import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  V40_LETTER_LIST,
  V40_STRENGTH,
  V40_SUFFIX,
  axisInfo,
  evenStrengthSentence,
  letterInfo,
  loweredStrengthSentence,
  oppositeLetter,
  type Letter,
} from "@/constants/weddingCodeV40";
import {
  V40_COPY,
  V40_NOT_VALIDATED_PHRASE,
  codeCopyText,
  collectedSentence,
  evenSideAnswersHeading,
  meaningLine,
  oppositeMeaningLine,
  selfContrastSentence,
} from "@/lib/weddingCode/v40/copy";
import { click, createHarness, type Harness } from "./inputTestKit";
import { codeLineEntries, isLoweredToEven } from "./CodeLine";
import { ResultScreen } from "./ResultScreen";
import {
  ALLOWED_LETTERS,
  FIXTURE_NAMES,
  SEPT_29_NOON_KST,
  buttonByText,
  countOf,
  hasButton,
  historyOf,
  resultCase,
  screenProps,
  sectionOrder,
  standaloneCapitals,
  textOf,
} from "./resultTestKit";

/** 결과 화면에서 이 순서로 나와야 하는 구역(설계 7절 (1)~(11)). 없는 구역은 건너뛴다. */
const SECTION_ORDER = [
  "header",
  "quality-hint",
  "code",
  "legend",
  "collected",
  "axis",
  "contrast",
  "quality",
  "history",
  "send",
  "taste",
  "manage",
] as const;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

let harness: Harness;
beforeEach(() => {
  harness = createHarness();
});
afterEach(async () => {
  await harness.unmount();
  document.body.innerHTML = "";
});

async function renderScreen(name: string, overrides: Parameters<typeof screenProps>[1] = {}) {
  const props = screenProps(name, overrides);
  await harness.render(<ResultScreen {...props} />);
  return props;
}

function axisBlock(axis: string): HTMLElement {
  const block = harness.container.querySelector<HTMLElement>(`[data-axis-block="${axis}"]`);
  if (!block) throw new Error(`주제 블록이 없어요: ${axis}`);
  return block;
}

/** 인용한 답(문항 문구)을 뺀 화면 글. */
function textWithoutQuotes(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement;
  for (const quote of copy.querySelectorAll("[data-quote-item]")) quote.remove();
  return textOf(copy);
}

const CLOSED = new Set(FIXTURE_NAMES.filter((name) => resultCase(name).result.code === null));
const OPEN_NAMES = FIXTURE_NAMES.filter((name) => !CLOSED.has(name));

describe("표본이 실제로 보여 주려는 경우를 덮는다", () => {
  const all = FIXTURE_NAMES.map((name) => resultCase(name));
  it("뚜렷해요, 기울어요, 반반이에요, 임시, 글자를 못 정함, 관문, 힌트가 모두 표본에 있다", () => {
    const bands = new Set(all.flatMap(({ result }) => result.axes.map((axis) => axis.shownBand)));
    expect(bands).toEqual(new Set(["clear", "lean", "even", null]));
    expect(all.some(({ result }) => result.axes.some((axis) => axis.provisional))).toBe(true);
    expect(all.some(({ result }) => result.gate.closed)).toBe(true);
    expect(all.some(({ result }) => result.notes.hintRhythm && !result.gate.closed)).toBe(true);
    expect(all.some(({ result }) => result.notes.hintSkip)).toBe(true);
    expect(all.some(({ result }) => result.axes.some((axis) => axis.contrast !== null))).toBe(true);
    expect(all.some(({ result }) => result.notes.hasOmitted)).toBe(true);
  });
});

describe.each(OPEN_NAMES)("혼자 보는 결과 (표본 %s)", (name) => {
  const { result, quotes } = resultCase(name);
  const entries = codeLineEntries(result);

  it("구역이 설계 순서(1)~(11) 그대로 나온다", async () => {
    await renderScreen(name, { previous: historyOf(result, SEPT_29_NOON_KST), sendSlot: <p>보내기 자리</p> });
    const order = sectionOrder(harness.container);
    const expected = SECTION_ORDER.filter((section) => order.includes(section));
    expect(order).toEqual(expected);
    // 늘 있는 구역
    for (const section of ["header", "code", "legend", "collected", "axis", "history", "send", "taste", "manage"]) {
      expect(order, section).toContain(section);
    }
    expect(harness.container.querySelectorAll("[data-axis-block]")).toHaveLength(4);
  });

  it("글자 읽는 법 표는 네 줄이고 글자 여덟 개가 한 번씩, 한 가지 뜻으로만 나온다", async () => {
    await renderScreen(name);
    const rows = harness.container.querySelectorAll("[data-legend-row]");
    expect(rows).toHaveLength(4);
    const cells = [...harness.container.querySelectorAll<HTMLElement>("[data-legend-letter]")];
    expect(cells.map((cell) => cell.dataset.legendLetter)).toEqual([...V40_LETTER_LIST]);
    for (const cell of cells) {
      const letter = cell.dataset.legendLetter as Letter;
      expect(textOf(cell).startsWith(`${letter} ${letterInfo(letter).name}`)).toBe(true);
      expect(textOf(cell)).toContain(letterInfo(letter).english);
    }
    // 화면 어디서든 「글자 한 자 + 공백 + 한글」은 그 글자의 이름으로 시작한다(같은 글자가 다른 뜻으로 다시 쓰이지 않는다).
    // 예외는 「H 쪽으로 고른 답」 제목과 「W 쪽으로 대체로 모였어요」 문장의 「쪽으로」뿐이고 이것도 그 글자 자신을 가리킨다.
    const flat = textOf(harness.container);
    const named = [...flat.matchAll(/(?<![A-Za-z])([VSWDUFHA]) (?=[가-힣])/g)];
    expect(named.length).toBeGreaterThanOrEqual(8);
    for (const match of named) {
      const letter = match[1] as Letter;
      const after = flat.slice((match.index ?? 0) + 2);
      const ok = after.startsWith(letterInfo(letter).name) || after.startsWith("쪽으로 ");
      expect(ok, `${letter} 뒤: ${after.slice(0, 12)}`).toBe(true);
    }
    // 글자마다 이름이 서로 다르다
    expect(new Set(cells.map((cell) => letterInfo(cell.dataset.legendLetter as Letter).name)).size).toBe(8);
    // 화면의 뜻 줄은 모두 상수의 그 글자 뜻과 같다
    const meaningLines = [...harness.container.querySelectorAll("p")]
      .map((paragraph) => paragraph.textContent ?? "")
      .filter((line) => /^[VSWDUFHA]는 /.test(line));
    expect(meaningLines.length).toBeGreaterThan(0);
    for (const line of meaningLines) {
      const letter = line[0] as Letter;
      expect(line).toBe(meaningLine(letter));
    }
    // 반대쪽 뜻 줄도 그 글자의 뜻 하나와 같다
    for (const line of [...harness.container.querySelectorAll("p")]
      .map((paragraph) => paragraph.textContent ?? "")
      .filter((text) => /^반대쪽 [VSWDUFHA]는 /.test(text))) {
      const opposite = line.slice(4, 5) as Letter;
      expect(line).toBe(oppositeMeaningLine(oppositeLetter(opposite)));
    }
  });

  it("검증 아님 고지는 이 화면에서 정확히 한 번이고 제목 바로 아래에 있다", async () => {
    await renderScreen(name);
    expect(countOf(textOf(harness.container), V40_NOT_VALIDATED_PHRASE)).toBe(1);
    const header = harness.container.querySelector("header");
    expect(header?.querySelector("h1")?.textContent).toBe(V40_COPY.result.title);
    expect(header?.querySelector("[data-result-notice]")?.textContent).toBe(V40_COPY.result.notice);
  });

  it("글자는 V S W D U F H A 뿐이고 숫자 몇 대 몇, 점수, 퍼센트, 등급, 궁합 말이 없다", async () => {
    await renderScreen(name, { previous: historyOf(result, SEPT_29_NOON_KST) });
    const text = textOf(harness.container);
    const capitals = standaloneCapitals(harness.container);
    for (const letter of capitals) expect(ALLOWED_LETTERS.has(letter), letter).toBe(true);
    // 표를 항상 펼쳐 두므로 여덟 글자가 모두 화면에 있다
    expect(new Set(capitals)).toEqual(new Set(V40_LETTER_LIST));
    for (const word of ["%", "％", "퍼센트", "백분율", "점수", "등급", "궁합", "순위", "검증된", "과학적"]) {
      expect(text, word).not.toContain(word);
    }
    expect(text).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(text).not.toMatch(/\d+\s*(점|위|등)(?![가-힣])/);
  });

  it("코드 줄의 글자와 표시는 결과와 같다", async () => {
    await renderScreen(name);
    const letters = [...harness.container.querySelectorAll("[data-code-letter]")].map((node) => node.textContent);
    expect(letters).toEqual(entries.map((entry) => entry.letter ?? "·"));
    const evenCount = entries.filter((entry) => entry.letter !== null && entry.band === "even").length;
    const evenMarks = [...harness.container.querySelectorAll("[data-code-axis]")].filter((cell) =>
      textOf(cell).includes(V40_COPY.result.evenMark),
    );
    expect(evenMarks).toHaveLength(evenCount);
    // 힌트가 세기를 낮춰서 반반이에요가 된 주제가 하나라도 있으면 「크게 기울지 않았다」만 말하는 안내 대신 낮춘 경우도 말하는 안내를 쓴다.
    const anyLowered = entries.some((entry) => entry.lowered === true);
    expect(harness.container.textContent?.includes(V40_COPY.result.evenCodeNote)).toBe(evenCount > 0 && !anyLowered);
    expect(harness.container.textContent?.includes(V40_COPY.result.evenCodeNoteLowered)).toBe(evenCount > 0 && anyLowered);
  });

  it("코드 줄의 각 글자 아래에 그 글자의 이름이 있고 글자를 못 정한 주제는 이름이 비어 있다", async () => {
    await renderScreen(name);
    const names = [...harness.container.querySelectorAll("[data-code-letter-name]")].map((node) => node.textContent);
    expect(names).toEqual(entries.map((entry) => (entry.letter === null ? "" : letterInfo(entry.letter).name)));
  });

  it("주제 네 개의 「답을 모아 보니」 문장이 결과와 같다", async () => {
    await renderScreen(name);
    const sentences = [...harness.container.querySelectorAll("[data-collected-axis]")].map((node) => node.textContent);
    expect(sentences).toEqual(entries.map((entry) => collectedSentence(entry.axis, entry.letter, entry.band, entry.lowered === true)));
  });

  it("반반이에요 주제는 어느 쪽도 사실로 적지 않고 두 글자를 같은 무게로 적는다", async () => {
    await renderScreen(name);
    for (const axis of result.axes) {
      if (axis.letter === null || axis.shownBand !== "even") continue;
      const info = axisInfo(axis.axis);
      // 문항 문구(인용)는 다른 작업이 쓰는 글이라 빼고, 화면이 만드는 문장만 본다.
      const block = textWithoutQuotes(axisBlock(axis.axis));
      const screen = textWithoutQuotes(harness.container);
      // 두 글자 어느 쪽으로 답했다는 문장도, 뚜렷하게 모였다는 문장도, 반대쪽이라는 말도 없다
      for (const letter of [info.front, info.back]) {
        expect(screen).not.toContain(letterInfo(letter).answerSentence);
        expect(block).not.toContain(oppositeMeaningLine(letter));
      }
      expect(block).not.toContain(V40_SUFFIX.answered.trim());
      expect(block).not.toContain(V40_STRENGTH.clear.sentence);
      expect(block).not.toContain(V40_STRENGTH.lean.sentence);
      expect(block).not.toContain("반대쪽");
      // 대신 두 글자의 뜻, 세기 문장, 두 방향의 답 제목이 모두 있다
      const lowered = isLoweredToEven(axis);
      if (lowered) {
        // 힌트가 기울어요를 반반이에요로 낮춘 주제: 낮추기 전에 한쪽으로 기울어 있었으므로 「크게 기울지 않았어요」라고 하지 않고 세기를 낮췄다고 말한다.
        expect(block).toContain(loweredStrengthSentence(axis.letter));
        expect(block).not.toContain(evenStrengthSentence(axis.axis, axis.letter));
        expect(screen).not.toContain(info.evenSentence);
        expect(screen).toContain(collectedSentence(axis.axis, axis.letter, "even", true));
      } else {
        expect(block).toContain(evenStrengthSentence(axis.axis, axis.letter));
        expect(block).not.toContain(loweredStrengthSentence(axis.letter));
        // 이 주제의 「답을 모아 보니」 문장은 어느 쪽으로도 크게 기울지 않았다는 문장이다(비슷하게 나왔다고 하지 않는다)
        expect(screen).toContain(info.evenSentence);
      }
      expect(block).toContain(meaningLine(info.front));
      expect(block).toContain(meaningLine(info.back));
      expect(block).toContain(evenSideAnswersHeading(info.front));
      expect(block).toContain(evenSideAnswersHeading(info.back));
      expect(block).toContain(V40_COPY.block.evenAppearancesNote);
    }
  });

  it("뚜렷해요와 기울어요 주제는 글자 뜻과 반대쪽 뜻, 세기 문장, 내가 고른 답과 반대로 고른 답을 보인다", async () => {
    await renderScreen(name);
    result.axes.forEach((axis, index) => {
      if (axis.letter === null || axis.shownBand === null || axis.shownBand === "even") return;
      const block = axisBlock(axis.axis);
      const text = textOf(block);
      expect(text).toContain(meaningLine(axis.letter));
      const opposite = axis.side === "front" ? axisInfo(axis.axis).back : axisInfo(axis.axis).front;
      expect(text).toContain(oppositeMeaningLine(axis.letter));
      expect(text).toContain(`반대쪽 ${opposite}는`);
      expect(text).toContain(V40_STRENGTH[axis.shownBand].sentence);
      const group = quotes[index];
      expect(group.kind).toBe("settled");
      if (group.kind !== "settled") return;
      expect(group.own.length).toBeLessThanOrEqual(3);
      expect(group.opposite.length).toBeLessThanOrEqual(2);
      for (const item of [...group.own, ...group.opposite]) {
        const line = block.querySelector(`[data-quote-item="${item.itemId}"]`);
        expect(line?.textContent).toBe(item.label);
      }
      if (group.opposite.length === 0) expect(text).toContain(V40_COPY.block.noOppositeLine);
      if (group.own.length === 0) expect(text).toContain(V40_COPY.block.noAnswersLine);
    });
  });

  it("더 보기는 처음에 접혀 있고 열면 모습과 대화 제안이 보인다", async () => {
    await renderScreen(name);
    const target = result.axes.find((axis) => axis.letter !== null);
    if (!target) return;
    const block = axisBlock(target.axis);
    const toggle = buttonByText(block, V40_COPY.block.moreToggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const region = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(region?.hidden).toBe(true);
    await click(toggle);
    expect(buttonByText(block, V40_COPY.block.lessToggle).getAttribute("aria-expanded")).toBe("true");
    expect(region?.hidden).toBe(false);
    expect(textOf(region!)).toContain(V40_COPY.block.appearancesHeading);
    expect(textOf(region!)).toContain(V40_COPY.block.reviewAxisButton);
  });
});

describe("표본 swua-example: 문서 예시 그대로", () => {
  it("코드 SWUA, 네 문장, 표의 내 글자 표시", async () => {
    await renderScreen("swua-example");
    expect([...harness.container.querySelectorAll("[data-code-letter]")].map((node) => node.textContent).join("")).toBe("SWUA");
    expect([...harness.container.querySelectorAll("[data-collected-axis]")].map((node) => node.textContent)).toEqual([
      "돈은 남을 장면부터 그려 보는 쪽으로 답했어요.",
      "준비는 같이 하는 쪽으로 답했어요.",
      "정할 때는 둘이 먼저 정하는 쪽으로 답했어요.",
      "지친 날에는 마음과 할 일 어느 쪽으로도 크게 기울지 않았어요.",
    ]);
    const marks = [...harness.container.querySelectorAll("[data-legend-mark]")].map((node) => textOf(node));
    expect(marks).toEqual(["내 글자 S · 기울어요", "내 글자 W · 뚜렷해요", "내 글자 U · 기울어요", "내 글자 A · 반반이에요"]);
    const mine = [...harness.container.querySelectorAll("[data-mine]")].map((node) => node.getAttribute("data-legend-letter"));
    expect(mine).toEqual(["S", "W", "U", "A"]);
    // 반반이에요 주제 블록: 제목 줄과 세기 문장
    const support = textOf(axisBlock("support"));
    expect(support).toContain("A 할 일 먼저 · 반반이에요");
    expect(support).toContain(
      "「H 마음 먼저」와 「A 할 일 먼저」 중 어느 쪽으로도 크게 기울지 않았어요. 코드에는 한 글자만 적을 수 있어서 「A 할 일 먼저」를 적었어요.",
    );
  });
});

describe("임시 글자, 글자를 못 정한 주제", () => {
  it("임시 글자는 코드 줄과 표와 제목 줄과 품질 안내에 임시로 적힌다", async () => {
    await renderScreen("provisional-tie");
    const { result } = resultCase("provisional-tie");
    const axis = result.axes.find((each) => each.provisional)!;
    expect(textOf(harness.container.querySelector(`[data-code-axis="${axis.axis}"]`)!)).toContain(V40_COPY.result.provisionalMark);
    expect(textOf(harness.container.querySelector(`[data-legend-row="${axis.axis}"] [data-legend-mark]`)!)).toContain("임시");
    expect(textOf(axisBlock(axis.axis))).toContain(`${V40_COPY.block.provisionalBadge}`);
    expect(textOf(harness.container.querySelector('[data-result-section="quality"]')!)).toContain(V40_COPY.quality.provisional);
  });

  it("글자를 못 정한 주제는 가운뎃점과 이유 문장, 다시 보기를 접지 않고 보이며 표에서 강조하지 않는다", async () => {
    const props = await renderScreen("unusable-axis");
    const { result } = resultCase("unusable-axis");
    expect(result.code).toBe("SW·A");
    expect([...harness.container.querySelectorAll("[data-code-letter]")].map((node) => node.textContent).join("")).toBe("SW·A");
    const block = axisBlock("scope");
    expect(block.getAttribute("data-band")).toBe("none");
    expect(textOf(block)).toContain(V40_COPY.block.unusableNote);
    expect(block.querySelector("[data-fold]")).toBeNull();
    expect(textOf(harness.container.querySelector('[data-collected-axis="scope"]')!)).toBe(V40_COPY.collected.sentences.scope.unusable);
    expect(harness.container.querySelector('[data-legend-row="scope"] [data-mine]')).toBeNull();
    expect(textOf(harness.container.querySelector('[data-legend-row="scope"] [data-legend-mark]')!)).toBe(V40_COPY.legend.notSetLabel);
    expect(textOf(harness.container.querySelector('[data-result-section="quality"]')!)).toContain(V40_COPY.quality.unusableAxis);
    await click(buttonByText(block, V40_COPY.block.reviewAxisButton));
    expect(props.onReviewAxis).toHaveBeenCalledWith("scope");
  });
});

describe("힌트와 넘어간 질문", () => {
  it("위치 반복 힌트는 코드 줄 앞에 정확히 한 번 나온다", async () => {
    await renderScreen("rhythm-hint");
    const text = textOf(harness.container);
    expect(countOf(text, V40_COPY.quality.rhythmHint)).toBe(1);
    expect(countOf(text, V40_COPY.quality.skipHint)).toBe(0);
    const hint = harness.container.querySelector('[data-result-section="quality-hint"]')!;
    const code = harness.container.querySelector('[data-result-section="code"]')!;
    expect(hint.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 고지 문장은 그 위에 있다
    const notice = harness.container.querySelector("[data-result-notice]")!;
    expect(notice.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("건너뜀 힌트는 한 번, 넘어간 질문 한 줄은 아래 목록에 있다", async () => {
    await renderScreen("skip-hint");
    const text = textOf(harness.container);
    expect(countOf(text, V40_COPY.quality.skipHint)).toBe(1);
    expect(countOf(text, V40_COPY.quality.rhythmHint)).toBe(0);
    const list = harness.container.querySelector('[data-result-section="quality"]')!;
    expect(textOf(list)).toContain(V40_COPY.quality.omitted);
    expect(textOf(list)).not.toContain(V40_COPY.quality.skipHint);
  });

  it("힌트가 없는 결과에는 위쪽 안내 줄이 없다", async () => {
    await renderScreen("swua-example");
    expect(harness.container.querySelector('[data-result-section="quality-hint"]')).toBeNull();
    expect(harness.container.querySelector('[data-result-section="quality"]')).toBeNull();
  });

  it("넘어간 질문 다시 보기는 부모가 줄 때만 단추로 나온다", async () => {
    await renderScreen("unusable-axis");
    expect(hasButton(harness.container, V40_COPY.quality.reviewSkippedButton)).toBe(false);
    await harness.unmount();
    harness = createHarness();
    const onReviewSkipped = vi.fn();
    await renderScreen("unusable-axis", { onReviewSkipped });
    await click(buttonByText(harness.container, V40_COPY.quality.reviewSkippedButton));
    expect(onReviewSkipped).toHaveBeenCalledTimes(1);
  });
});

describe("직접 고른 쪽 대비", () => {
  it("대비가 있는 주제만 문장으로 적고 없으면 구역이 없다", async () => {
    await renderScreen("self-contrast");
    const { result } = resultCase("self-contrast");
    const contrasts = result.axes.flatMap((axis) => (axis.contrast ? [axis.contrast] : []));
    expect(contrasts.length).toBeGreaterThan(0);
    const section = harness.container.querySelector('[data-result-section="contrast"]')!;
    expect(section.querySelector("h2")?.textContent).toBe(V40_COPY.block.selfChoiceHeading);
    for (const contrast of contrasts) {
      expect(textOf(section)).toContain(selfContrastSentence(contrast));
    }
    expect(section.querySelectorAll("li")).toHaveLength(contrasts.length);
    await harness.unmount();
    harness = createHarness();
    await renderScreen("swua-example");
    expect(harness.container.querySelector('[data-result-section="contrast"]')).toBeNull();
  });
});

describe("지난번과 비교", () => {
  it("기록이 없으면 구역이 없다", async () => {
    await renderScreen("swua-example");
    expect(harness.container.querySelector('[data-result-section="history"]')).toBeNull();
  });

  it("기록이 있으면 글자와 세기만 나란히 적는다", async () => {
    const previous = historyOf(resultCase("all-clear").result, SEPT_29_NOON_KST);
    await renderScreen("swua-example", { previous });
    const section = harness.container.querySelector('[data-result-section="history"]')!;
    expect(section.querySelector("h2")?.textContent).toBe(V40_COPY.history.title);
    expect(textOf(section)).toContain("지난번(9월 29일)과 달라진 글자가 있어요.");
    expect(section.querySelectorAll("[data-history-row]")).toHaveLength(4);
  });
});

describe("관문으로 코드가 없는 결과", () => {
  it("코드 줄, 표, 링크 보내기, 코드 복사가 없고 제목과 고지 한 번, 관문 안내, 다시 하기만 있다", async () => {
    const sendSlot = <p data-testid="send">보내기</p>;
    await renderScreen("rhythm-gate", { sendSlot });
    const { result } = resultCase("rhythm-gate");
    expect(result.code).toBeNull();
    expect(harness.container.querySelector('[data-result-section="code"]')).toBeNull();
    expect(harness.container.querySelector('[data-result-section="legend"]')).toBeNull();
    expect(harness.container.querySelector('[data-result-section="send"]')).toBeNull();
    expect(harness.container.querySelector('[data-result-section="taste"]')).toBeNull();
    expect(hasButton(harness.container, V40_COPY.copyCode.button)).toBe(false);
    const gate = harness.container.querySelector('[data-result-section="gate"]')!;
    expect(textOf(gate)).toContain(V40_COPY.gate.title);
    expect(textOf(gate)).toContain(V40_COPY.gate.rhythmBody);
    expect(textOf(gate)).toContain(V40_COPY.gate.noLinkNote);
    expect(countOf(textOf(harness.container), V40_NOT_VALIDATED_PHRASE)).toBe(1);
    expect(hasButton(harness.container, V40_COPY.manage.restart.button)).toBe(true);
    // 글자 없는 화면에는 글자 여덟 개 뜻이 나오지 않는다
    // 글자가 없는 화면에는 글자도 없다(코드 줄과 표가 없다)
    expect(standaloneCapitals(harness.container)).toEqual([]);
  });
});

describe("코드 복사", () => {
  it("코드 복사 단추는 글자와 뜻과 세기만 담은 글을 부모에게 넘긴다", async () => {
    const props = await renderScreen("swua-example");
    await click(buttonByText(harness.container, V40_COPY.copyCode.button));
    await settle();
    const expected = codeCopyText(codeLineEntries(props.result));
    expect(props.onCopyCode).toHaveBeenCalledTimes(1);
    expect(props.onCopyCode).toHaveBeenCalledWith(expected);
    expect(expected).toBe(
      "웨딩코드 SWUA (S 장면 먼저 · 기울어요, W 같이 하기 · 뚜렷해요, U 둘이 정하기 · 기울어요, A 할 일 먼저 · 반반이에요)",
    );
    expect(harness.container.querySelector("[data-copy-status]")?.textContent).toBe(V40_COPY.copyCode.copied);
  });

  it("부모가 false 를 돌려주면 복사했다고 말하지 않고 직접 복사할 글을 보인다", async () => {
    const props = screenProps("swua-example");
    props.onCopyCode.mockResolvedValue(false);
    await harness.render(<ResultScreen {...props} />);
    await click(buttonByText(harness.container, V40_COPY.copyCode.button));
    await settle();
    const text = textOf(harness.container);
    expect(text).not.toContain(V40_COPY.copyCode.copied);
    expect(text).toContain(V40_COPY.copyCode.failed);
    expect((harness.container.querySelector("textarea") as HTMLTextAreaElement).value).toBe(props.onCopyCode.mock.calls[0][0]);
  });

  it("부모가 던져도 복사했다고 말하지 않는다", async () => {
    const props = screenProps("swua-example");
    props.onCopyCode.mockRejectedValue(new Error("clipboard"));
    await harness.render(<ResultScreen {...props} />);
    await click(buttonByText(harness.container, V40_COPY.copyCode.button));
    await settle();
    expect(textOf(harness.container)).not.toContain(V40_COPY.copyCode.copied);
    expect(textOf(harness.container)).toContain(V40_COPY.copyCode.failed);
  });
});

describe("상대에게 보내기 자리, 취향 카드, 다시 하기", () => {
  it("보내기 자리는 지난번 비교 뒤, 취향 카드 앞에 그대로 놓인다", async () => {
    await renderScreen("swua-example", { sendSlot: <p data-probe="send">보내기 블록</p> });
    const send = harness.container.querySelector('[data-result-section="send"]')!;
    expect(send.querySelector('[data-probe="send"]')?.textContent).toBe("보내기 블록");
    const taste = harness.container.querySelector('[data-result-section="taste"]')!;
    expect(send.compareDocumentPosition(taste) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("보내기 자리를 주지 않으면 그리지 않는다", async () => {
    await renderScreen("swua-example");
    expect(harness.container.querySelector('[data-result-section="send"]')).toBeNull();
  });

  it("취향 카드 단추는 부모에게 알린다", async () => {
    const props = await renderScreen("swua-example");
    expect(textOf(harness.container.querySelector('[data-result-section="taste"]')!)).toContain(V40_COPY.taste.title);
    await click(buttonByText(harness.container, V40_COPY.taste.button));
    expect(props.onOpenTaste).toHaveBeenCalledTimes(1);
  });

  it("처음부터 다시 하기는 확인을 거친 뒤에만 부모를 부른다", async () => {
    const props = await renderScreen("swua-example");
    await click(buttonByText(harness.container, V40_COPY.manage.restart.button));
    expect(props.onRestart).not.toHaveBeenCalled();
    const dialog = document.body.querySelector('[role="alertdialog"]')!;
    expect(textOf(dialog)).toContain(V40_COPY.manage.restart.confirmBody);
    await click(buttonByText(dialog, V40_COPY.manage.restart.confirmButton));
    expect(props.onRestart).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
  });
});

describe("라운지 안(embedded)", () => {
  it("끝에 하단 탭 막대 여백을 두고 제목은 2단계다", async () => {
    await renderScreen("swua-example", { embedded: true });
    const root = harness.container.querySelector<HTMLElement>("[data-wedding-code-result]")!;
    expect(root.dataset.embedded).toBe("true");
    expect(root.className).toContain("pb-[calc(6rem+env(safe-area-inset-bottom))]");
    expect(harness.container.querySelector("h1")).toBeNull();
    expect(harness.container.querySelector("header h2")?.textContent).toBe(V40_COPY.result.title);
  });

  it("라운지 밖에서는 제목이 1단계이고 표시가 없다", async () => {
    await renderScreen("swua-example");
    const root = harness.container.querySelector<HTMLElement>("[data-wedding-code-result]")!;
    expect(root.dataset.embedded).toBeUndefined();
    expect(harness.container.querySelector("header h1")?.textContent).toBe(V40_COPY.result.title);
  });
});
