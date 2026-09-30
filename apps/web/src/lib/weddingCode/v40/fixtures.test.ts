import { describe, expect, it } from "vitest";
import * as oracleModule from "../../../../../../scripts/lib/wedding-code-v40-ref.mjs";
import { V40_AXIS_KEYS, V40_COUNTS } from "@/constants/weddingCodeV40";
import { V40_BANK_DATA } from "@/constants/weddingCodeV40Bank";
import type { Axis, Bank, BankData, Item, ItemId, V40Fixture, V40Result } from "./types";
import { WEDDING_CODE_V40_BANK } from "./bank";
import { canShare, decodeCode, encodeCode } from "./codec";
import { compareCouple } from "./couple";
import { allResolved, initialFlowState, skippedReviewIds } from "./flow";
import { V40_FIXTURES, V40_FIXTURE_NAMES, buildFixtureResponses, buildFixtures, fixtureByName } from "./fixtures";
import type { FixturePlan, FixtureRows } from "./fixtures";
import { V40_LAYOUT_BY_ID } from "./layout";
import { fromStored } from "./present";
import { buildResult } from "./score";
import { decodeProgressAnswers, encodeProgressAnswers } from "./storage";
import { isResponseValueFor, splitCountsOf, stateChar, stateIndex } from "./states";
import { itemValue, selfChoice } from "./value";

const bank = WEDDING_CODE_V40_BANK;

const EXPECTED_NAMES = [
  "swua-example",
  "all-clear",
  "all-even",
  "mixed-bands",
  "unusable-axis",
  "provisional-tie",
  "tie-chain",
  "rhythm-hint",
  "rhythm-gate",
  "skip-hint",
  "self-contrast",
  "couple-partner",
];

function named(name: string): V40Fixture {
  const found = fixtureByName(name);
  if (!found) throw new Error(`없는 표본: ${name}`);
  return found;
}

function resultOf(name: string): V40Result {
  const source = named(name);
  return buildResult(bank, source.formBit, source.responses);
}

const bands = (result: V40Result) => result.axes.map((axis) => axis.band);
const letters = (result: V40Result) => result.axes.map((axis) => axis.letter);

// ---------------------------------------------------------------------------
// 모양
// ---------------------------------------------------------------------------

describe("고정 표본의 모양", () => {
  it("이름 열두 개가 README 표 순서와 같고 서로 다르다", () => {
    expect(V40_FIXTURES.map((fixture) => fixture.name)).toEqual(EXPECTED_NAMES);
    expect([...V40_FIXTURE_NAMES]).toEqual(EXPECTED_NAMES);
    expect(new Set(EXPECTED_NAMES).size).toBe(12);
  });

  it("표본마다 설명이 있고 폼 비트는 0 또는 1 이며 둘 다 여러 번 쓰인다", () => {
    for (const fixture of V40_FIXTURES) {
      expect(fixture.description.length).toBeGreaterThan(5);
      expect([0, 1]).toContain(fixture.formBit);
    }
    expect(V40_FIXTURES.filter((fixture) => fixture.formBit === 0).length).toBeGreaterThanOrEqual(4);
    expect(V40_FIXTURES.filter((fixture) => fixture.formBit === 1).length).toBeGreaterThanOrEqual(4);
  });

  it("응답은 68개 문항이 모두 채워져 있고 값은 모두 그 형식의 저장값이다", () => {
    for (const fixture of V40_FIXTURES) {
      expect(Object.keys(fixture.responses).sort(), fixture.name).toEqual(bank.items.map((item) => item.id).sort());
      expect(Object.keys(fixture.responses)).toHaveLength(V40_COUNTS.items);
      for (const item of bank.items) {
        expect(isResponseValueFor(item.fmt, fixture.responses[item.id]), `${fixture.name} ${item.id}=${fixture.responses[item.id]}`).toBe(true);
      }
      expect(allResolved(bank, fixture.responses)).toBe(true);
    }
  });

  it("표본은 얼려 있어 화면 빌더가 실수로 바꿀 수 없다", () => {
    expect(Object.isFrozen(V40_FIXTURES)).toBe(true);
    for (const fixture of V40_FIXTURES) {
      expect(Object.isFrozen(fixture)).toBe(true);
      expect(Object.isFrozen(fixture.responses)).toBe(true);
    }
  });

  it("이름으로 찾고 없는 이름은 undefined 다", () => {
    expect(fixtureByName("swua-example")).toBe(V40_FIXTURES[0]);
    expect(fixtureByName("nope")).toBeUndefined();
    expect(fixtureByName("__proto__")).toBeUndefined();
  });

  it("다시 만들어도 같다(순수)", () => {
    expect(buildFixtures(bank)).toEqual(V40_FIXTURES);
  });
});

