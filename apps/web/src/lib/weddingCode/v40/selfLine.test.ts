import { describe, expect, it } from "vitest";
import { V40_AXIS_KEYS, V40_STATE_COUNTS, axisInfo, type Letter } from "@/constants/weddingCodeV40";
import type { Axis, ResponseValue, Responses, ScoredFormat, ScoredItem, SelfLine, Side } from "./types";
import { WEDDING_CODE_V40_BANK } from "./bank";
import { V40_FIXTURES } from "./fixtures";
import { V40_LAYOUT_BY_ID } from "./layout";
import { buildResult, scoreModule, selfLine } from "./score";
import { stateChar, stateIndex } from "./states";

/**
 * 마지막 정리에서 고른 쪽 줄(score.selfLine, 4.1 단계 1)의 시험.
 * 기대값은 구현의 selfChoice 나 letterOf 를 빌리지 않고 배치 골격의 키와 글자 표에서 따로 계산한다(구현이 틀리면 같이 틀리지 않게).
 */
const bank = WEDDING_CODE_V40_BANK;

const LETTERS: Readonly<Record<Axis, Readonly<Record<Side, Letter>>>> = {
  money: { front: "V", back: "S" },
  process: { front: "W", back: "D" },
  scope: { front: "U", back: "F" },
  support: { front: "H", back: "A" },
};

// ---------------------------------------------------------------------------
// 시험용 도구: 배치 골격의 키에서 값 -> 저장 상태, 자기 선택 상태 <-> (방향, 세기)
// ---------------------------------------------------------------------------

function expectedTable(fmt: ScoredFormat, key: 1 | -1): number[] {
  const table: number[] = [];
  switch (fmt) {
    case "pair":
      for (let s = 0; s < 6; s += 1) table.push(s < 3 ? key * 2 * (3 - s) : -key * 2 * (s - 2));
      break;
    case "react":
      for (let s = 0; s < 5; s += 1) table.push(key * (s - 2) * 3);
      break;
    case "recall":
    case "instant":
      for (const base of [-2, 6, 2, -6]) table.push(key * base);
      break;
    case "bestworst": {
      const arrangement = [1, -1, -1, 1];
      for (let best = 0; best < 4; best += 1) {
        for (let worst = 0; worst < 4; worst += 1) {
          if (best !== worst) table.push(4 * key * arrangement[best] - 2 * key * arrangement[worst]);
        }
      }
      break;
    }
    case "split":
      for (let a = 0; a <= 6; a += 1) for (let b = 0; a + b <= 6; b += 1) table.push(key * (a - b));
      break;
  }
  return table.map((value) => (value === 0 ? 0 : value));
}

function stateForValue(item: ScoredItem, wanted: number): string {
  const key = V40_LAYOUT_BY_ID.get(item.id)!.key;
  const state = expectedTable(item.fmt, key).indexOf(wanted);
  if (state < 0) throw new Error(`${item.id}(${item.fmt}, 키 ${key})는 값 ${wanted} 를 낼 수 없다`);
  return stateChar(state);
}

/** 자기 선택 상태: 위 카드 아주, 꽤, 조금 = 0, 1, 2 / 아래 카드 조금, 꽤, 아주 = 3, 4, 5. 위 카드가 어느 방향인지는 키가 정한다. */
function selfState(axis: Axis, side: Side, level: 1 | 2 | 3): string {
  const key = V40_LAYOUT_BY_ID.get(`self.${axis}`)!.key;
  const topSide: Side = key === 1 ? "front" : "back";
  return stateChar(side === topSide ? 3 - level : 2 + level);
}

/** selfState 의 역: 저장 문자에서 (방향, 세기). 6칸 밖이면 null. */
function decodeSelf(axis: Axis, char: string): { readonly side: Side; readonly level: 1 | 2 | 3 } | null {
  const state = stateIndex(char);
  if (state === null || state >= V40_STATE_COUNTS.self) return null;
  const key = V40_LAYOUT_BY_ID.get(`self.${axis}`)!.key;
  const topSide: Side = key === 1 ? "front" : "back";
  const bottomSide: Side = topSide === "front" ? "back" : "front";
  return state < 3 ? { side: topSide, level: (3 - state) as 1 | 2 | 3 } : { side: bottomSide, level: (state - 2) as 1 | 2 | 3 };
}

const AXIS_INDEX: Readonly<Record<Axis, number>> = { money: 0, process: 1, scope: 2, support: 3 };

