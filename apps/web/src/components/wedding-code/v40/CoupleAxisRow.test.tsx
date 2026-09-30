import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axisInfo, oppositeLetter, type Axis, type Letter, type StrengthBand } from "@/constants/weddingCodeV40";
import { V40_COPY, coupleTagNote, letterBandCell } from "@/lib/weddingCode/v40/copy";
import type { CoupleAxisRow as CoupleAxisRowData, CoupleSideInfo, CoupleTag, Perspective } from "@/lib/weddingCode/v40/types";
import { CoupleAxisRow, peopleInOrder } from "./CoupleAxisRow";
import { createHarness, labelProblemsIn, type Harness } from "./inputTestKit";

let harness: Harness;
beforeEach(() => {
  harness = createHarness();
});
afterEach(async () => {
  await harness.unmount();
});

const side = (letter: Letter | null, shownBand: StrengthBand | null, provisional = false): CoupleSideInfo => ({ letter, shownBand, provisional });

function makeRow(axis: Axis, first: CoupleSideInfo, second: CoupleSideInfo, tag: CoupleTag, excluded = false): CoupleAxisRowData {
  return { axis, first, second, tag, excluded };
}

async function renderRow(row: CoupleAxisRowData, perspective: Perspective | null, showNote = true): Promise<HTMLElement> {
  await harness.render(
    <ul>
      <CoupleAxisRow row={row} perspective={perspective} showNote={showNote} idPrefix="t-row" />
    </ul>,
  );
  const item = harness.container.querySelector<HTMLElement>("li");
  if (!item) throw new Error("줄이 없어요");
  return item;
}

/** 줄의 사람 칸: [이름표, 글자 칸 글] 쌍. */
function cellsOf(item: HTMLElement): Array<[string, string]> {
  return [...item.querySelectorAll<HTMLElement>("div > div")].map((cell) => {
    const paragraphs = cell.querySelectorAll("p");
    return [paragraphs[0]?.textContent ?? "", paragraphs[1]?.textContent ?? ""] as [string, string];
  });
}

const chipTexts = (item: HTMLElement) => [...item.querySelectorAll("span")].map((span) => span.textContent).filter((t) => Object.values(V40_COPY.couple.tagLabels).includes(t as never));

describe("peopleInOrder", () => {
  it("내가 첫째면 첫째, 둘째면 둘째를 먼저 놓고, 모르면 먼저 답한 사람이 먼저다", () => {
    expect(peopleInOrder("first")).toEqual(["first", "second"]);
    expect(peopleInOrder("second")).toEqual(["second", "first"]);
    expect(peopleInOrder(null)).toEqual(["first", "second"]);
  });
});

describe("CoupleAxisRow: 태그 모양", () => {
  it("태그는 누를 수 있는 단추처럼 보이는 테두리 알약이 아니라 테두리 없는 색 바탕이다(누르면 아무 일도 없다)", async () => {
    const item = await renderRow(makeRow("process", side("W", "clear"), side("W", "lean"), "same"), null);
    const tag = item.querySelector<HTMLElement>("[data-couple-tag]")!;
    expect(tag.textContent).toBe(V40_COPY.couple.tagLabels.same);
    expect(tag.className).not.toMatch(/(^| )border/u);
    expect(tag.className).toContain("bg-[var(--hb-surface-hover)]");
    expect(item.querySelector("button, a, [role='button']")).toBeNull();
  });
});

describe("CoupleAxisRow: 태그는 셋뿐", () => {
  it("같은 글자: 태그와 같은 글자 안내", async () => {
    const item = await renderRow(makeRow("process", side("W", "clear"), side("W", "lean"), "same"), null);
    expect(chipTexts(item)).toEqual([V40_COPY.couple.tagLabels.same]);
    expect(item.textContent).toContain(coupleTagNote("process", "same", false));
    expect(item.dataset.tag).toBe("same");
  });

  it("다른 글자: 태그와 그 주제의 다른 글자 안내 한 줄", async () => {
    const item = await renderRow(makeRow("money", side("S", "lean"), side("V", "clear"), "different"), null);
    expect(chipTexts(item)).toEqual([V40_COPY.couple.tagLabels.different]);
    expect(item.textContent).toContain(`${axisInfo("money").differentNote}.`);
    expect(item.dataset.tag).toBe("different");
  });

  it("한쪽 또는 둘 다 반반이에요: 같다도 다르다도 말하지 않는다", async () => {
    const item = await renderRow(makeRow("scope", side("U", "lean"), side("U", "even"), "even"), null);
    expect(chipTexts(item)).toEqual([V40_COPY.couple.tagLabels.even]);
    expect(item.textContent).toContain(V40_COPY.couple.evenTagNote);
    expect(item.textContent).not.toContain(V40_COPY.couple.tagLabels.same);
    expect(item.textContent).not.toContain(V40_COPY.couple.tagLabels.different);
  });

  it("비교에서 뺀 자리는 태그 없이 뺐다는 안내만 붙는다(글자를 못 정한 쪽에 반반이에요를 붙이면 사실과 어긋난다)", async () => {
    const item = await renderRow(makeRow("scope", side("U", "lean"), side(null, null), "even", true), null);
    expect(chipTexts(item)).toEqual([]);
    expect(item.textContent).toContain(V40_COPY.couple.excludedTagNote);
    expect(item.dataset.tag).toBe("excluded");
  });
});