// ---------------------------------------------------------------------------
// 각 표본이 보여 주는 것 (README 6절 표)
// ---------------------------------------------------------------------------

describe("표본이 보여 주는 것", () => {
  it("swua-example: 돈 S 기울어요, 준비 W 뚜렷해요, 정하는 사람 U 기울어요, 지쳤을 때 A 반반이에요(코드 SWUA)", () => {
    const result = resultOf("swua-example");
    expect(result.code).toBe("SWUA");
    expect(letters(result)).toEqual(["S", "W", "U", "A"]);
    expect(result.axes.map((axis) => axis.shownBand)).toEqual(["lean", "clear", "lean", "even"]);
    expect(result.gate.closed).toBe(false);
    // 설계 5절 예: 돈 주제 측면 합 -15, +10, -24, -15, 문항 합 -44, N = -132.
    expect(result.axes[0].facets.map((facet) => facet.sum)).toEqual([-15, 10, -24, -15]);
    expect(result.axes[0]).toMatchObject({ sum: -44, weighted: -132, countedFacets: 4, answered: 16 });
    expect(result.axes.every((axis) => axis.tieLevel === 0 && !axis.provisional)).toBe(true);
  });

  it("all-clear: 네 주제 모두 뚜렷해요", () => {
    const result = resultOf("all-clear");
    expect(bands(result)).toEqual(["clear", "clear", "clear", "clear"]);
    expect(result.axes.map((axis) => axis.shownBand)).toEqual(["clear", "clear", "clear", "clear"]);
    expect(letters(result).every((letter) => letter !== null)).toBe(true);
    expect(result.code).toHaveLength(4);
  });

  it("all-even: 네 주제 모두 반반이에요이지만 확정 글자는 있다(동점 사슬로 정한 것이 아니다)", () => {
    const result = resultOf("all-even");
    expect(result.axes.map((axis) => axis.shownBand)).toEqual(["even", "even", "even", "even"]);
    for (const axis of result.axes) {
      expect(axis.letter).not.toBeNull();
      expect(axis.provisional).toBe(false);
      expect(axis.tieLevel).toBe(0);
      expect(axis.weighted).not.toBe(0);
    }
    expect(result.gate.closed).toBe(false);
    expect(result.code).not.toBeNull();
  });

  it("mixed-bands: 뚜렷해요, 기울어요, 반반이에요가 모두 섞인다", () => {
    const shown = resultOf("mixed-bands").axes.map((axis) => axis.shownBand);
    expect(shown).toContain("clear");
    expect(shown).toContain("lean");
    expect(shown).toContain("even");
    expect(shown).toEqual(["clear", "lean", "even", "lean"]);
  });

  it("unusable-axis: 한 주제의 유효 답이 12개 미만이라 글자 자리가 가운뎃점이다", () => {
    const result = resultOf("unusable-axis");
    expect(result.axes.filter((axis) => axis.unusable).map((axis) => axis.axis)).toEqual(["scope"]);
    expect(result.axes[2].answered).toBeLessThan(12);
    expect(result.axes[2]).toMatchObject({ letter: null, band: null, shownBand: null, weighted: null, tieLevel: null });
    expect(result.code).toBe("SW·A");
    expect(result.notes.unusableAxes).toEqual(["scope"]);
    expect(result.notes.hasOmitted).toBe(true);
    expect(result.gate.closed).toBe(false);
    expect(skippedReviewIds(bank, named("unusable-axis").responses)).not.toEqual([]);
  });

  it("provisional-tie: 한 주제가 동점 사슬 끝까지 가서 앞 글자를 임시로 적는다", () => {
    const result = resultOf("provisional-tie");
    expect(result.notes.provisionalAxes).toEqual(["support"]);
    expect(result.axes[3]).toMatchObject({ provisional: true, tieLevel: 5, weighted: 0, letter: "H", side: "front", band: "even", shownBand: "even" });
    expect(result.axes.filter((axis) => axis.provisional)).toHaveLength(1);
    expect(result.code).toHaveLength(4);
    expect(result.gate.closed).toBe(false);
    // 자기 선택을 건너뛰어 4단계가 아니라 5단계까지 간다.
    expect(named("provisional-tie").responses["self.support"]).toBe("skip");
  });

  it("tie-chain: 동점 사슬 1에서 4단계에서 갈리는 주제들(임시 글자 없음)", () => {
    const result = resultOf("tie-chain");
    expect(result.axes.map((axis) => axis.tieLevel)).toEqual([1, 2, 3, 4]);
    expect(result.axes.every((axis) => axis.weighted === 0 && !axis.provisional && axis.band === "even")).toBe(true);
    expect(letters(result)).toEqual(["V", "D", "U", "A"]);
    expect(result.gate.closed).toBe(false);
  });

  it("rhythm-hint: 위치 반복 형식이 2개라 모든 세기가 한 단계 낮춰진다(관문은 열려 있다)", () => {
    const result = resultOf("rhythm-hint");
    expect(result.rhythm.flaggedCount).toBe(2);
    expect(result.rhythm.formats.filter((format) => format.flagged).map((format) => format.family)).toEqual(["pair", "react"]);
    expect(result.notes).toMatchObject({ hintRhythm: true, hintSkip: false, demoted: true });
    expect(result.gate.closed).toBe(false);
    expect(result.code).not.toBeNull();
    expect(result.axes.map((axis) => [axis.band, axis.shownBand])).toEqual([
      ["clear", "lean"],
      ["lean", "even"],
      ["lean", "even"],
      ["even", "even"],
    ]);
  });

  it("rhythm-gate: 위치 반복 형식이 3개라 코드가 없다", () => {
    const result = resultOf("rhythm-gate");
    expect(result.rhythm.flaggedCount).toBe(3);
    expect(result.gate).toEqual({ closed: true, reason: "rhythm" });
    expect(result.code).toBeNull();
    expect(canShare(result)).toBe(false);
    expect(result.rhythm.formats.map((format) => format.period)).toEqual([1, 1, 1]);
  });

  it("skip-hint: 잘 모르겠어요가 17개라 모든 세기가 한 단계 낮춰진다", () => {
    const result = resultOf("skip-hint");
    expect(result.notes.skippedCount).toBe(17);
    expect(result.notes).toMatchObject({ hintSkip: true, hintRhythm: false, demoted: true, notApplicableCount: 0 });
    expect(result.rhythm.flaggedCount).toBe(0);
    expect(result.gate.closed).toBe(false);
    const usable = result.axes.filter((axis) => !axis.unusable);
    expect(usable).toHaveLength(3);
    for (const axis of usable) expect(axis.answered).toBe(12);
    expect(result.axes.map((axis) => [axis.band, axis.shownBand])).toEqual([
      ["clear", "lean"],
      ["lean", "even"],
      [null, null],
      ["clear", "lean"],
    ]);
    expect(result.code).toBe("VD·H");
  });

  it("self-contrast: 직접 고른 쪽이 답 쪽과 다르고 꽤 이상인 주제에서 대비가 나온다", () => {
    const result = resultOf("self-contrast");
    const contrasts = result.axes.flatMap((axis) => (axis.contrast ? [axis.contrast] : []));
    expect(contrasts.map((contrast) => [contrast.axis, contrast.selfLetter, contrast.gatheredLetter, contrast.selfLevel, contrast.gatheredBand])).toEqual([
      ["process", "D", "W", 3, "lean"],
      ["scope", "U", "F", 2, "clear"],
    ]);
    // 반반이에요 주제는 자기 선택이 달라도 대비를 만들지 않는다.
    expect(result.axes[3].shownBand).toBe("even");
    expect(result.axes[3].contrast).toBeNull();
  });

  it("self-contrast 의 돈 주제에서 자기 선택을 반대쪽 조금(1)로 바꾸면 대비가 없고 꽤(2)로 바꾸면 생긴다(기준 계산기도 같은 결정)", () => {
    const source = named("self-contrast");
    const selfItem = bank.self.find((item) => item.axis === "money");
    if (!selfItem) throw new Error("돈 주제의 자기 선택 문항이 없다");
    // 돈 주제는 앞극(V)으로 뚜렷하게 모였고 표본의 자기 선택도 앞극이다. 반대쪽(뒤극)을 고른 저장 상태를 세기별로 찾는다.
    const backChar = (level: 1 | 2 | 3) => {
      for (let state = 0; state < 6; state += 1) {
        const char = stateChar(state);
        const choice = selfChoice(selfItem, char);
        if (choice !== null && choice.side === "back" && choice.level === level) return char;
      }
      throw new Error(`뒤극 세기 ${level} 의 상태가 없다`);
    };
    const oracle = oracleModule as unknown as {
      makeBank(data: unknown): unknown;
      buildResult(oracleBank: unknown, formBit: number, responses: unknown): unknown;
    };
    const oracleBank = oracle.makeBank(V40_BANK_DATA);
    const withSelf = (level: 1 | 2 | 3) => ({ ...source.responses, [selfItem.id]: backChar(level) });

    const weak = buildResult(bank, source.formBit, withSelf(1));
    expect(weak.axes[0]).toMatchObject({ letter: "V", side: "front" });
    expect(weak.axes[0].shownBand === "clear" || weak.axes[0].shownBand === "lean").toBe(true);
    expect(weak.axes[0].contrast).toBeNull();

    const fair = buildResult(bank, source.formBit, withSelf(2));
    expect(fair.axes[0].contrast).toMatchObject({ axis: "money", selfSide: "back", selfLetter: "S", selfLevel: 2, gatheredSide: "front", gatheredLetter: "V" });
    const strong = buildResult(bank, source.formBit, withSelf(3));
    expect(strong.axes[0].contrast).toMatchObject({ axis: "money", selfLetter: "S", selfLevel: 3 });

    for (const level of [1, 2, 3] as const) {
      expect(buildResult(bank, source.formBit, withSelf(level)), `세기 ${level}`).toEqual(oracle.buildResult(oracleBank, source.formBit, withSelf(level)));
    }
  });

  it("다른 표본에는 대비가 없다(self-contrast 만 대비를 보여 준다)", () => {
    for (const fixture of V40_FIXTURES) {
      if (fixture.name === "self-contrast") continue;
      const result = buildResult(bank, fixture.formBit, fixture.responses);
      expect(result.axes.filter((axis) => axis.contrast !== null), fixture.name).toEqual([]);
    }
  });

  it("위치 반복과 건너뜀 힌트는 그 표본들에서만 일어난다", () => {
    for (const fixture of V40_FIXTURES) {
      const result = buildResult(bank, fixture.formBit, fixture.responses);
      const rhythmal = ["rhythm-hint", "rhythm-gate"].includes(fixture.name);
      expect(result.rhythm.flaggedCount > 0, fixture.name).toBe(rhythmal);
      expect(result.notes.hintSkip, fixture.name).toBe(fixture.name === "skip-hint");
      expect(result.gate.closed, fixture.name).toBe(fixture.name === "rhythm-gate");
    }
  });

  it("couple-partner: swua-example 와 짝으로 다른 글자, 이야기해 볼 질문, 비슷한 질문이 나온다", () => {
    const partner = named("couple-partner");
    expect(partner.formBit).not.toBe(named("swua-example").formBit);
    const result = compareCouple(bank, { formBit: 0, responses: named("swua-example").responses }, { formBit: partner.formBit, responses: partner.responses });
    expect(result.axes.map((row) => row.tag)).toEqual(["different", "same", "different", "even"]);
    expect(result.talk).toHaveLength(3);
    expect(result.similar).toHaveLength(3);
    expect(result.talk.every((pair) => pair.firstValue * pair.secondValue < 0 && pair.gap >= 8)).toBe(true);
    expect(result.similar.every((pair) => pair.firstValue * pair.secondValue > 0 && Math.min(Math.abs(pair.firstValue), Math.abs(pair.secondValue)) >= 4)).toBe(true);
    expect(letters(resultOf("couple-partner"))).toEqual(["V", "W", "F", "H"]);
  });
});

