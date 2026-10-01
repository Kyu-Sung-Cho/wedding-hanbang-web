import { describe, expect, it } from "vitest";
import {
  V40_AXIS_KEYS,
  V40_LETTER_LIST,
  axisInfo,
  axisOfLetter,
  letterOf,
  oppositeLetter,
  type Letter,
  type Side,
  type StrengthBand,
} from "@/constants/weddingCodeV40";
import { WEDDING_CODE_V40_BANK } from "../bank";
import { V40_FIXTURES } from "../fixtures";
import { buildResult } from "../score";
import type { AxisResult, FormBit, V40Result } from "../types";
import {
  V40_LETTER_GUESS_ENABLED,
  clearLetterGuess,
  hasLetterGuessLines,
  hasLetterGuessPick,
  isLetterGuess,
  isLetterGuessEligible,
  isSettledAxis,
  letterGuessChoices,
  letterGuessForAttempt,
  letterGuessModule,
  loadLetterGuess,
  saveLetterGuess,
  summarizeLetterGuess,
  decodeLetterGuess,
  encodeLetterGuess,
  parseLetterGuessEnvelope,
  serializeLetterGuessEnvelope,
} from "./letterGuess";
import type { LetterGuess, LetterGuessLine, LetterGuessSummary } from "./types";

// ---------------------------------------------------------------------------
// 재료: 고정 표본의 실제 결과와, 주제 상태를 손으로 바꾼 결과
// ---------------------------------------------------------------------------

function resultOf(name: string): V40Result {
  const fixture = V40_FIXTURES.find((candidate) => candidate.name === name);
  if (fixture === undefined) throw new Error(`고정 표본이 없어요: ${name}`);
  return buildResult(WEDDING_CODE_V40_BANK, fixture.formBit, fixture.responses);
}

const BASE = resultOf("all-clear");

/** 주제 하나의 상태: 결과 화면이 보여 주는 글자 방향(없으면 null), 보이는 세기, 임시 글자인가. */
interface AxisSpec {
  readonly side: Side | null;
  readonly band: StrengthBand | null;
  readonly provisional?: boolean;
}

type FourSpecs = readonly [AxisSpec, AxisSpec, AxisSpec, AxisSpec];

/** 실제 결과 하나를 바탕으로 네 주제의 (글자, 보이는 세기, 임시) 만 바꾼 결과. 코드는 null 이 아닌 값으로 둔다(옵션으로 null). */
function resultWith(specs: FourSpecs, options: { readonly code?: string | null } = {}): V40Result {
  const axes = BASE.axes.map((axis, index): AxisResult => {
    const spec = specs[index];
    return {
      ...axis,
      letter: spec.side === null ? null : letterOf(axis.axis, spec.side),
      side: spec.side,
      shownBand: spec.band,
      provisional: spec.provisional ?? false,
    };
  }) as unknown as V40Result["axes"];
  return { ...BASE, axes, code: options.code === undefined ? "VDFH" : options.code };
}

const SETTLED_FRONT: AxisSpec = { side: "front", band: "clear" };
const SETTLED_BACK: AxisSpec = { side: "back", band: "lean" };
const EVEN_FRONT: AxisSpec = { side: "front", band: "even" };
const PROVISIONAL_FRONT: AxisSpec = { side: "front", band: "even", provisional: true };
const NO_LETTER: AxisSpec = { side: null, band: null };

const allAxes = (spec: AxisSpec): FourSpecs => [spec, spec, spec, spec];