describe("CoupleAxisRow: 안내를 붙이는 규칙", () => {
  it("같은 글자 안내와 반반이에요 안내는 showNote 가 false 면 붙지 않는다", async () => {
    const same = await renderRow(makeRow("process", side("W", "clear"), side("W", "clear"), "same"), null, false);
    expect(same.textContent).not.toContain(coupleTagNote("process", "same", false));
    const even = await renderRow(makeRow("support", side("A", "even"), side("H", "even"), "even"), null, false);
    expect(even.textContent).not.toContain(V40_COPY.couple.evenTagNote);
  });

  it("다른 글자 안내는 showNote 와 상관없이 늘 붙는다(주제마다 말이 다르다)", async () => {
    const item = await renderRow(makeRow("support", side("H", "clear"), side("A", "lean"), "different"), null, false);
    expect(item.textContent).toContain(`${axisInfo("support").differentNote}.`);
  });

  it("비교에서 뺀 자리의 안내도 showNote 와 상관없이 늘 붙는다", async () => {
    const item = await renderRow(makeRow("support", side(null, null), side("A", "lean"), "even", true), null, false);
    expect(item.textContent).toContain(V40_COPY.couple.excludedTagNote);
  });
});

describe("CoupleAxisRow: 두 사람의 순서와 이름", () => {
  const row = makeRow("money", side("S", "lean"), side("V", "clear"), "different");
  const firstCell = "S 장면 먼저 · 기울어요";
  const secondCell = "V 조건 먼저 · 뚜렷해요";

  it("기준을 모르면 먼저 답한 사람, 나중에 답한 사람 순서다", async () => {
    const item = await renderRow(row, null);
    expect(cellsOf(item)).toEqual([
      [V40_COPY.couple.perspective.firstLabel, firstCell],
      [V40_COPY.couple.perspective.secondLabel, secondCell],
    ]);
  });

  it("내가 먼저 답한 사람이면 나, 상대 순서", async () => {
    const item = await renderRow(row, "first");
    expect(cellsOf(item)).toEqual([
      [V40_COPY.couple.perspective.meLabel, firstCell],
      [V40_COPY.couple.perspective.partnerLabel, secondCell],
    ]);
  });

  it("내가 나중에 답한 사람이면 나(둘째의 글자)가 먼저, 상대가 다음이다", async () => {
    const item = await renderRow(row, "second");
    expect(cellsOf(item)).toEqual([
      [V40_COPY.couple.perspective.meLabel, secondCell],
      [V40_COPY.couple.perspective.partnerLabel, firstCell],
    ]);
  });

  it("주제 이름이 제목이다", async () => {
    const item = await renderRow(row, null);
    expect(item.querySelector("h4")?.textContent).toBe(axisInfo("money").title);
  });
});

describe("CoupleAxisRow: 글자 칸", () => {
  it("칸의 글은 두 사람 화면의 글자 칸 문구(letterBandCell)와 글자 그대로 같다", async () => {
    const cases: ReadonlyArray<readonly [Letter, StrengthBand, boolean]> = [
      ["V", "clear", false],
      ["S", "lean", false],
      ["A", "even", false],
      ["H", "even", true],
    ];
    for (const [letter, band, provisional] of cases) {
      const item = await renderRow(makeRow(axisInfo(letter === "V" || letter === "S" ? "money" : "support").key, side(letter, band, provisional), side(oppositeLetter(letter), "lean"), "even"), null);
      expect(cellsOf(item)[0][1]).toBe(letterBandCell(letter, band, provisional));
    }
  });

  it("임시 글자에는 임시 표시가 붙고, 글자를 못 정한 칸은 정하지 못했다고 쓴다", async () => {
    const item = await renderRow(makeRow("support", side("H", "even", true), side(null, null), "even", true), null);
    const cells = cellsOf(item);
    expect(cells[0][1]).toContain(V40_COPY.result.provisionalMark);
    expect(cells[1][1]).toBe(V40_COPY.legend.notSetLabel);
  });

  it("글자는 크게, 나머지는 보통 크기로 한 줄에 이어서 읽힌다", async () => {
    const item = await renderRow(makeRow("money", side("S", "lean"), side("V", "clear"), "different"), null);
    const big = item.querySelector("p > span");
    expect(big?.textContent).toBe("S");
  });
});

describe("CoupleAxisRow: 말씨", () => {
  it("점수나 평가하는 말, 숫자, 번호 라벨이 없다", async () => {
    const item = await renderRow(makeRow("money", side("S", "lean"), side("V", "clear"), "different"), "first");
    expect(item.textContent).not.toMatch(/궁합|잘 ?맞|안 ?맞|점수|등급|퍼센트|백분율|%|\d/u);
    expect(labelProblemsIn(item).filter((problem) => !problem.includes("A/B"))).toEqual([]);
  });
});