describe("표본을 만드는 규칙", () => {
  const pairs = bank.scored.filter((item) => item.fmt === "pair");
  const reacts = bank.scored.filter((item) => item.fmt === "react");
  const chooses = bank.scored.filter((item) => item.fmt === "recall" || item.fmt === "instant");

  it("위치를 고정해 누른 표본은 화면 기준으로 늘 같은 자리를 눌렀다(rhythm-hint)", () => {
    const source = named("rhythm-hint");
    for (const item of pairs) expect(fromStored(item, source.formBit, source.responses[item.id]), item.id).toEqual({ fmt: "pair", cell: 0 });
    for (const item of reacts) expect(fromStored(item, source.formBit, source.responses[item.id]), item.id).toEqual({ fmt: "react", cell: 4 });
    // 고르기는 값으로 정한 것이라 한 자리로 몰려 있지 않다.
    const options = chooses.map((item) => JSON.stringify(fromStored(item, source.formBit, source.responses[item.id])));
    expect(new Set(options).size).toBeGreaterThan(1);
  });

  it("위치를 고정해 누른 표본은 폼 비트 1 이어도 화면 기준으로 늘 같은 자리다(rhythm-gate)", () => {
    const source = named("rhythm-gate");
    expect(source.formBit).toBe(1);
    for (const item of pairs) expect(fromStored(item, 1, source.responses[item.id]), item.id).toEqual({ fmt: "pair", cell: 0 });
    for (const item of reacts) expect(fromStored(item, 1, source.responses[item.id]), item.id).toEqual({ fmt: "react", cell: 0 });
    for (const item of chooses) expect(fromStored(item, 1, source.responses[item.id]), item.id).toEqual({ fmt: item.fmt, option: 0 });
    // 같은 화면 자리라도 저장 상태는 폼 비트로 뒤집힌다(문항 은행 기준).
    expect(pairs.every((item) => source.responses[item.id] === "5")).toBe(true);
  });

  const uniform = (rows: FixtureRows): FixturePlan => ({
    name: "custom",
    description: "시험용",
    formBit: 0,
    axes: {
      money: { rows, self: "skip" },
      process: { rows, self: "skip" },
      scope: { rows, self: "skip" },
      support: { rows, self: "skip" },
    },
  });

  it("원하는 값이 두 값의 한가운데이면 절댓값이 큰 쪽을 고른다", () => {
    const rows: FixtureRows = [[3, 3, 4, 4], [3, 3, 4, 4], [3, 3, 4, 4], [3, 3, 4, 4]];
    const responses = buildFixtureResponses(bank, uniform(rows));
    for (const item of bank.scored) {
      const expected = item.fmt === "pair" ? 4 : item.fmt === "react" ? 3 : item.fmt === "split" ? 4 : 6;
      expect(itemValue(item, responses[item.id]), item.id).toBe(expected);
    }
  });

  it("음수로 원해도 같은 규칙이다(한가운데는 절댓값이 큰 쪽)", () => {
    const rows: FixtureRows = [[-3, -3, -4, -4], [-3, -3, -4, -4], [-3, -3, -4, -4], [-3, -3, -4, -4]];
    const responses = buildFixtureResponses(bank, uniform(rows));
    for (const item of bank.scored) {
      const expected = item.fmt === "pair" ? -4 : item.fmt === "react" ? -3 : item.fmt === "split" ? -4 : -6;
      expect(itemValue(item, responses[item.id]), item.id).toBe(expected);
    }
  });

  it("칸 나누기는 같은 값을 내는 상태 중 중립 칸이 가장 적은 것을 쓴다", () => {
    for (const source of V40_FIXTURES) {
      for (const item of bank.scored) {
        if (item.fmt !== "split") continue;
        const state = stateIndex(source.responses[item.id]);
        if (state === null) continue;
        const counts = splitCountsOf(state);
        const neutral = counts[item.entries.findIndex((entry) => entry.pole === "neutral")];
        const value = itemValue(item, source.responses[item.id]) ?? 0;
        expect(neutral, `${source.name} ${item.id} 값 ${value}`).toBe(Math.abs(value) % 2);
      }
    }
  });

  it("같은 값을 원해도 가장·아닌 것의 카드는 한 자리로 몰리지 않는다(문항 순서로 돌려 고른다)", () => {
    const rows: FixtureRows = [[6, 6, 6, 6], [6, 6, 6, 6], [6, 6, 6, 6], [6, 6, 6, 6]];
    const responses = buildFixtureResponses(bank, uniform(rows));
    const groups = new Map<number, Set<string>>();
    for (const item of bank.scored) {
      if (item.fmt !== "bestworst") continue;
      const key = V40_LAYOUT_BY_ID.get(item.id)?.key ?? 0;
      const states = groups.get(key) ?? new Set<string>();
      states.add(responses[item.id]);
      groups.set(key, states);
    }
    expect(groups.size).toBe(2);
    for (const states of groups.values()) expect(states.size).toBeGreaterThan(1);
  });

  it("이름과 계획이 같아도 자기 선택 계획만 바꾸면 자기 선택 문항만 달라진다", () => {
    const rows: FixtureRows = [[2, 3, 2, 2], [2, 3, 2, 2], [2, 3, 2, 2], [2, 3, 2, 2]];
    const skipped = buildFixtureResponses(bank, uniform(rows));
    const chosen = buildFixtureResponses(bank, { ...uniform(rows), axes: { ...uniform(rows).axes, money: { rows, self: { side: "back", level: 3 } } } });
    const differing = bank.items.filter((item) => skipped[item.id] !== chosen[item.id]).map((item) => item.id);
    expect(differing).toEqual(["self.money"]);
    expect(skipped["self.money"]).toBe("skip");
  });
});

