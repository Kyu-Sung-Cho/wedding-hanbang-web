import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { V40_COPY, historyCell } from "@/lib/weddingCode/v40/copy";
import type { HistoryAxis, HistoryEntry, V40Result } from "@/lib/weddingCode/v40/types";
import { createHarness, type Harness } from "./inputTestKit";
import { LastTimeCompare } from "./LastTimeCompare";
import { SEPT_29_NOON_KST, historyOf, resultCase, textOf } from "./resultTestKit";

let harness: Harness;
beforeEach(() => {
  harness = createHarness();
});
afterEach(async () => {
  await harness.unmount();
});

function entryWith(axes: readonly HistoryAxis[], at: number = SEPT_29_NOON_KST): HistoryEntry {
  return { at, formBit: 0, axes: axes as unknown as HistoryEntry["axes"] };
}

function axisOf(letter: HistoryAxis["letter"], band: HistoryAxis["band"], provisional = false): HistoryAxis {
  return { letter, band, provisional };
}

/** swua-example: 돈 S 기울어요, 준비 W 뚜렷해요, 정하는 사람 U 기울어요, 지쳤을 때 A 반반이에요. */
function swua(): V40Result {
  return resultCase("swua-example").result;
}

function row(axis: string): HTMLElement {
  return harness.container.querySelector<HTMLElement>(`[data-history-row="${axis}"]`)!;
}