function guessOf(sides: readonly (Side | null)[]): LetterGuess {
  return V40_AXIS_KEYS.map((axis, index) => {
    const side = sides[index];
    return side === null || side === undefined ? null : letterOf(axis, side);
  }) as unknown as LetterGuess;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// ---------------------------------------------------------------------------
// isSettledAxis
// ---------------------------------------------------------------------------

describe("isSettledAxis: 글자가 확정된 주제", () => {
  const bands: readonly (StrengthBand | null)[] = ["clear", "lean", "even", null];
  const sides: readonly (Side | null)[] = ["front", "back", null];

  it("글자 있음 x 임시 여부 x 보이는 세기를 모두 돌려 본다: 글자가 있고 임시가 아니고 뚜렷해요 또는 기울어요일 때만 참", () => {
    let checked = 0;
    let settledCount = 0;
    for (const side of sides) {
      for (const provisional of [false, true]) {
        for (const band of bands) {
          const result = resultWith([{ side, band, provisional }, SETTLED_FRONT, SETTLED_FRONT, SETTLED_FRONT]);
          const expected = side !== null && !provisional && (band === "clear" || band === "lean");
          expect(isSettledAxis(result.axes[0]), `side=${side} provisional=${provisional} band=${band}`).toBe(expected);
          checked += 1;
          if (expected) settledCount += 1;
        }
      }
    }
    expect(checked).toBe(24);
    expect(settledCount).toBe(4);
  });

  it("실제 고정 표본의 주제 마흔여덟 개도 같은 기준이다(임시 글자와 가운뎃점과 반반이에요는 거짓)", () => {
    let settled = 0;
    let unsettled = 0;
    for (const fixture of V40_FIXTURES) {
      const result = buildResult(WEDDING_CODE_V40_BANK, fixture.formBit, fixture.responses);
      for (const axis of result.axes) {
        const expected = axis.letter !== null && !axis.provisional && (axis.shownBand === "clear" || axis.shownBand === "lean");
        expect(isSettledAxis(axis), `${fixture.name} ${axis.axis}`).toBe(expected);
        if (expected) settled += 1;
        else unsettled += 1;
      }
    }
    expect(settled + unsettled).toBe(48);
    expect(settled).toBeGreaterThan(10);
    expect(unsettled).toBeGreaterThan(10);
  });

  it("글자가 있어도 힌트가 세기를 반반이에요로 낮췄으면 확정이 아니다(보이는 세기를 따른다)", () => {
    const demoted = resultOf("rhythm-hint");
    expect(demoted.notes.demoted).toBe(true);
    const evenAfterDemotion = demoted.axes.filter((axis) => axis.letter !== null && axis.band !== "even" && axis.shownBand === "even");
    expect(evenAfterDemotion.length).toBeGreaterThan(0);
    for (const axis of evenAfterDemotion) expect(isSettledAxis(axis)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isLetterGuessEligible
// ---------------------------------------------------------------------------

describe("isLetterGuessEligible: 결과 앞에서 글자 고르기를 열 만한가", () => {
  it("코드가 있고 글자가 확정된 주제가 하나라도 있을 때만 참", () => {
    expect(isLetterGuessEligible(resultWith([SETTLED_FRONT, EVEN_FRONT, NO_LETTER, PROVISIONAL_FRONT]))).toBe(true);
    expect(isLetterGuessEligible(resultWith([EVEN_FRONT, EVEN_FRONT, NO_LETTER, SETTLED_BACK]))).toBe(true);
    expect(isLetterGuessEligible(resultWith([EVEN_FRONT, EVEN_FRONT, NO_LETTER, PROVISIONAL_FRONT]))).toBe(false);
    expect(isLetterGuessEligible(resultWith(allAxes(EVEN_FRONT)))).toBe(false);
    expect(isLetterGuessEligible(resultWith(allAxes(NO_LETTER)))).toBe(false);
  });

  it("관문이 닫혀 코드가 없으면 거짓이다(확정된 주제가 있어도)", () => {
    expect(isLetterGuessEligible(resultWith(allAxes(SETTLED_FRONT), { code: null }))).toBe(false);
  });

  it("실제 고정 표본: 반반이에요뿐인 표본과 관문이 닫힌 표본은 열지 않고 나머지는 연다", () => {
    const expected: Record<string, boolean> = {
      "swua-example": true,
      "all-clear": true,
      "all-even": false,
      "mixed-bands": true,
      "unusable-axis": true,
      "provisional-tie": true,
      "tie-chain": false,
      "rhythm-hint": true,
      "rhythm-gate": false,
      "skip-hint": true,
      "self-contrast": true,
      "couple-partner": true,
    };
    expect(Object.keys(expected).sort()).toEqual(V40_FIXTURES.map((fixture) => fixture.name).sort());
    for (const fixture of V40_FIXTURES) {
      const result = buildResult(WEDDING_CODE_V40_BANK, fixture.formBit, fixture.responses);
      expect(isLetterGuessEligible(result), fixture.name).toBe(expected[fixture.name]);
    }
  });
});

// ---------------------------------------------------------------------------
// summarizeLetterGuess: 계획 7.4의 표
// ---------------------------------------------------------------------------

describe("summarizeLetterGuess: 먼저 고른 글자와 결과 글자를 나란히 놓는 표", () => {
  const none: LetterGuessSummary = { kind: "none" };

  it("고른 것이 없으면 none: guess 가 null 이거나 네 칸 모두 고르지 않음", () => {
    const result = resultWith(allAxes(SETTLED_FRONT));
    expect(summarizeLetterGuess(result, null)).toStrictEqual(none);
    expect(summarizeLetterGuess(result, guessOf([null, null, null, null]))).toStrictEqual(none);
  });

  it("관문이 닫혀 코드가 없으면 골랐어도 none", () => {
    const result = resultWith(allAxes(SETTLED_FRONT), { code: null });
    expect(summarizeLetterGuess(result, guessOf(["back", "back", "back", "back"]))).toStrictEqual(none);
    expect(summarizeLetterGuess(result, guessOf(["front", "front", "front", "front"]))).toStrictEqual(none);
  });

  it("실제 관문이 닫힌 표본(rhythm-gate)도 none", () => {
    const closed = resultOf("rhythm-gate");
    expect(closed.code).toBeNull();
    expect(summarizeLetterGuess(closed, guessOf(["back", "back", "back", "back"]))).toStrictEqual(none);
  });

  it("모양이 틀린 guess 는 none(길이가 다르거나 다른 주제의 글자가 들어 있음)", () => {
    const result = resultWith(allAxes(SETTLED_FRONT));
    expect(summarizeLetterGuess(result, ["V", "W", "U"] as unknown as LetterGuess)).toStrictEqual(none);
    expect(summarizeLetterGuess(result, ["V", "W", "U", "H", "A"] as unknown as LetterGuess)).toStrictEqual(none);
    // 둘째 칸(준비)에 돈의 글자 S 가 들어갔다.
    expect(summarizeLetterGuess(result, ["V", "S", "U", "H"] as unknown as LetterGuess)).toStrictEqual(none);
    expect(summarizeLetterGuess(result, ["x", null, null, null] as unknown as LetterGuess)).toStrictEqual(none);
  });

  it("글자가 확정된 주제를 다르게 골랐으면 그 주제의 줄: 먼저 고른 글자와 결과 글자", () => {
    const result = resultWith([SETTLED_FRONT, SETTLED_BACK, SETTLED_FRONT, SETTLED_BACK]);
    const summary = summarizeLetterGuess(result, guessOf([null, "front", null, null]));
    expect(summary).toStrictEqual({ kind: "lines", lines: [{ axis: "process", guessed: "W", shown: "D" }] });
  });

  it("일부만 다르면 다른 주제의 줄만 그린다. 같은 주제는 말하지 않고 줄은 주제 순서다", () => {
    const result = resultWith([SETTLED_FRONT, SETTLED_BACK, SETTLED_FRONT, SETTLED_BACK]);
    // 돈은 같음(V), 준비는 다름(W 대신 결과 D), 정하는 사람은 같음(U), 지쳤을 때는 다름(H 대신 결과 A).
    const summary = summarizeLetterGuess(result, guessOf(["front", "front", "front", "front"]));
    const lines: LetterGuessLine[] = [
      { axis: "process", guessed: "W", shown: "D" },
      { axis: "support", guessed: "H", shown: "A" },
    ];
    expect(summary).toStrictEqual({ kind: "lines", lines });
  });

  it("전부 다르면 네 줄이 주제 순서로 나온다", () => {
    const result = resultWith([SETTLED_FRONT, SETTLED_BACK, SETTLED_FRONT, SETTLED_BACK]);
    const summary = summarizeLetterGuess(result, guessOf(["back", "front", "back", "front"]));
    expect(summary).toStrictEqual({
      kind: "lines",
      lines: [
        { axis: "money", guessed: "S", shown: "V" },
        { axis: "process", guessed: "W", shown: "D" },
        { axis: "scope", guessed: "F", shown: "U" },
        { axis: "support", guessed: "H", shown: "A" },
      ],
    });
  });

  it("글자가 확정된 주제를 골랐고 전부 같으면 same 한 줄(주제별 줄을 만들지 않는다)", () => {
    const result = resultWith([SETTLED_FRONT, SETTLED_BACK, SETTLED_FRONT, SETTLED_BACK]);
    expect(summarizeLetterGuess(result, guessOf(["front", "back", "front", "back"]))).toStrictEqual({ kind: "same" });
    expect(summarizeLetterGuess(result, guessOf([null, "back", null, null]))).toStrictEqual({ kind: "same" });
  });

  it("골라 둔 주제가 전부 확정이 아니면 unsettledOnly: 반반이에요, 임시 글자, 글자 없음", () => {
    const result = resultWith([EVEN_FRONT, PROVISIONAL_FRONT, NO_LETTER, SETTLED_FRONT]);
    expect(summarizeLetterGuess(result, guessOf(["front", null, null, null]))).toStrictEqual({ kind: "unsettledOnly" });
    expect(summarizeLetterGuess(result, guessOf([null, "back", null, null]))).toStrictEqual({ kind: "unsettledOnly" });
    expect(summarizeLetterGuess(result, guessOf([null, null, "front", null]))).toStrictEqual({ kind: "unsettledOnly" });
    expect(summarizeLetterGuess(result, guessOf(["back", "front", "back", null]))).toStrictEqual({ kind: "unsettledOnly" });
  });

  it("확정이 아닌 주제는 같아도 달라도 줄을 만들지 않는다. 확정인 주제의 결과만 요약을 정한다", () => {
    const result = resultWith([EVEN_FRONT, PROVISIONAL_FRONT, NO_LETTER, SETTLED_FRONT]);
    // 확정이 아닌 세 주제는 일부러 결과 글자와 다르게 골랐다. 지쳤을 때(확정)는 같게 골랐다.
    expect(summarizeLetterGuess(result, guessOf(["back", "back", "back", "front"]))).toStrictEqual({ kind: "same" });
    // 지쳤을 때를 다르게 골랐으면 그 주제의 줄만 나온다.
    expect(summarizeLetterGuess(result, guessOf(["back", "back", "back", "back"]))).toStrictEqual({
      kind: "lines",
      lines: [{ axis: "support", guessed: "A", shown: "H" }],
    });
  });

  it("임시 글자는 글자가 있어도 견주지 않는다(앞 글자를 임시로 적은 것이라 일치 여부가 뜻이 없다)", () => {
    const result = resultWith([PROVISIONAL_FRONT, SETTLED_FRONT, SETTLED_FRONT, SETTLED_FRONT]);
    expect(result.axes[0].letter).toBe("V");
    // 돈을 S 로 골랐고 결과 글자는 임시 V 다. 줄을 만들지 않는다.
    expect(summarizeLetterGuess(result, guessOf(["back", null, null, null]))).toStrictEqual({ kind: "unsettledOnly" });
  });

  it("힌트가 세기를 반반이에요로 낮춘 주제는 글자가 달라도 줄이 없다(보이는 세기를 따른다)", () => {
    const demoted = resultOf("rhythm-hint");
    expect(demoted.code).not.toBeNull();
    // 이 표본에서 확정은 돈(V, 기울어요)뿐이고 나머지 셋은 힌트 때문에 반반이에요로 보인다.
    expect(demoted.axes.map((axis) => isSettledAxis(axis))).toStrictEqual([true, false, false, false]);
    // 모든 주제를 결과 글자의 반대 글자로 골랐다.
    const opposite = demoted.axes.map((axis) => {
      if (axis.letter === null) throw new Error("이 표본의 네 주제에는 글자가 있다");
      return oppositeLetter(axis.letter);
    }) as unknown as LetterGuess;
    const summary = summarizeLetterGuess(demoted, opposite);
    // 반반이에요로 낮춘 세 주제는 줄이 없고 돈 하나만 줄이다.
    expect(summary).toStrictEqual({ kind: "lines", lines: [{ axis: "money", guessed: "S", shown: "V" }] });
  });

  it("주제 하나만 골랐을 때의 15가지 경우(결과 상태 다섯 x 고른 쪽 셋)를 손으로 쓴 표와 맞춘다", () => {
    type Row = readonly [string, AxisSpec, "front" | "back", LetterGuessSummary["kind"]];
    const rows: readonly Row[] = [
      ["확정 앞글자, 같음", SETTLED_FRONT, "front", "same"],
      ["확정 앞글자, 다름", SETTLED_FRONT, "back", "lines"],
      ["확정 뒤글자, 같음", SETTLED_BACK, "back", "same"],
      ["확정 뒤글자, 다름", SETTLED_BACK, "front", "lines"],
      ["반반이에요 앞글자, 같음", EVEN_FRONT, "front", "unsettledOnly"],
      ["반반이에요 앞글자, 다름", EVEN_FRONT, "back", "unsettledOnly"],
      ["임시 글자, 같음", PROVISIONAL_FRONT, "front", "unsettledOnly"],
      ["임시 글자, 다름", PROVISIONAL_FRONT, "back", "unsettledOnly"],
      ["글자 없음, 앞글자를 고름", NO_LETTER, "front", "unsettledOnly"],
      ["글자 없음, 뒤글자를 고름", NO_LETTER, "back", "unsettledOnly"],
    ];
    for (const [label, spec, picked, kind] of rows) {
      // 고른 주제는 돈 하나. 나머지 세 주제는 확정이어도 고르지 않았으므로 요약에 영향이 없다.
      const result = resultWith([spec, SETTLED_FRONT, SETTLED_FRONT, SETTLED_FRONT]);
      expect(summarizeLetterGuess(result, guessOf([picked, null, null, null])).kind, label).toBe(kind);
    }
    // 힌트로 내려간 반반(세기 낮춤)은 위 반반이에요 행과 같은 상태(보이는 세기 even)다.
    expect(rows).toHaveLength(10);
  });

  it("고정 표본 열두 개 x 고르기 조합 전부(주제마다 고르지 않음, 앞글자, 뒤글자 = 81가지): 요약이 주제별 판정과 같다", () => {
    const kindsSeen = new Set<string>();
    for (const fixture of V40_FIXTURES) {
      const result = buildResult(WEDDING_CODE_V40_BANK, fixture.formBit, fixture.responses);
      const options: readonly (Side | null)[] = [null, "front", "back"];
      for (const a of options) {
        for (const b of options) {
          for (const c of options) {
            for (const d of options) {
              const guess = guessOf([a, b, c, d]);
              const summary = summarizeLetterGuess(result, guess);
              // 손으로 센 기대값: 주제마다 (고르지 않음 | 확정 아님 | 같음 | 다름) 로 나눈다.
              const differing: LetterGuessLine[] = [];
              let sameCount = 0;
              let chosenCount = 0;
              result.axes.forEach((axis, index) => {
                const picked = guess[index];
                if (picked === null) return;
                chosenCount += 1;
                const settled = axis.letter !== null && !axis.provisional && (axis.shownBand === "clear" || axis.shownBand === "lean");
                if (!settled || axis.letter === null) return;
                if (picked === axis.letter) sameCount += 1;
                else differing.push({ axis: axis.axis, guessed: picked, shown: axis.letter });
              });
              let expected: LetterGuessSummary;
              if (result.code === null || chosenCount === 0) expected = { kind: "none" };
              else if (differing.length > 0) expected = { kind: "lines", lines: differing };
              else if (sameCount > 0) expected = { kind: "same" };
              else expected = { kind: "unsettledOnly" };
              expect(summary, `${fixture.name} ${[a, b, c, d].join("/")}`).toStrictEqual(expected);
              kindsSeen.add(summary.kind);
            }
          }
        }
      }
    }
    // 측정기가 비어 있지 않다: 네 종류가 모두 실제로 나왔다.
    expect([...kindsSeen].sort()).toStrictEqual(["lines", "none", "same", "unsettledOnly"]);
  });

  it("입력을 고치지 않고 결과도 새 객체를 돌려준다(얼린 입력도 받는다)", () => {
    const result = deepFreeze(resultWith([SETTLED_FRONT, SETTLED_BACK, SETTLED_FRONT, SETTLED_BACK]));
    const guess = deepFreeze(guessOf(["back", "front", null, null]));
    const first = summarizeLetterGuess(result, guess);
    const second = summarizeLetterGuess(result, guess);
    expect(first).toStrictEqual(second);
    expect(first).not.toBe(second);
    expect(summarizeLetterGuess(result, null)).not.toBe(summarizeLetterGuess(result, null));
  });

  it("줄에는 고른 글자와 결과 글자가 같은 주제의 두 글자 중 서로 다른 하나씩만 든다", () => {
    for (const fixture of V40_FIXTURES) {
      const result = buildResult(WEDDING_CODE_V40_BANK, fixture.formBit, fixture.responses);
      const summary = summarizeLetterGuess(result, guessOf(["back", "front", "back", "front"]));
      if (summary.kind !== "lines") continue;
      for (const line of summary.lines) {
        expect(line.guessed).not.toBe(line.shown);
        expect(axisOfLetter(line.guessed)).toBe(line.axis);
        expect(axisOfLetter(line.shown)).toBe(line.axis);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// letterGuessChoices, 모양 검사, 모듈
// ---------------------------------------------------------------------------

describe("letterGuessChoices: 글자 카드의 위아래", () => {
  it("폼 비트 0 은 앞 글자가 위, 1 은 뒤 글자가 위다(주제 네 개 모두)", () => {
    for (const axis of V40_AXIS_KEYS) {
      const info = axisInfo(axis);
      expect(letterGuessChoices(0, axis)).toStrictEqual([info.front, info.back]);
      expect(letterGuessChoices(1, axis)).toStrictEqual([info.back, info.front]);
    }
    expect(letterGuessChoices(0, "money")).toStrictEqual(["V", "S"]);
    expect(letterGuessChoices(1, "support")).toStrictEqual(["A", "H"]);
  });

  it("두 글자는 늘 그 주제의 두 글자이고 서로 다르다. 폼 비트는 순서만 바꾼다", () => {
    for (const axis of V40_AXIS_KEYS) {
      for (const formBit of [0, 1] as const satisfies readonly FormBit[]) {
        const [top, bottom] = letterGuessChoices(formBit, axis);
        expect(top).not.toBe(bottom);
        expect(axisOfLetter(top)).toBe(axis);
        expect(axisOfLetter(bottom)).toBe(axis);
      }
      expect([...letterGuessChoices(0, axis)].sort()).toStrictEqual([...letterGuessChoices(1, axis)].sort());
    }
  });
});

describe("모양 검사와 모듈", () => {
  it("isLetterGuess: 네 칸이고 칸마다 null 이거나 그 주제의 글자", () => {
    expect(isLetterGuess([null, null, null, null])).toBe(true);
    expect(isLetterGuess(["V", "W", "U", "H"])).toBe(true);
    expect(isLetterGuess(["S", "D", "F", "A"])).toBe(true);
    expect(isLetterGuess(["W", null, null, null])).toBe(false);
    expect(isLetterGuess([null, null, null])).toBe(false);
    expect(isLetterGuess("V-UA")).toBe(false);
    expect(isLetterGuess(null)).toBe(false);
    expect(isLetterGuess(undefined)).toBe(false);
    expect(isLetterGuess([null, null, null, undefined])).toBe(false);
    expect(isLetterGuess(["V", "W", "U", 5])).toBe(false);
    for (const letter of V40_LETTER_LIST) {
      const axisIndex = V40_AXIS_KEYS.indexOf(axisOfLetter(letter));
      const other = (axisIndex + 1) % 4;
      const guess: (Letter | null)[] = [null, null, null, null];
      guess[axisIndex] = letter;
      expect(isLetterGuess(guess), `${letter} 제자리`).toBe(true);
      guess[axisIndex] = null;
      guess[other] = letter;
      expect(isLetterGuess(guess), `${letter} 다른 주제 칸`).toBe(false);
    }
  });

  it("hasLetterGuessPick: 하나라도 골랐을 때만", () => {
    expect(hasLetterGuessPick(null)).toBe(false);
    expect(hasLetterGuessPick(guessOf([null, null, null, null]))).toBe(false);
    expect(hasLetterGuessPick(guessOf([null, null, null, "back"]))).toBe(true);
  });

  it("hasLetterGuessLines: 요약이 none 일 때만 거짓(결과 화면이 슬롯 상자를 만들지 않는다)", () => {
    expect(hasLetterGuessLines({ kind: "none" })).toBe(false);
    expect(hasLetterGuessLines({ kind: "same" })).toBe(true);
    expect(hasLetterGuessLines({ kind: "unsettledOnly" })).toBe(true);
    expect(hasLetterGuessLines({ kind: "lines", lines: [{ axis: "money", guessed: "S", shown: "V" }] })).toBe(true);
    const result = resultWith([SETTLED_FRONT, SETTLED_BACK, SETTLED_FRONT, SETTLED_BACK]);
    expect(hasLetterGuessLines(summarizeLetterGuess(result, null))).toBe(false);
    expect(hasLetterGuessLines(summarizeLetterGuess(result, guessOf(["front", null, null, null])))).toBe(true);
  });

  it("기능 켬 상수는 켬(어둡게 둔 v4 입구 뒤에서만 열린다)이고 불리언이다", () => {
    expect(typeof V40_LETTER_GUESS_ENABLED).toBe("boolean");
    expect(V40_LETTER_GUESS_ENABLED).toBe(true);
  });

  it("계약 객체가 이 모듈의 함수를 그대로 묶고 있다(보관본 함수 넷과 포트를 주입받는 도우미 넷 포함)", () => {
    expect(Object.keys(letterGuessModule).sort()).toStrictEqual(
      [
        "clearLetterGuess",
        "decodeLetterGuess",
        "encodeLetterGuess",
        "hasLetterGuessLines",
        "isLetterGuessEligible",
        "isSettledAxis",
        "letterGuessChoices",
        "letterGuessForAttempt",
        "loadLetterGuess",
        "parseLetterGuessEnvelope",
        "saveLetterGuess",
        "serializeLetterGuessEnvelope",
        "summarizeLetterGuess",
      ].sort(),
    );
    expect(letterGuessModule.hasLetterGuessLines).toBe(hasLetterGuessLines);
    expect(letterGuessModule.isSettledAxis).toBe(isSettledAxis);
    expect(letterGuessModule.isLetterGuessEligible).toBe(isLetterGuessEligible);
    expect(letterGuessModule.summarizeLetterGuess).toBe(summarizeLetterGuess);
    expect(letterGuessModule.letterGuessChoices).toBe(letterGuessChoices);
    expect(letterGuessModule.serializeLetterGuessEnvelope).toBe(serializeLetterGuessEnvelope);
    expect(letterGuessModule.parseLetterGuessEnvelope).toBe(parseLetterGuessEnvelope);
    expect(letterGuessModule.encodeLetterGuess).toBe(encodeLetterGuess);
    expect(letterGuessModule.decodeLetterGuess).toBe(decodeLetterGuess);
    expect(letterGuessModule.loadLetterGuess).toBe(loadLetterGuess);
    expect(letterGuessModule.letterGuessForAttempt).toBe(letterGuessForAttempt);
    expect(letterGuessModule.saveLetterGuess).toBe(saveLetterGuess);
    expect(letterGuessModule.clearLetterGuess).toBe(clearLetterGuess);
  });
});