// ---------------------------------------------------------------------------
// 다른 모듈과의 맞물림
// ---------------------------------------------------------------------------

describe("다른 모듈과의 맞물림", () => {
  it("관문이 열린 표본은 70자 링크 코드가 되고 풀면 같은 응답이 나온다", () => {
    for (const fixture of V40_FIXTURES) {
      const code = encodeCode(bank, fixture.formBit, fixture.responses);
      expect(code, fixture.name).toHaveLength(70);
      const decoded = decodeCode(bank, code);
      expect(decoded, fixture.name).toEqual({ formBit: fixture.formBit, responses: fixture.responses });
    }
  });

  it("진행 저장 표기로 바꿨다 되돌려도 같은 응답이다", () => {
    for (const fixture of V40_FIXTURES) {
      const encoded = encodeProgressAnswers(bank, fixture.responses);
      expect(decodeProgressAnswers(bank, encoded ?? "")).toEqual(fixture.responses);
    }
  });

  it("독립 기준 계산기(scripts/lib/wedding-code-v40-ref.mjs)도 모든 표본에서 같은 결과를 낸다(폼 비트 0, 1 모두)", () => {
    const oracle = oracleModule as unknown as {
      makeBank(data: unknown): unknown;
      buildResult(oracleBank: unknown, formBit: number, responses: unknown): unknown;
    };
    const oracleBank = oracle.makeBank(V40_BANK_DATA);
    for (const fixture of V40_FIXTURES) {
      for (const formBit of [0, 1] as const) {
        expect(buildResult(bank, formBit, fixture.responses), `${fixture.name} 폼 비트 ${formBit}`).toEqual(oracle.buildResult(oracleBank, formBit, fixture.responses));
      }
    }
  });

  it("스냅샷으로 이어 하면 결과 쪽에서 시작한다", () => {
    for (const fixture of V40_FIXTURES) {
      const state = initialFlowState(bank, { snapshot: { formBit: fixture.formBit, responses: fixture.responses, screen: "result", cursor: 0, skippedReviewDone: true } });
      expect(state.pages[state.pageIndex].kind, fixture.name).toBe("result");
      expect(state.formBit).toBe(fixture.formBit);
    }
  });

  it("어떤 표본도 채점이 폼 비트와 무관하다(축 집계가 같다)", () => {
    for (const fixture of V40_FIXTURES) {
      const a = buildResult(bank, 0, fixture.responses).axes.map((axis) => [axis.letter, axis.weighted, axis.tieLevel]);
      const b = buildResult(bank, 1, fixture.responses).axes.map((axis) => [axis.letter, axis.weighted, axis.tieLevel]);
      expect(b, fixture.name).toEqual(a);
    }
  });
});

