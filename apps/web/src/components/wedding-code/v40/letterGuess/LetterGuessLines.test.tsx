import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_AXIS_KEYS, axisInfo, letterInfo, type Letter } from "@/constants/weddingCodeV40";
import { V40_NOT_VALIDATED_PHRASE } from "@/lib/weddingCode/v40/copy";
import { summarizeLetterGuess } from "@/lib/weddingCode/v40/letterGuess/letterGuess";
import { V40_LETTER_GUESS_COPY, letterGuessLineText } from "@/lib/weddingCode/v40/letterGuess/letterGuessCopy";
import type { LetterGuess, LetterGuessLine, LetterGuessSummary } from "@/lib/weddingCode/v40/letterGuess/types";
import { createHarness, labelledByText, type Harness } from "../inputTestKit";
import { ALLOWED_LETTERS, resultCase, standaloneCapitals, textOf } from "../resultTestKit";
import { LetterGuessLines } from "./LetterGuessLines";

let harness: Harness;
beforeEach(() => {
  harness = createHarness();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await harness.unmount();
});

const LINE_MONEY: LetterGuessLine = { axis: "money", guessed: "S", shown: "V" };
const LINE_PROCESS: LetterGuessLine = { axis: "process", guessed: "W", shown: "D" };
const LINE_SUPPORT: LetterGuessLine = { axis: "support", guessed: "A", shown: "H" };

const LINES: LetterGuessSummary = { kind: "lines", lines: [LINE_MONEY, LINE_PROCESS, LINE_SUPPORT] };
const SAME: LetterGuessSummary = { kind: "same" };
const UNSETTLED: LetterGuessSummary = { kind: "unsettledOnly" };
const NONE: LetterGuessSummary = { kind: "none" };

async function mount(summary: LetterGuessSummary, headingLevel: 2 | 3 = 2, idPrefix?: string) {
  await harness.render(<LetterGuessLines summary={summary} headingLevel={headingLevel} idPrefix={idPrefix} />);
  return harness.container;
}

function sectionOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-letter-guess="lines"]');
}

describe("LetterGuessLines: 요약이 none 이면 구역 전체를 그리지 않는다", () => {
  it("none 은 아무것도 그리지 않는다(고르지 않았거나, 건너뛰었거나, 관문이 닫혔다)", async () => {
    for (const level of [2, 3] as const) {
      const container = await mount(NONE, level);
      expect(container.innerHTML).toBe("");
      expect(container.querySelector("h2, h3, section")).toBeNull();
    }
  });

  it("요약이 none 에서 다른 것으로 바뀌면 구역이 생기고 다시 none 이 되면 사라진다", async () => {
    await mount(NONE);
    expect(harness.container.innerHTML).toBe("");
    await harness.render(<LetterGuessLines summary={SAME} headingLevel={2} />);
    expect(sectionOf(harness.container)).not.toBeNull();
    await harness.render(<LetterGuessLines summary={NONE} headingLevel={2} />);
    expect(harness.container.innerHTML).toBe("");
  });
});