/** 주제마다 정한 방향으로 모든 채점 문항에 가장 센 답(+6 또는 -6)을 준다. 자기 선택은 self 인자로 정한다. */
function strong(sides: readonly [Side, Side, Side, Side], self: Partial<Record<Axis, ResponseValue>> = {}): Record<string, ResponseValue> {
  const responses: Record<string, ResponseValue> = {};
  for (const item of bank.items) {
    if (item.fmt === "self") {
      const chosen = self[item.axis];
      if (chosen !== undefined) responses[item.id] = chosen;
      continue;
    }
    responses[item.id] = stateForValue(item, sides[AXIS_INDEX[item.axis]] === "front" ? 6 : -6);
  }
  return responses;
}

const FRONT4 = ["front", "front", "front", "front"] as const;

function linesOf(responses: Responses): (SelfLine | null)[] {
  const result = buildResult(bank, 0, responses);
  return result.axes.map((axis) => selfLine(bank, responses, axis));
}

// ---------------------------------------------------------------------------
// 조건 세 개
// ---------------------------------------------------------------------------

describe("selfLine: 자기 선택에 답한 주제는 고른 방향의 글자와 세기를 그대로 담는다", () => {
  it("주제 네 개 x 방향 둘 x 세기 셋 = 24가지: 대비가 없는 조합에서 글자와 세기가 고른 그대로다", () => {
    let shown = 0;
    let hidden = 0;
    for (const axis of V40_AXIS_KEYS) {
      for (const side of ["front", "back"] as const) {
        for (const level of [1, 2, 3] as const) {
          // 네 주제 모두 앞쪽으로 뚜렷하게 모인 응답: 뒤쪽을 꽤 이상으로 고르면 대비가 뜬다.
          const responses = strong(FRONT4, { [axis]: selfState(axis, side, level) });
          const result = buildResult(bank, 0, responses);
          const own = result.axes[AXIS_INDEX[axis]];
          expect(own.shownBand, `${axis} ${side} ${level}`).toBe("clear");
          const contrastExpected = side === "back" && level >= 2;
          expect(own.contrast !== null, `${axis} ${side} ${level} 대비`).toBe(contrastExpected);
          const line = selfLine(bank, responses, own);
          if (contrastExpected) {
            expect(line, `${axis} ${side} ${level}`).toBeNull();
            hidden += 1;
          } else {
            expect(line, `${axis} ${side} ${level}`).toEqual({ axis, side, letter: LETTERS[axis][side], level });
            shown += 1;
          }
          // 자기 선택을 답하지 않은 다른 세 주제에는 줄이 없다.
          result.axes.forEach((other) => {
            if (other.axis !== axis) expect(selfLine(bank, responses, other)).toBeNull();
          });
        }
      }
    }
    expect(shown).toBe(4 * 4);
    expect(hidden).toBe(4 * 2);
  });

  it("조금만 반대쪽으로 골랐으면 대비가 없어서 줄이 보인다(조금 가까워요)", () => {
    const responses = strong(FRONT4, { money: selfState("money", "back", 1) });
    const result = buildResult(bank, 0, responses);
    expect(result.axes[0].contrast).toBeNull();
    expect(result.axes[0].letter).toBe("V");
    expect(selfLine(bank, responses, result.axes[0])).toEqual({ axis: "money", side: "back", letter: "S", level: 1 });
  });

  it("자기 선택을 건너뛰었거나 해당 없음이거나 답하지 않았거나 저장값이 잘못됐으면 줄이 없다", () => {
    for (const raw of ["skip", "na", undefined, "z", "Z", "6", "9"] as const) {
      const responses = strong(FRONT4, raw === undefined ? {} : { money: raw });
      expect(linesOf(responses)[0], String(raw)).toBeNull();
    }
    // 칸이 여섯 개뿐이라 6 이상의 상태 문자는 자기 선택의 값이 아니다(빠진 값으로 다룬다).
    expect(decodeSelf("money", "6")).toBeNull();
  });

  it("글자를 못 정한 주제에는 자기 선택에 답했어도 줄이 없다", () => {
    const responses = strong(FRONT4, { money: selfState("money", "front", 3), process: selfState("process", "front", 3) });
    for (const item of bank.scoredByAxis.money) responses[item.id] = "na";
    const result = buildResult(bank, 0, responses);
    expect(result.axes[0]).toMatchObject({ unusable: true, letter: null });
    expect(selfLine(bank, responses, result.axes[0])).toBeNull();
    expect(selfLine(bank, responses, result.axes[1])).toEqual({ axis: "process", side: "front", letter: "W", level: 3 });
  });

  it("반반이에요 주제에도 답한 그대로의 줄이 있고, 자기 선택이 비어 임시 글자가 된 주제에는 없다", () => {
    // 앞 두 측면은 앞극 쪽으로, 뒤 두 측면은 뒤극 쪽으로 가장 세게 답해 합이 정확히 0(동점)이 되게 한다.
    const responses = strong(FRONT4, { support: selfState("support", "back", 2) });
    const facets = axisInfo("support").facets;
    for (const item of bank.scoredByAxis.support) {
      responses[item.id] = stateForValue(item, facets.indexOf(item.facet) < 2 ? 6 : -6);
    }
    const result = buildResult(bank, 0, responses);
    const tie = result.axes[3];
    expect(tie.shownBand).toBe("even");
    expect(tie.tieLevel).toBeGreaterThan(0);
    expect(selfLine(bank, responses, tie)).toEqual({ axis: "support", side: "back", letter: "A", level: 2 });
    // 자기 선택이 없으면 동점 사슬 끝(임시 글자)까지 가고, 그 주제에는 줄이 없다.
    const noSelf = { ...responses };
    delete noSelf["self.support"];
    const noSelfResult = buildResult(bank, 0, noSelf);
    expect(noSelfResult.axes[3]).toMatchObject({ shownBand: "even", provisional: true, tieLevel: 5 });
    expect(selfLine(bank, noSelf, noSelfResult.axes[3])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 대비와의 관계, 힌트와의 관계
// ---------------------------------------------------------------------------

describe("selfLine: 대비 문장이 뜨는 주제에는 없고, 대비가 사라지면 나타난다", () => {
  /** 돈 주제를 기울어요(채점 문항 16개 중 11개는 앞쪽 가장 센 답, 5개는 뒤쪽 가장 센 답, 합 36, N = 108)로 만든다. */
  function leanMoney(self: ResponseValue): Record<string, ResponseValue> {
    const responses = strong(FRONT4, { money: self });
    bank.scoredByAxis.money.forEach((item, index) => {
      responses[item.id] = stateForValue(item, index < 11 ? 6 : -6);
    });
    return responses;
  }

  /** 돈 밖의 채점 문항 중 두 가지 고르기와 이럴 때가 아닌 것 17개를 건너뛰어 건너뜀 힌트를 켠다(돈 주제 답은 그대로). */
  function withSkipHint(responses: Record<string, ResponseValue>): Record<string, ResponseValue> {
    const copy = { ...responses };
    bank.scored
      .filter((item) => item.axis !== "money" && item.fmt !== "pair" && item.fmt !== "react")
      .slice(0, 17)
      .forEach((item) => {
        copy[item.id] = "skip";
      });
    return copy;
  }

  it("기울어요에서 대비가 뜨면 줄은 없고, 건너뜀 힌트로 세기가 반반이에요까지 낮아져 대비가 사라지면 줄이 나타난다", () => {
    const plainResponses = leanMoney(selfState("money", "back", 3));
    const plain = buildResult(bank, 0, plainResponses);
    expect(plain.axes[0]).toMatchObject({ band: "lean", shownBand: "lean", letter: "V" });
    expect(plain.axes[0].contrast).not.toBeNull();
    expect(selfLine(bank, plainResponses, plain.axes[0])).toBeNull();

    const hintResponses = withSkipHint(plainResponses);
    const hinted = buildResult(bank, 0, hintResponses);
    expect(hinted.notes.hintSkip).toBe(true);
    expect(hinted.axes[0]).toMatchObject({ band: "lean", shownBand: "even", contrast: null });
    expect(selfLine(bank, hintResponses, hinted.axes[0])).toEqual({ axis: "money", side: "back", letter: "S", level: 3 });
  });

  it("힌트는 줄의 내용을 바꾸지 않는다: 같은 쪽을 고른 주제의 줄은 힌트로 세기가 낮아져도 같다", () => {
    const self = { money: selfState("money", "front", 2), process: selfState("process", "back", 1), scope: selfState("scope", "front", 3), support: selfState("support", "back", 1) };
    const plainResponses = strong(FRONT4, self);
    const plain = buildResult(bank, 0, plainResponses);
    expect(plain.notes.demoted).toBe(false);
    expect(plain.axes.map((axis) => axis.shownBand)).toEqual(["clear", "clear", "clear", "clear"]);
    // 잘 모르겠어요 17개를 주제에 나눠 건너뛴다(돈, 준비, 정하는 사람은 넷씩, 지쳤을 때는 다섯: 마지막 주제는 유효 답이 모자라 글자를 못 정한다).
    const hintResponses = { ...plainResponses };
    for (const [axis, count] of [["money", 4], ["process", 4], ["scope", 4], ["support", 5]] as const) {
      bank.scoredByAxis[axis].slice(0, count).forEach((item) => {
        hintResponses[item.id] = "skip";
      });
    }
    const hinted = buildResult(bank, 0, hintResponses);
    expect(hinted.notes).toMatchObject({ hintSkip: true, demoted: true, skippedCount: 17 });
    expect(hinted.axes.map((axis) => axis.shownBand)).toEqual(["lean", "lean", "lean", null]);
    expect(linesOf(plainResponses)).toEqual([
      { axis: "money", side: "front", letter: "V", level: 2 },
      { axis: "process", side: "back", letter: "D", level: 1 },
      { axis: "scope", side: "front", letter: "U", level: 3 },
      { axis: "support", side: "back", letter: "A", level: 1 },
    ]);
    // 세기가 낮아진 세 주제의 줄은 그대로이고, 글자를 못 정한 주제만 줄이 없다.
    expect(hinted.axes.map((axis) => selfLine(bank, hintResponses, axis))).toEqual([
      { axis: "money", side: "front", letter: "V", level: 2 },
      { axis: "process", side: "back", letter: "D", level: 1 },
      { axis: "scope", side: "front", letter: "U", level: 3 },
      null,
    ]);
  });
});

describe("selfLine: 결과를 바꾸지 않는다", () => {
  it("결과와 응답을 얼려 두고 불러도 던지지 않고 결과가 그대로다", () => {
    const responses = strong(FRONT4, { money: selfState("money", "front", 3), process: selfState("process", "back", 3) });
    const result = buildResult(bank, 0, responses);
    const before = JSON.stringify(result);
    const frozenResponses = Object.freeze({ ...responses });
    const frozenAxes = result.axes.map((axis) => Object.freeze({ ...axis }));
    for (const axis of frozenAxes) expect(() => selfLine(bank, frozenResponses, axis)).not.toThrow();
    expect(JSON.stringify(result)).toBe(before);
    expect(Object.keys(result.axes[0]).sort()).not.toContain("selfLine");
  });

  it("스코어 모듈 묶음에 같은 함수로 들어 있다", () => {
    expect(scoreModule.selfLine).toBe(selfLine);
  });
});

// ---------------------------------------------------------------------------
// 고정 표본 12개: 독립 계산과 같다
// ---------------------------------------------------------------------------

describe("selfLine: 고정 표본 12개의 모든 주제가 독립 계산과 같다", () => {
  it("글자가 있고 대비가 없고 자기 선택에 답했으면 답한 방향과 세기, 아니면 null", () => {
    let present = 0;
    let absentBecauseContrast = 0;
    let absentBecauseEscape = 0;
    let absentBecauseUnusable = 0;
    for (const fixture of V40_FIXTURES) {
      const result = buildResult(bank, fixture.formBit, fixture.responses);
      for (const axis of result.axes) {
        const raw = fixture.responses[`self.${axis.axis}`];
        const decoded = raw === undefined ? null : decodeSelf(axis.axis, raw);
        let expected: SelfLine | null = null;
        if (axis.letter === null) absentBecauseUnusable += 1;
        else if (axis.contrast !== null) absentBecauseContrast += 1;
        else if (decoded === null) absentBecauseEscape += 1;
        else {
          expected = { axis: axis.axis, side: decoded.side, letter: LETTERS[axis.axis][decoded.side], level: decoded.level };
          present += 1;
        }
        expect(selfLine(bank, fixture.responses, axis), `${fixture.name} ${axis.axis}`).toEqual(expected);
      }
    }
    // 표본이 네 갈래를 모두 지나가는지: 줄이 있는 경우와 없는 세 가지 까닭
    expect(present).toBeGreaterThan(20);
    expect(absentBecauseContrast).toBeGreaterThan(0);
    expect(absentBecauseEscape).toBeGreaterThan(0);
    expect(absentBecauseUnusable).toBeGreaterThan(0);
  });
});