// ---------------------------------------------------------------------------
// 문구에 기대지 않는다: 같은 배치 골격에 전혀 다른 문구를 실어도 같은 표본이 나온다
// ---------------------------------------------------------------------------

const STRUCTURAL_KEYS = new Set(["version", "id", "axis", "facet", "section", "screen", "key", "fmt", "kind", "pole", "highPole", "strength"]);

/** 배치와 극과 형식은 두고 문구(문자열)만 모두 다른 글로 바꾼다. */
function scramble(data: BankData): BankData {
  let counter = 0;
  const visit = (value: unknown, key: string | null): unknown => {
    if (typeof value === "string") return key !== null && STRUCTURAL_KEYS.has(key) ? value : `문구${(counter += 1)}`;
    if (Array.isArray(value)) return value.map((child) => visit(child, key));
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, visit(child, name)]));
    }
    return value;
  };
  return visit(data, null) as BankData;
}

/** createBank 의 조회 구조 만들기와 같지만 문구 검사(validateBank)를 거치지 않는다(바꾼 문구가 규칙에 맞을 필요가 없다). */
function unvalidatedBank(data: BankData): Bank {
  const items: readonly Item[] = data.items;
  const scored = items.filter((item) => item.fmt !== "self") as Bank["scored"];
  const self = items.filter((item) => item.fmt === "self") as Bank["self"];
  const byId = new Map<ItemId, Item>(items.map((item) => [item.id, item]));
  const codeIndexById = new Map<ItemId, number>(items.map((item, index) => [item.id, index]));
  const scoredByAxis = {} as Record<Axis, Bank["scored"]>;
  for (const axis of V40_AXIS_KEYS) scoredByAxis[axis] = scored.filter((item) => item.axis === axis);
  const screens: ItemId[][] = [];
  for (const item of items) {
    if (!screens[item.screen]) screens[item.screen] = [];
    screens[item.screen].push(item.id);
  }
  return { version: data.version, items, scored, self, byId, codeIndexById, scoredByAxis, screens };
}