describe("LetterGuessLines: 줄(lines)", () => {
  it("제목 아래에 다른 주제의 줄만 주제 순서로, 줄마다 한 문장으로 나온다", async () => {
    const container = await mount(LINES);
    const section = sectionOf(container) as HTMLElement;
    expect(section.getAttribute("data-letter-guess-kind")).toBe("lines");
    const items = [...section.querySelectorAll("li")];
    expect(items.map((item) => item.textContent)).toStrictEqual([LINE_MONEY, LINE_PROCESS, LINE_SUPPORT].map(letterGuessLineText));
    expect(items.map((item) => item.getAttribute("data-letter-guess-axis"))).toStrictEqual(["money", "process", "support"]);
    expect(items[1].textContent).toBe("준비는 「W 같이 하기」를 먼저 골랐고, 답을 모아 보니 「D 나눠 하기」 쪽으로 답했어요.");
    // 같음 문장은 줄이 있을 때 나오지 않는다.
    expect(textOf(section)).not.toContain(V40_LETTER_GUESS_COPY.lines.same);
    expect(textOf(section)).not.toContain(V40_LETTER_GUESS_COPY.lines.unsettledOnly);
  });

  it("주어진 줄만 그린다(없는 주제의 줄을 만들지 않고 줄 하나도 그린다)", async () => {
    const container = await mount({ kind: "lines", lines: [LINE_PROCESS] });
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.querySelector("li")?.getAttribute("data-letter-guess-axis")).toBe("process");
  });

  it("실제 결과와 먼저 고른 글자에서 만든 요약을 그대로 그린다(돈과 준비는 다름, 지쳤을 때는 반반이라 줄이 없다)", async () => {
    const { result } = resultCase("swua-example");
    // 이 표본: S 기울어요, W 뚜렷해요, U 기울어요, A 반반이에요. 돈은 V, 준비는 D 를 골랐고 지쳤을 때는 H 를 골랐다.
    const picks: LetterGuess = ["V", "D", null, "H"];
    const summary = summarizeLetterGuess(result, picks);
    expect(summary.kind).toBe("lines");
    const container = await mount(summary);
    const items = [...container.querySelectorAll("li")].map((item) => item.textContent);
    expect(items).toStrictEqual([
      "돈은 「V 조건 먼저」를 먼저 골랐고, 답을 모아 보니 「S 장면 먼저」 쪽으로 답했어요.",
      "준비는 「D 나눠 하기」를 먼저 골랐고, 답을 모아 보니 「W 같이 하기」 쪽으로 답했어요.",
    ]);
  });
});

describe("LetterGuessLines: 같음(same)과 나란히 놓을 수 없음(unsettledOnly)", () => {
  it("same 은 한 문장만 그리고 주제별 줄을 만들지 않는다", async () => {
    const container = await mount(SAME);
    const section = sectionOf(container) as HTMLElement;
    expect(section.getAttribute("data-letter-guess-kind")).toBe("same");
    expect(section.querySelector("li, ul")).toBeNull();
    const sentence = section.querySelector("[data-letter-guess-sentence]");
    expect(sentence?.getAttribute("data-letter-guess-sentence")).toBe("same");
    expect(sentence?.textContent).toBe(V40_LETTER_GUESS_COPY.lines.same);
    // 글자 이름이나 글자 한 자가 하나도 나오지 않는다(맞혔다는 합격 표시로 읽히지 않게).
    expect(standaloneCapitals(section)).toStrictEqual([]);
  });

  it("unsettledOnly 는 글자를 정하지 못했거나 반반이라 나란히 놓지 않았다는 한 문장만 그린다", async () => {
    const container = await mount(UNSETTLED);
    const section = sectionOf(container) as HTMLElement;
    expect(section.getAttribute("data-letter-guess-kind")).toBe("unsettledOnly");
    expect(section.querySelector("li, ul")).toBeNull();
    const sentence = section.querySelector("[data-letter-guess-sentence]");
    expect(sentence?.getAttribute("data-letter-guess-sentence")).toBe("unsettledOnly");
    expect(sentence?.textContent).toBe(V40_LETTER_GUESS_COPY.lines.unsettledOnly);
    expect(section.textContent).not.toContain(V40_LETTER_GUESS_COPY.lines.same);
  });
});

