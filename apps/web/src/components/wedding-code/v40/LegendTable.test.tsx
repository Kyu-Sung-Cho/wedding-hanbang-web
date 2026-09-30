import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { V40_LETTER_LIST, letterInfo, type Letter } from "@/constants/weddingCodeV40";
import { V40_COPY, myLetterCell, type CodeLineEntry } from "@/lib/weddingCode/v40/copy";
import { createHarness, type Harness } from "./inputTestKit";
import { LegendTable, legendMarksFromEntries, type LegendMark } from "./LegendTable";
import { ALLOWED_LETTERS, standaloneCapitals, textOf } from "./resultTestKit";

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
  { axis: "scope", letter: null, band: null, provisional: false },
  { axis: "support", letter: "A", band: "even", provisional: true },
];

function rowOf(axis: string): HTMLElement {
  const row = harness.container.querySelector<HTMLElement>(`[data-legend-row="${axis}"]`);
  if (!row) throw new Error(`표 줄이 없어요: ${axis}`);
  return row;
}

describe("LegendTable: 표시가 없는 표", () => {
  it("네 줄, 글자 여덟 개가 한 번씩, 글자마다 이름과 작은 영어 낱말", async () => {
    await harness.render(<LegendTable />);
    expect(harness.container.querySelectorAll("[data-legend-row]")).toHaveLength(4);
    const cells = [...harness.container.querySelectorAll<HTMLElement>("[data-legend-letter]")];
    expect(cells.map((cell) => cell.dataset.legendLetter)).toEqual([...V40_LETTER_LIST]);
    for (const cell of cells) {
      const info = letterInfo(cell.dataset.legendLetter as Letter);
      const text = textOf(cell);
      expect(text).toContain(`${info.letter} ${info.name}`);
      expect(text).toContain(info.english);
    }
    expect([...harness.container.querySelectorAll("[data-legend-row]")].map((row) => row.querySelector('[role="rowheader"]')?.textContent)).toEqual([
      "돈을 정할 때",
      "준비를 굴릴 때",
      "함께 정하는 사람",
      "지쳤을 때",
    ]);
  });

  it("표시 칸과 내 글자 표시가 없고 머리글은 셋이다", async () => {
    await harness.render(<LegendTable />);
    expect(harness.container.querySelector("[data-legend-mark]")).toBeNull();
    expect(harness.container.querySelector("[data-mine]")).toBeNull();
    expect([...harness.container.querySelectorAll('[role="columnheader"]')].map((node) => node.textContent)).toEqual([
      V40_COPY.legend.topicColumn,
      V40_COPY.legend.frontColumn,
      V40_COPY.legend.backColumn,
    ]);
    expect(harness.container.querySelector("[aria-describedby]")).toBeNull();
  });

  it("접히지 않는다: 열고 닫는 단추도 details 도 없다", async () => {
    await harness.render(<LegendTable />);
    expect(harness.container.querySelector("button, details, summary, [hidden]")).toBeNull();
  });
});