describe("문구에 기대지 않는다", () => {
  const scrambled = scramble(V40_BANK_DATA);
  const other = unvalidatedBank(scrambled);

  it("문구를 모두 바꾼 은행에서도 표본 응답이 한 글자도 다르지 않다", () => {
    const first = V40_BANK_DATA.items[0];
    expect(JSON.stringify(scrambled.items[0])).not.toBe(JSON.stringify(first));
    expect(scrambled.items.map((item) => item.id)).toEqual(V40_BANK_DATA.items.map((item) => item.id));
    expect(buildFixtures(other)).toEqual(V40_FIXTURES);
  });

  it("바꾼 은행에서 만든 결과와 두 사람 비교도 같다", () => {
    for (const fixture of buildFixtures(other)) {
      const original = named(fixture.name);
      const a = buildResult(other, fixture.formBit, fixture.responses);
      const b = buildResult(bank, original.formBit, original.responses);
      expect(JSON.stringify(a.axes.map((axis) => [axis.letter, axis.weighted, axis.tieLevel, axis.shownBand])), fixture.name).toBe(
        JSON.stringify(b.axes.map((axis) => [axis.letter, axis.weighted, axis.tieLevel, axis.shownBand])),
      );
      expect(a.code).toBe(b.code);
    }
  });
});