describe("LetterGuessLines: 제목, 끝 줄, 접근성", () => {
  it("제목은 「먼저 고른 글자와 나란히」이고 수준은 headingLevel 을 따른다", async () => {
    const level2 = await mount(LINES, 2);
    expect(level2.querySelector("h2")?.textContent).toBe("먼저 고른 글자와 나란히");
    expect(level2.querySelector("h3")).toBeNull();
    await harness.unmount();
    harness = createHarness();
    const level3 = await mount(LINES, 3);
    expect(level3.querySelector("h3")?.textContent).toBe("먼저 고른 글자와 나란히");
    expect(level3.querySelector("h2")).toBeNull();
  });

  it("구역 이름이 제목이고 제목 id 는 접두어를 따른다(두 구역이 한 화면에 있어도 겹치지 않는다)", async () => {
    const container = await mount(LINES, 2, "left");
    const section = sectionOf(container) as HTMLElement;
    expect(section.getAttribute("aria-labelledby")).toBe("left-title");
    expect(labelledByText(section)).toBe("먼저 고른 글자와 나란히");
    await harness.render(
      <>
        <LetterGuessLines summary={LINES} headingLevel={2} idPrefix="left" />
        <LetterGuessLines summary={SAME} headingLevel={2} idPrefix="right" />
      </>,
    );
    const ids = [...harness.container.querySelectorAll("[id]")].map((element) => element.id);
    expect(ids).toStrictEqual(["left-title", "right-title"]);
  });

  it("세 요약 모두 끝에 「다른 날에는 다르게」 한계와 이야기해 봐도 좋다는 줄이 한 번 있다", async () => {
    for (const summary of [LINES, SAME, UNSETTLED]) {
      const container = await mount(summary);
      const closing = container.querySelectorAll("[data-letter-guess-closing]");
      expect(closing, summary.kind).toHaveLength(1);
      expect(closing[0].textContent).toBe(V40_LETTER_GUESS_COPY.lines.closing);
      expect(closing[0].textContent).toContain("다른 날에는 다르게");
      // 끝 줄이 구역의 마지막 요소다.
      const section = sectionOf(container) as HTMLElement;
      expect(section.lastElementChild).toBe(closing[0]);
      await harness.unmount();
      harness = createHarness();
    }
  });

  it("고지 문장이 없다(결과 화면의 고지가 이미 한 번 있다)", async () => {
    for (const summary of [LINES, SAME, UNSETTLED]) {
      const container = await mount(summary);
      expect(textOf(container)).not.toContain(V40_NOT_VALIDATED_PHRASE);
      await harness.unmount();
      harness = createHarness();
    }
  });
});

describe("LetterGuessLines: 말하지 않는 것", () => {
  it("개수, 점수, 비율, 맞혔다, 틀렸다, 까닭이 어느 요약에도 없고 글자는 여덟 글자뿐이다", async () => {
    const judging = /맞혔|맞았|틀렸|틀린|정답|오답|잘못|칭찬|축하|아쉽|놀랍|의외|제대로|점수|비율|퍼센트|\d|짐작/u;
    const causes = /때문|이유|원인|탓|그래서|따라서/u;
    for (const summary of [LINES, SAME, UNSETTLED]) {
      const container = await mount(summary);
      const text = textOf(container);
      expect(text, summary.kind).not.toMatch(judging);
      expect(text, summary.kind).not.toMatch(causes);
      for (const capital of standaloneCapitals(container)) expect(ALLOWED_LETTERS.has(capital), capital).toBe(true);
      await harness.unmount();
      harness = createHarness();
    }
  });

  it("줄 수를 말하지 않는다: 줄이 하나일 때와 셋일 때 구역의 글에 수를 나타내는 말이 없다", async () => {
    for (const lines of [[LINE_MONEY], [LINE_MONEY, LINE_PROCESS, LINE_SUPPORT]]) {
      const container = await mount({ kind: "lines", lines });
      const closing = container.querySelector("[data-letter-guess-closing]")?.textContent ?? "";
      const heading = container.querySelector("h2")?.textContent ?? "";
      expect(`${heading} ${closing}`).not.toMatch(/\d|몇|한 |두 |세 |네 |개|가지/u);
      await harness.unmount();
      harness = createHarness();
    }
  });

  it("글자 이름은 상수의 이름 그대로다(복사본이 없다): 모든 주제의 모든 방향의 줄이 상수와 같다", async () => {
    const lines: LetterGuessLine[] = [];
    for (const axis of V40_AXIS_KEYS) {
      const info = axisInfo(axis);
      lines.push({ axis, guessed: info.front, shown: info.back });
      lines.push({ axis, guessed: info.back, shown: info.front });
    }
    // 같은 주제가 두 번 나와도 그대로 그린다(요약이 주제당 하나만 만든다는 약속은 모델의 몫이다).
    const container = await mount({ kind: "lines", lines });
    const texts = [...container.querySelectorAll("li")].map((item) => item.textContent ?? "");
    expect(texts).toHaveLength(8);
    for (const [index, line] of lines.entries()) {
      expect(texts[index]).toContain(`「${line.guessed} ${letterInfo(line.guessed).name}」`);
      expect(texts[index]).toContain(`「${line.shown} ${letterInfo(line.shown).name}」`);
    }
    const letters = new Set<Letter>();
    for (const line of lines) {
      letters.add(line.guessed);
      letters.add(line.shown);
    }
    expect(letters.size).toBe(8);
  });

  it("저장소와 네트워크를 만지지 않는다", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await mount(LINES);
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
