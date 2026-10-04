import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { V40_COPY, codeLineAccessibleName, type CodeLineEntry } from "@/lib/weddingCode/v40/copy";
import { CodeLine, codeLineEntries, isLoweredToEven } from "./CodeLine";
import { createHarness, type Harness } from "./inputTestKit";
import { resultCase, textOf } from "./resultTestKit";

let harness: Harness;
beforeEach(() => {
  harness = createHarness();
});
afterEach(async () => {
  await harness.unmount();
});

const SWUA: readonly CodeLineEntry[] = [
  { axis: "money", letter: "S", band: "lean", provisional: false },
  { axis: "process", letter: "W", band: "clear", provisional: false },
  { axis: "scope", letter: "U", band: "lean", provisional: false },
  { axis: "support", letter: "A", band: "even", provisional: false },
];

function cellOf(axis: string): HTMLElement {
  const cell = harness.container.querySelector<HTMLElement>(`[data-code-axis="${axis}"]`);
  if (!cell) throw new Error(`코드 줄 칸이 없어요: ${axis}`);
  return cell;
}

describe("CodeLine", () => {
  it("큰 글자 네 개를 주제 순서로, 각 글자 위에 작은 주제 이름을 놓는다", async () => {
    await harness.render(<CodeLine entries={SWUA} />);
    const cells = [...harness.container.querySelectorAll("[data-code-axis]")];
    expect(cells.map((cell) => cell.getAttribute("data-code-axis"))).toEqual(["money", "process", "scope", "support"]);
    expect(cells.map((cell) => cell.querySelector("[data-code-letter]")?.textContent)).toEqual(["S", "W", "U", "A"]);
    expect(cells.map((cell) => cell.firstElementChild?.textContent)).toEqual(["돈", "준비", "함께 정할 때", "지쳤을 때"]);
    // 주제 이름이 글자보다 앞(위)에 있다
    for (const cell of cells) {
      const topic = cell.firstElementChild!;
      const letter = cell.querySelector("[data-code-letter]")!;
      expect(topic.compareDocumentPosition(letter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("반반이에요 글자에만 글자 아래 「반반」 표시가 붙고 안내 한 줄이 있다", async () => {
    await harness.render(<CodeLine entries={SWUA} />);
    expect(textOf(cellOf("support"))).toContain(V40_COPY.result.evenMark);
    for (const axis of ["money", "process", "scope"]) expect(textOf(cellOf(axis))).not.toContain(V40_COPY.result.evenMark);
    expect(textOf(harness.container)).toContain(V40_COPY.result.evenCodeNote);
    // 표시는 글자 아래에 있다
    const support = cellOf("support");
    const mark = [...support.querySelectorAll("span")].find((node) => node.textContent === V40_COPY.result.evenMark)!;
    expect(support.querySelector("[data-code-letter]")!.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("각 글자 바로 아래에 그 글자의 이름이 있어서 표를 내려가 보지 않아도 무슨 글자인지 안다", async () => {
    await harness.render(<CodeLine entries={SWUA} />);
    const names = [...harness.container.querySelectorAll("[data-code-axis]")].map(
      (cell) => cell.querySelector("[data-code-letter-name]")?.textContent,
    );
    expect(names).toEqual(["장면 먼저", "같이 하기", "둘이 정하기", "할 일 먼저"]);
    for (const cell of harness.container.querySelectorAll("[data-code-axis]")) {
      const letter = cell.querySelector("[data-code-letter]")!;
      const name = cell.querySelector("[data-code-letter-name]")!;
      expect(letter.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // 이름은 글자 이름표(낭독) 안에 이미 있어서 낭독기에는 코드 줄 이름표 하나만 읽힌다
      expect(cell.closest('[role="img"]')).not.toBeNull();
    }
    // 이름은 글자 하나에 뜻 하나만: 코드 줄에 나온 이름은 글자 읽는 법 표의 이름과 같다
    expect(names.every((name) => name !== undefined && name !== "")).toBe(true);
  });

  it("글자를 못 정한 주제는 이름 칸이 비어 있고 정하지 못했다는 말만 있다", async () => {
    const unset = SWUA.map((entry): CodeLineEntry => (entry.axis === "scope" ? { axis: "scope", letter: null, band: null, provisional: false } : entry));
    await harness.render(<CodeLine entries={unset} />);
    expect(cellOf("scope").querySelector("[data-code-letter-name]")?.textContent).toBe("");
  });

  it("힌트가 세기를 낮춰서 된 반반이 있으면 「크게 기울지 않았다」만 말하는 안내 대신 낮춘 경우도 말하는 안내를 쓴다", async () => {
    const lowered = SWUA.map((entry): CodeLineEntry => (entry.axis === "support" ? { ...entry, lowered: true } : entry));
    await harness.render(<CodeLine entries={lowered} />);
    expect(textOf(harness.container)).toContain(V40_COPY.result.evenCodeNoteLowered);
    expect(textOf(harness.container)).not.toContain(V40_COPY.result.evenCodeNote);
    // 낮춘 게 없는 진짜 반반이면 원래 안내다
    await harness.render(<CodeLine key="plain" entries={SWUA} />);
    expect(textOf(harness.container)).toContain(V40_COPY.result.evenCodeNote);
    expect(textOf(harness.container)).not.toContain(V40_COPY.result.evenCodeNoteLowered);
  });

  it("반반이에요 글자가 없으면 표시도 안내도 없다", async () => {
    const clear = SWUA.map((entry): CodeLineEntry => ({ ...entry, band: "clear" }));
    await harness.render(<CodeLine entries={clear} />);
    expect(textOf(harness.container)).not.toContain(V40_COPY.result.evenMark);
    expect(textOf(harness.container)).not.toContain(V40_COPY.result.evenCodeNote);
  });

  it("코드 줄 전체에 낭독용 이름표가 하나 있고 안쪽은 낭독기에서 뺀다", async () => {
    await harness.render(<CodeLine entries={SWUA} />);
    const line = harness.container.querySelector('[role="img"]')!;
    expect(harness.container.querySelectorAll('[role="img"]')).toHaveLength(1);
    expect(line.getAttribute("aria-label")).toBe(codeLineAccessibleName(SWUA));
    expect(line.getAttribute("aria-label")).toContain("A 할 일 먼저, 반반이에요");
  });

  it("임시 글자는 반반과 임시 표시를 함께 달고 이름표에도 임시라고 한다", async () => {
    const provisional = SWUA.map((entry): CodeLineEntry => (entry.axis === "support" ? { ...entry, provisional: true } : entry));
    await harness.render(<CodeLine entries={provisional} />);
    const text = textOf(cellOf("support"));
    expect(text).toContain(V40_COPY.result.evenMark);
    expect(text).toContain(V40_COPY.result.provisionalMark);
    expect(harness.container.querySelector('[role="img"]')!.getAttribute("aria-label")).toContain("임시 글자예요");
  });

  it("글자를 못 정한 주제는 가운뎃점과 그 사실을 적고 다른 표시는 붙이지 않는다", async () => {
    const unset = SWUA.map((entry): CodeLineEntry => (entry.axis === "scope" ? { axis: "scope", letter: null, band: null, provisional: false } : entry));
    await harness.render(<CodeLine entries={unset} />);
    const cell = cellOf("scope");
    expect(cell.querySelector("[data-code-letter]")?.textContent).toBe("·");
    expect(textOf(cell)).toContain(V40_COPY.result.unsetLetterLabel);
    expect(textOf(cell)).not.toContain(V40_COPY.result.evenMark);
    expect(harness.container.querySelector('[role="img"]')!.getAttribute("aria-label")).toContain("정하지 못했어요");
  });

  it("codeLineEntries 는 힌트를 반영한 세기를 쓴다", () => {
    const { result } = resultCase("rhythm-hint");
    expect(result.notes.demoted).toBe(true);
    const entries = codeLineEntries(result);
    result.axes.forEach((axis, index) => {
      expect(entries[index].letter).toBe(axis.letter);
      expect(entries[index].band).toBe(axis.shownBand);
    });
    // 낮추기 전 세기와 달라진 주제가 실제로 있다(표본이 힌트를 보여 준다)
    expect(result.axes.some((axis) => axis.band !== axis.shownBand)).toBe(true);
  });

  it("codeLineEntries 는 힌트가 기울어요를 반반이에요로 낮춘 주제에만 lowered 를 붙인다", () => {
    for (const name of ["rhythm-hint", "skip-hint", "swua-example"]) {
      const { result } = resultCase(name);
      const entries = codeLineEntries(result);
      result.axes.forEach((axis, index) => {
        const expected = axis.letter !== null && axis.band === "lean" && axis.shownBand === "even";
        expect(isLoweredToEven(axis), `${name} ${axis.axis}`).toBe(expected);
        expect(entries[index].lowered, `${name} ${axis.axis}`).toBe(expected ? true : undefined);
        // 낮춘 주제만 lowered 이고 그때 세기는 반반이에요다
        if (entries[index].lowered) expect(entries[index].band).toBe("even");
      });
    }
    // 힌트가 걸린 표본에는 낮춘 주제가 실제로 있다
    expect(codeLineEntries(resultCase("rhythm-hint").result).some((entry) => entry.lowered === true)).toBe(true);
  });

  it("codeLineEntries 는 글자를 못 정한 주제를 null 로 둔다", () => {
    const entries = codeLineEntries(resultCase("unusable-axis").result);
    expect(entries[2]).toEqual({ axis: "scope", letter: null, band: null, provisional: false });
  });
});