describe("LastTimeCompare", () => {
  it("기록이 없으면 아무것도 그리지 않는다", async () => {
    await harness.render(<LastTimeCompare result={swua()} previous={null} />);
    expect(harness.container.innerHTML).toBe("");
    await harness.render(<LastTimeCompare result={swua()} previous={undefined} />);
    expect(harness.container.innerHTML).toBe("");
  });

  it("주제마다 지난번과 이번의 글자와 세기만 나란히 적는다", async () => {
    const previous = entryWith([axisOf("S", "lean"), axisOf("W", "clear"), axisOf("F", "lean"), axisOf("H", "lean")]);
    await harness.render(<LastTimeCompare result={swua()} previous={previous} />);
    const section = harness.container.querySelector("section")!;
    expect(section.querySelector("h2")?.textContent).toBe(V40_COPY.history.title);
    expect([...section.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual([
      V40_COPY.history.topicColumn,
      V40_COPY.history.previousColumn,
      V40_COPY.history.currentColumn,
    ]);
    const cells = (axis: string) => [...row(axis).querySelectorAll("th, td")].map((cell) => cell.firstChild?.textContent ?? "");
    expect(cells("money")).toEqual(["돈을 정할 때", historyCell("S", "lean", false), historyCell("S", "lean", false)]);
    // 글자에는 늘 이름이 붙는다(글자만 적으면 뜻을 알 수 없다).
    expect(cells("process")[1]).toBe("W 같이 하기 · 뚜렷해요");
    expect(cells("support")[1]).toBe("H 마음 먼저 · 기울어요");
    expect(cells("support")[2]).toBe("A 할 일 먼저 · 반반이에요");
    // 답은 비교하지 않는다
    expect(harness.container.querySelector("[data-quote-item]")).toBeNull();
  });

  it("두 번 모두 기울어요 이상인데 글자가 다르면 다르게 나왔어요를 붙이고 다르게 나온 글자를 한 줄씩 적는다", async () => {
    const previous = entryWith([axisOf("V", "lean"), axisOf("W", "clear"), axisOf("F", "clear"), axisOf("H", "lean")]);
    await harness.render(<LastTimeCompare result={swua()} previous={previous} />);
    expect(row("money").getAttribute("data-history-tag")).toBe("changed");
    expect(textOf(row("money"))).toContain(V40_COPY.history.changedTag);
    expect(row("scope").getAttribute("data-history-tag")).toBe("changed");
    const lines = [...harness.container.querySelectorAll("[data-history-changed]")].map((node) => node.textContent);
    expect(lines).toEqual([
      "돈을 정할 때는 지난번 「V 조건 먼저」, 이번 「S 장면 먼저」로 나왔어요.",
      "누구와 함께 정할 때는 지난번 「F 가족과 정하기」, 이번 「U 둘이 정하기」로 나왔어요.",
    ]);
    expect(textOf(harness.container)).toContain("지난번(9월 29일)과 다르게 나온 글자가 있어요.");
  });

  it("두 번 모두 기울어요 이상이고 글자가 같으면 같은 글자예요, 달라졌다고 하지 않는다", async () => {
    const previous = entryWith([axisOf("S", "clear"), axisOf("W", "lean"), axisOf("U", "clear"), axisOf("A", "even")]);
    await harness.render(<LastTimeCompare result={swua()} previous={previous} />);
    expect(row("money").getAttribute("data-history-tag")).toBe("same");
    expect(textOf(row("money"))).toContain(V40_COPY.history.sameTag);
    expect(harness.container.querySelector("[data-history-changed]")).toBeNull();
    expect(textOf(harness.container)).toContain("두 번 모두 뚜렷해요나 기울어요로 나온 주제 가운데 글자가 달라진 곳은 없어요.");
    expect(textOf(harness.container)).not.toContain("글자가 같아요");
  });

  it("반반이에요가 낀 주제는 글자가 달라도 달라졌다고 하지 않고 바뀌기 쉬운 주제라고만 적는다", async () => {
    const previous = entryWith([axisOf("S", "lean"), axisOf("W", "clear"), axisOf("U", "lean"), axisOf("H", "even")]);
    await harness.render(<LastTimeCompare result={swua()} previous={previous} />);
    const support = row("support");
    expect(support.getAttribute("data-history-tag")).toBe("unstable");
    expect(textOf(support)).toContain(V40_COPY.history.unstableTag);
    expect(textOf(support)).not.toContain(V40_COPY.history.changedTag);
    expect(textOf(harness.container)).toContain(V40_COPY.history.unstableNote);
    expect(harness.container.querySelector("[data-history-changed]")).toBeNull();
    // 이번이 반반이에요이고 지난번이 기울어요여도 마찬가지
    await harness.render(<LastTimeCompare key="reverse" result={swua()} previous={entryWith([axisOf("S", "lean"), axisOf("W", "clear"), axisOf("U", "lean"), axisOf("H", "lean")])} />);
    expect(row("support").getAttribute("data-history-tag")).toBe("unstable");
  });

  it("글자를 못 정했거나 임시 글자였던 주제는 비교에서 뺐다고 적는다", async () => {
    const previous = entryWith([axisOf(null, null), axisOf("W", "clear"), axisOf("U", "lean"), axisOf("H", "even", true)]);
    await harness.render(<LastTimeCompare result={swua()} previous={previous} />);
    expect(row("money").getAttribute("data-history-tag")).toBe("excluded");
    expect(textOf(row("money"))).toContain(V40_COPY.history.excludedTag);
    expect(textOf(row("money"))).toContain(V40_COPY.legend.notSetLabel);
    expect(row("support").getAttribute("data-history-tag")).toBe("excluded");
    expect(textOf(row("support"))).toContain("H 마음 먼저 · 반반이에요 · 임시");
    expect(textOf(harness.container)).toContain(V40_COPY.history.excludedNote);
    expect(textOf(harness.container)).not.toContain(V40_COPY.history.unstableNote);
  });

  it("이번 결과에서 글자를 못 정한 주제도 비교에서 뺀다", async () => {
    const previous = historyOf(resultCase("all-clear").result, SEPT_29_NOON_KST);
    await harness.render(<LastTimeCompare result={resultCase("unusable-axis").result} previous={previous} />);
    expect(row("scope").getAttribute("data-history-tag")).toBe("excluded");
    expect(textOf(row("scope"))).toContain(V40_COPY.legend.notSetLabel);
  });

  it("이번 글자가 임시 글자인 주제도 비교에서 뺀다", async () => {
    const { result } = resultCase("provisional-tie");
    const provisionalAxes = result.axes.filter((axis) => axis.provisional);
    // 표본이 바뀌어 임시 글자가 하나도 없어지면 이 검사가 빈 껍데기가 된다.
    expect(provisionalAxes.length).toBeGreaterThan(0);
    const previous = historyOf(resultCase("all-clear").result, SEPT_29_NOON_KST);
    await harness.render(<LastTimeCompare result={result} previous={previous} />);
    for (const axis of provisionalAxes) {
      expect(row(axis.axis).getAttribute("data-history-tag")).toBe("excluded");
      expect(textOf(row(axis.axis))).toContain(V40_COPY.history.excludedTag);
    }
    expect(textOf(harness.container)).toContain(V40_COPY.history.excludedNote);
  });

  it("뺀 주제도 바뀌기 쉬운 주제도 없으면 그 두 안내 글은 나오지 않는다", async () => {
    const { result } = resultCase("all-clear");
    await harness.render(<LastTimeCompare result={result} previous={historyOf(result, SEPT_29_NOON_KST)} />);
    expect([...harness.container.querySelectorAll("[data-history-row]")].map((node) => node.getAttribute("data-history-tag"))).toEqual([
      "same",
      "same",
      "same",
      "same",
    ]);
    expect(textOf(harness.container)).not.toContain(V40_COPY.history.excludedNote);
    expect(textOf(harness.container)).not.toContain(V40_COPY.history.unstableNote);
  });

  it("이번 세기는 힌트로 낮춘 세기를 쓴다", async () => {
    const { result } = resultCase("rhythm-hint");
    const previous = historyOf(resultCase("all-clear").result, SEPT_29_NOON_KST);
    await harness.render(<LastTimeCompare result={result} previous={previous} />);
    result.axes.forEach((axis) => {
      const cells = row(axis.axis).querySelectorAll("td");
      expect(cells[1].firstChild?.textContent).toBe(historyCell(axis.letter, axis.shownBand, axis.provisional));
    });
  });

  it("날짜는 한국 시간 기준이다", async () => {
    const utcLate = Date.UTC(2026, 8, 29, 16, 0, 0);
    const previous = historyOf(swua(), utcLate);
    await harness.render(<LastTimeCompare result={swua()} previous={previous} />);
    expect(textOf(harness.container)).toContain("지난번(9월 30일)");
  });

  it("점수, 순위, 퍼센트, 막대 같은 말과 숫자 세기가 없다", async () => {
    const previous = historyOf(resultCase("all-clear").result, SEPT_29_NOON_KST);
    await harness.render(<LastTimeCompare result={swua()} previous={previous} />);
    expect(textOf(harness.container)).not.toMatch(/%|퍼센트|점수|순위|등급|\d+\s*\/\s*\d+/);
    expect(harness.container.querySelector("[role='progressbar'], meter, progress")).toBeNull();
  });
});