describe("LegendTable: 내 글자 표시", () => {
  it("내 글자를 색이 아니라 굵은 테두리와 「내 글자」 글로 표시하고 글자를 못 정한 줄은 강조하지 않는다", async () => {
    await harness.render(<LegendTable marks={legendMarksFromEntries(SWUA)} />);
    const mine = [...harness.container.querySelectorAll("[data-mine]")].map((node) => node.getAttribute("data-legend-letter"));
    expect(mine).toEqual(["S", "W", "A"]);
    for (const node of harness.container.querySelectorAll("[data-mine]")) {
      expect(node.className).toContain("border-[var(--hb-selected-line)]!");
      expect(textOf(node)).toContain(V40_COPY.legend.mineColumn);
      expect(node.querySelector("svg")).not.toBeNull();
    }
    expect(rowOf("scope").querySelector("[data-mine]")).toBeNull();
  });

  it("표시 칸은 세기 낱말이고 임시 글자는 임시라고 적는다", async () => {
    await harness.render(<LegendTable marks={legendMarksFromEntries(SWUA)} />);
    const marks = [...harness.container.querySelectorAll("[data-legend-mark]")].map((node) => textOf(node));
    expect(marks).toEqual([
      myLetterCell("S", "lean"),
      myLetterCell("W", "clear"),
      V40_COPY.legend.notSetLabel,
      myLetterCell("A", "even", true),
    ]);
    // 어느 글자가 내 글자인지 테두리와 표식뿐 아니라 글로도 말한다.
    expect(marks[0]).toBe("내 글자 S · 기울어요");
    expect(marks[3]).toBe("내 글자 A · 반반이에요 · 임시");
  });

  it("표시가 있으면 머리글이 넷이고 표에 낭독용 설명이 붙는다", async () => {
    await harness.render(<LegendTable marks={legendMarksFromEntries(SWUA)} />);
    expect([...harness.container.querySelectorAll('[role="columnheader"]')].map((node) => node.textContent)).toEqual([
      V40_COPY.legend.topicColumn,
      V40_COPY.legend.frontColumn,
      V40_COPY.legend.backColumn,
      V40_COPY.legend.mineColumn,
    ]);
    const table = harness.container.querySelector('[role="table"]')!;
    const description = document.getElementById(table.getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toBe(V40_COPY.a11y.legendDescription);
    expect(document.getElementById(table.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(V40_COPY.legend.title);
  });

  it("두 사람 화면: 줄마다 표시 둘, 두 표시가 같은 글자를 가리키면 그 글자 한 칸만 강조한다", async () => {
    const marks: readonly (readonly LegendMark[])[] = [
      [
        { letter: "V", text: "나 · 조건 먼저" },
        { letter: "S", text: "상대 · 장면 먼저" },
      ],
      [
        { letter: "W", text: "나" },
        { letter: "W", text: "상대" },
      ],
      [],
      [{ letter: null, text: "먼저 답한 사람 · 정하지 못했어요" }],
    ];
    await harness.render(<LegendTable marks={marks} markColumnLabel="두 사람" showStrengthGuide={false} />);
    expect([...rowOf("money").querySelectorAll("[data-mine]")].map((node) => node.getAttribute("data-legend-letter"))).toEqual(["V", "S"]);
    expect([...rowOf("process").querySelectorAll("[data-mine]")].map((node) => node.getAttribute("data-legend-letter"))).toEqual(["W"]);
    expect(rowOf("money").querySelectorAll("[data-legend-mark] p")).toHaveLength(2);
    expect(rowOf("scope").querySelector("[data-mine]")).toBeNull();
    expect(harness.container.querySelectorAll('[role="columnheader"]')[3].textContent).toBe("두 사람");
  });

  it("legendMarksFromEntries: 글자를 못 정한 줄은 글자 없는 표시", () => {
    const marks = legendMarksFromEntries(SWUA);
    expect(marks).toHaveLength(4);
    expect(marks[2]).toEqual([{ letter: null, text: V40_COPY.legend.notSetLabel }]);
    expect(marks[0]).toEqual([{ letter: "S", text: "내 글자 S · 기울어요" }]);
  });
});

describe("LegendTable: 세기 읽는 법과 문구 규칙", () => {
  it("세기 낱말 셋을 풀어 쓴 줄이 있고 끌 수 있다", async () => {
    await harness.render(<LegendTable />);
    const lines = [...harness.container.querySelectorAll("[data-legend-strength] li")].map((node) => node.textContent);
    expect(lines).toEqual([V40_COPY.legend.strengthGuide.clear, V40_COPY.legend.strengthGuide.lean, V40_COPY.legend.strengthGuide.even]);
    await harness.render(<LegendTable showStrengthGuide={false} />);
    expect(harness.container.querySelector("[data-legend-strength]")).toBeNull();
  });

  it("글자는 V S W D U F H A 뿐이고 숫자 세기 표현이 없다", async () => {
    await harness.render(<LegendTable marks={legendMarksFromEntries(SWUA)} />);
    const text = textOf(harness.container);
    for (const letter of standaloneCapitals(harness.container)) expect(ALLOWED_LETTERS.has(letter)).toBe(true);
    expect(new Set(standaloneCapitals(harness.container))).toEqual(new Set(V40_LETTER_LIST));
    expect(text).not.toMatch(/\d|%|점수|퍼센트|등급/);
  });

  it("한 화면에 두 개를 놓아도 id 가 겹치지 않게 접두어를 받는다", async () => {
    await harness.render(
      <>
        <LegendTable idPrefix="one" marks={legendMarksFromEntries(SWUA)} />
        <LegendTable idPrefix="two" marks={legendMarksFromEntries(SWUA)} />
      </>,
    );
    const ids = [...harness.container.querySelectorAll("[id]")].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
