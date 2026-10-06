import { describe, expect, it } from "vitest";
import { V40_AXIS_KEYS, V40_STATE_COUNTS } from "@/constants/weddingCodeV40";
import type { CoupleItemPair, CoupleResult, DecodedCode, FormBit, ResponseValue, Responses, ScoredItem } from "./types";
import { WEDDING_CODE_V40_BANK } from "./bank";
import { COUPLE_LIST_LIMIT, COUPLE_SIMILAR_MIN_ABS, COUPLE_TALK_MIN_GAP, compareCouple, coupleModule, detectPerspective } from "./couple";
import { decodeCode, encodeCode } from "./codec";
import { V40_FIXTURES } from "./fixtures";
import { answerText } from "./present";
import { buildResult } from "./score";
import { stateChar } from "./states";
import { itemValue, stateValue } from "./value";

const bank = WEDDING_CODE_V40_BANK;

// ---------------------------------------------------------------------------
// 시험 도구
// ---------------------------------------------------------------------------

type Wanted = number | "skip" | "na";

function stateForValue(target: ScoredItem, wanted: number): ResponseValue {
  for (let state = 0; state < V40_STATE_COUNTS[target.fmt]; state += 1) {
    if (stateValue(target, state) === wanted) return stateChar(state);
  }
  throw new Error(`${target.id}(${target.fmt})는 값 ${wanted} 를 낼 수 없다`);
}

function respond(plan: Readonly<Record<string, Wanted>>): Responses {
  const responses: Record<string, ResponseValue> = {};
  for (const [id, wanted] of Object.entries(plan)) {
    const target = bank.byId.get(id);
    if (!target || target.fmt === "self") throw new Error(`채점 문항이 아니다: ${id}`);
    responses[id] = wanted === "skip" || wanted === "na" ? wanted : stateForValue(target, wanted);
  }
  return responses;
}

/** 그 문항에서 낼 수 있는 가장 작은 양수 값(문항 하나가 양쪽에서 이 값이면 talk 에도 similar 에도 들지 않는다: 부호가 같고 |값| 4 미만). */
function fillerValue(target: ScoredItem): number {
  let best: number | null = null;
  for (let state = 0; state < V40_STATE_COUNTS[target.fmt]; state += 1) {
    const value = stateValue(target, state);
    if (value > 0 && (best === null || value < best)) best = value;
  }
  if (best === null || best >= COUPLE_SIMILAR_MIN_ABS) throw new Error(`${target.id}(${target.fmt})에는 채움 값으로 쓸 작은 양수가 없다`);
  return best;
}

/**
 * 문항 단위 경계를 주제 제외(설계 7절: 비교에서 뺀 자리의 문항은 목록에 넣지 않는다)와 따로 보려는 응답: 채점 문항 64개를 모두 채움 값으로 채우고
 * plan 에 적은 문항만 원하는 값(또는 건너뜀, 해당 없음)으로 바꾼다. absent 에 적은 문항은 응답에서 뺀다. 두 사람 모두 이렇게 만들면 네 주제가 모두
 * 비교 대상으로 남고 채움 문항은 목록에 끼지 않아 plan 의 문항만 경계 시험을 받는다.
 */
function respondSettled(plan: Readonly<Record<string, Wanted>>, absent: readonly string[] = []): Responses {
  const full: Record<string, Wanted> = {};
  for (const target of bank.scored) full[target.id] = fillerValue(target);
  Object.assign(full, plan);
  const responses: Record<string, ResponseValue> = { ...respond(full) };
  for (const id of absent) delete responses[id];
  return responses;
}

/** 두 사람을 비교했을 때 네 주제가 모두 비교 대상으로 남았는가(경계 시험의 전제). */
const allCompared = (result: CoupleResult): boolean => result.axes.every((row) => !row.excluded);

const person = (responses: Responses, formBit: FormBit = 0): DecodedCode => ({ formBit, responses });

function fixture(name: string): DecodedCode {
  const found = V40_FIXTURES.find((entry) => entry.name === name);
  if (!found) throw new Error(`없는 표본: ${name}`);
  return { formBit: found.formBit, responses: found.responses };
}

const summary = (list: readonly CoupleItemPair[]) => list.map((pair) => [pair.itemId, pair.firstValue, pair.secondValue, pair.gap]);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPerson(seed: number): DecodedCode {
  const rng = mulberry32(seed);
  const skipRate = [0, 0.05, 0.25][seed % 3];
  const sides = V40_AXIS_KEYS.map(() => (rng() < 0.5 ? 1 : -1));
  const responses: Record<string, ResponseValue> = {};
  for (const target of bank.items) {
    const roll = rng();
    if (roll < 0.02) continue;
    if (roll < 0.02 + skipRate) responses[target.id] = "skip";
    else if (roll < 0.06 + skipRate) responses[target.id] = "na";
    else {
      const count = V40_STATE_COUNTS[target.fmt];
      let state = Math.floor(rng() * count);
      if (target.fmt !== "self" && seed % 2 === 0) {
        const persona = sides[V40_AXIS_KEYS.indexOf(target.axis)];
        for (let retry = 0; retry < 3 && stateValue(target, state) * persona <= 0; retry += 1) state = Math.floor(rng() * count);
      }
      responses[target.id] = stateChar(state);
    }
  }
  return { formBit: (seed % 2) as FormBit, responses };
}

// ---------------------------------------------------------------------------
// 독립 기준 구현: 문항 단위 비교(계약 문장을 그대로 옮긴 짧은 계산)
// ---------------------------------------------------------------------------

/** 비교에서 빠지는 주제(계약 문장 그대로): 어느 쪽이든 관문이 닫혔거나 글자를 못 정했거나 임시 글자. */
function referenceExcludedAxes(first: DecodedCode, second: DecodedCode): Set<string> {
  const a = buildResult(bank, first.formBit, first.responses);
  const b = buildResult(bank, second.formBit, second.responses);
  const gateClosed = a.gate.closed || b.gate.closed;
  const excluded = new Set<string>();
  V40_AXIS_KEYS.forEach((axis, index) => {
    const x = a.axes[index];
    const y = b.axes[index];
    if (gateClosed || x.letter === null || y.letter === null || x.provisional || y.provisional) excluded.add(axis);
  });
  return excluded;
}

function referenceLists(first: DecodedCode, second: DecodedCode, options: { readonly ignoreExclusion?: boolean } = {}) {
  interface Cand {
    readonly pair: CoupleItemPair;
    readonly order: number;
    readonly rank: number;
  }
  const talk: Cand[] = [];
  const similar: Cand[] = [];
  const excludedAxes = options.ignoreExclusion ? new Set<string>() : referenceExcludedAxes(first, second);
  bank.scored.forEach((target, order) => {
    if (excludedAxes.has(target.axis)) return;
    const a = itemValue(target, first.responses[target.id]);
    const b = itemValue(target, second.responses[target.id]);
    if (a === null || b === null || a === 0 || b === 0) return;
    const pair: CoupleItemPair = {
      itemId: target.id,
      axis: target.axis,
      facet: target.facet,
      caption: target.caption,
      prompt: target.fmt === "react"
        ? [target.stem, ...(target.quote ? [`${target.quote.speaker} · 「${target.quote.text}」`] : []), target.question]
        : [target.stem],
      firstValue: a,
      secondValue: b,
      gap: Math.abs(a - b),
      firstText: answerText(target, first.responses[target.id]) ?? "",
      secondText: answerText(target, second.responses[target.id]) ?? "",
    };
    if (a * b < 0 && Math.abs(a - b) >= 8) talk.push({ pair, order, rank: Math.abs(a - b) });
    if (a * b > 0 && Math.min(Math.abs(a), Math.abs(b)) >= 4) similar.push({ pair, order, rank: Math.min(Math.abs(a), Math.abs(b)) });
  });
  const choose = (list: Cand[]): CoupleItemPair[] => {
    const sorted = [...list].sort((x, y) => y.rank - x.rank || x.order - y.order);
    const picked: Cand[] = [];
    for (const axis of V40_AXIS_KEYS) {
      const top = sorted.find((entry) => entry.pair.axis === axis);
      if (top) picked.push(top);
    }
    const leaders = [...picked].sort((x, y) => y.rank - x.rank || x.order - y.order).slice(0, 3);
    const chosen = new Set(leaders);
    for (const entry of sorted) if (chosen.size < 3) chosen.add(entry);
    return sorted.filter((entry) => chosen.has(entry)).map((entry) => entry.pair);
  };
  return { talk: choose(talk), similar: choose(similar) };
}

// ---------------------------------------------------------------------------
// 주제 태그
// ---------------------------------------------------------------------------

describe("compareCouple: 주제 태그", () => {
  it("비교 질문의 상황과 인용과 물음을 은행 원문으로 남긴다", () => {
    const first = person(respondSettled({ "process.search.1": 6, "money.limit.1": 6 }));
    const second = person(respondSettled({ "process.search.1": -6, "money.limit.1": -6 }));
    const result = compareCouple(bank, first, second);
    const reactive = result.talk.find((pair) => pair.itemId === "process.search.1");
    const pairing = result.talk.find((pair) => pair.itemId === "money.limit.1");
    const reactItem = bank.byId.get("process.search.1");
    const pairItem = bank.byId.get("money.limit.1");
    if (!reactItem || reactItem.fmt !== "react" || !reactItem.quote || !pairItem) throw new Error("원문 질문이 필요해요");
    expect(reactive?.prompt).toEqual([reactItem.stem, `${reactItem.quote.speaker} · 「${reactItem.quote.text}」`, reactItem.question]);
    expect(pairing?.prompt).toEqual([pairItem.stem]);
  });

  it("swua-example 와 couple-partner: 돈과 정하는 사람은 다른 글자, 준비는 같은 글자, 지친 날은 둘 다 반반이라 같다도 다르다도 말하지 않는다", () => {
    const result = compareCouple(bank, fixture("swua-example"), fixture("couple-partner"));
    expect(result.axes.map((row) => [row.axis, row.first.letter, row.second.letter, row.tag, row.excluded])).toEqual([
      ["money", "S", "V", "different", false],
      ["process", "W", "W", "same", false],
      ["scope", "U", "F", "different", false],
      ["support", "A", "H", "even", false],
    ]);
    expect(result.axes.map((row) => [row.first.shownBand, row.second.shownBand])).toEqual([
      ["lean", "lean"],
      ["clear", "clear"],
      ["lean", "lean"],
      ["even", "even"],
    ]);
    expect(result.axes.every((row) => !row.first.provisional && !row.second.provisional)).toBe(true);
  });

  it("뚜렷해요와 기울어요는 둘 다 기울어요 이상이므로 글자가 같으면 같은 글자다", () => {
    const result = compareCouple(bank, fixture("all-clear"), fixture("mixed-bands"));
    expect(result.axes.map((row) => [row.first.shownBand, row.second.shownBand, row.tag])).toEqual([
      ["clear", "clear", "same"],
      ["clear", "lean", "same"],
      ["clear", "even", "even"],
      ["clear", "lean", "same"],
    ]);
  });

  it("한쪽이라도 반반이에요이면 글자가 같아도 달라도 같다다르다를 말하지 않는다", () => {
    const evenBoth = compareCouple(bank, fixture("all-even"), fixture("all-even"));
    expect(evenBoth.axes.map((row) => row.tag)).toEqual(["even", "even", "even", "even"]);
    const mixed = compareCouple(bank, fixture("all-clear"), fixture("all-even"));
    expect(mixed.axes.every((row) => row.tag === "even")).toBe(true);
    expect(mixed.axes.every((row) => !row.excluded)).toBe(true);
  });

  it("같은 사람끼리는 기울어요 이상인 주제가 모두 같은 글자다", () => {
    const self = compareCouple(bank, fixture("swua-example"), fixture("swua-example"));
    expect(self.axes.map((row) => row.tag)).toEqual(["same", "same", "same", "even"]);
  });

  it("글자를 못 정한 주제와 임시 글자는 비교에서 빠지고 tag 는 even 이다", () => {
    const unusable = compareCouple(bank, fixture("swua-example"), fixture("unusable-axis"));
    const scope = unusable.axes[2];
    expect(scope).toMatchObject({ axis: "scope", excluded: true, tag: "even" });
    expect(scope.second).toMatchObject({ letter: null, shownBand: null, provisional: false, answered: 10, frontCount: 8, backCount: 2, neutralCount: 0 });
    expect(scope.first.letter).toBe("U");
    const provisional = compareCouple(bank, fixture("provisional-tie"), fixture("swua-example"));
    const support = provisional.axes[3];
    expect(support).toMatchObject({ excluded: true, tag: "even" });
    expect(support.first).toMatchObject({ letter: "H", provisional: true, shownBand: "even" });
    expect(support.second.provisional).toBe(false);
    expect(provisional.axes.filter((row) => row.excluded)).toHaveLength(1);
  });

  it("건너뜀 힌트로 낮춰진 세기(shownBand)를 기준으로 삼는다", () => {
    const hinted = compareCouple(bank, fixture("rhythm-hint"), fixture("rhythm-hint"));
    expect(hinted.axes.map((row) => [row.first.shownBand, row.tag])).toEqual([
      ["lean", "same"],
      ["even", "even"],
      ["even", "even"],
      ["even", "even"],
    ]);
  });

  it("한쪽이 반반이에요이면 글자가 같아도 달라도 even 이다(기울어요 이상 둘일 때만 말한다)", () => {
    const partner = fixture("couple-partner");
    // 돈 주제 합 -8 (글자 S, 반반이에요)와 그 부호를 뒤집은 합 +8 (글자 V, 반반이에요). 상대의 돈은 V 기울어요다.
    const mildBack: Record<string, number> = {
      "money.limit.1": -6, "money.limit.2": 6, "money.limit.3": -2, "money.limit.4": -6,
      "money.check.1": -3, "money.check.2": 6, "money.check.3": -4, "money.check.4": -4,
      "money.worth.1": -2, "money.worth.2": 2, "money.worth.3": 6, "money.worth.4": -6,
      "money.moment.1": 4, "money.moment.2": -2, "money.moment.3": -3, "money.moment.4": 6,
    };
    const mildFront = Object.fromEntries(Object.entries(mildBack).map(([id, value]) => [id, -value]));
    for (const [plan, letter] of [[mildBack, "S"], [mildFront, "V"]] as const) {
      const result = compareCouple(bank, person(respond(plan)), partner);
      expect(result.axes[0].first).toMatchObject({ letter, shownBand: "even", provisional: false });
      expect(result.axes[0].second).toMatchObject({ letter: "V", shownBand: "lean" });
      expect(result.axes[0]).toMatchObject({ tag: "even", excluded: false });
    }
  });
});

// ---------------------------------------------------------------------------
// 문항 단위: 먼저 이야기해 볼 질문, 이미 비슷하게 고른 질문
// ---------------------------------------------------------------------------

describe("compareCouple: 문항 단위 비교의 기준값", () => {
  it("임계값은 값 차이 8, 비슷한 질문은 둘 다 |값| 4, 목록은 최대 3개다", () => {
    expect(COUPLE_TALK_MIN_GAP).toBe(8);
    expect(COUPLE_SIMILAR_MIN_ABS).toBe(4);
    expect(COUPLE_LIST_LIMIT).toBe(3);
  });

  it("먼저 이야기해 볼 질문은 부호가 반대이고 값 차이가 8 이상일 때만 뽑는다(경계 7과 8, 0 은 제외)", () => {
    // 돈 주제의 한 문항씩: 두 가지 중 고르기는 값이 짝수(2, 4, 6)라 경계 8 은 (4, -4)와 (6, -2)에서 만난다.
    const a = respondSettled({ "money.limit.1": -4, "money.worth.3": 6, "money.check.4": 2, "money.moment.2": -2, "money.limit.2": 0, "money.check.1": 3, "money.limit.3": 2 });
    const b = respondSettled({ "money.limit.1": 4, "money.worth.3": -2, "money.check.4": -4, "money.moment.2": 6, "money.limit.2": -6, "money.check.1": -6, "money.limit.3": -6 });
    const result = compareCouple(bank, person(a), person(b));
    expect(allCompared(result)).toBe(true);
    const byId = new Map<string, CoupleItemPair>(result.talk.map((pair) => [pair.itemId, pair]));
    // limit.1 은 차이 8, worth.3 은 차이 8, moment.2 는 차이 8, check.4 는 차이 6, limit.2 는 0 이라 제외, check.1 은 차이 9, limit.3 은 차이 8.
    const all = referenceLists(person(a), person(b));
    expect(summary(result.talk)).toEqual(summary(all.talk));
    expect(byId.has("money.check.4")).toBe(false);
    expect(byId.has("money.limit.2")).toBe(false);
    for (const pair of result.talk) {
      expect(pair.firstValue * pair.secondValue).toBeLessThan(0);
      expect(pair.gap).toBeGreaterThanOrEqual(8);
      expect(pair.gap).toBe(Math.abs(pair.firstValue - pair.secondValue));
    }
  });

  it("차이 7 은 뽑지 않고 8 은 뽑는다(값이 정수 전부인 칸 나누기에서 7과 8이 만난다)", () => {
    const a = respondSettled({ "money.check.3": 3, "money.moment.1": 4 });
    const b = respondSettled({ "money.check.3": -4, "money.moment.1": -4 });
    const result = compareCouple(bank, person(a), person(b));
    expect(allCompared(result)).toBe(true);
    expect(result.talk.map((pair) => [pair.itemId, pair.gap])).toEqual([["money.moment.1", 8]]);
  });

  it("이럴 때 칸(0, 3, 6)에서는 차이 6 은 뽑지 않고 9 는 뽑는다", () => {
    const a = respondSettled({ "money.limit.2": 3, "money.check.1": 3 });
    const b = respondSettled({ "money.limit.2": -3, "money.check.1": -6 });
    const result = compareCouple(bank, person(a), person(b));
    expect(allCompared(result)).toBe(true);
    expect(result.talk.map((pair) => [pair.itemId, pair.gap])).toEqual([["money.check.1", 9]]);
  });

  it("비슷한 질문의 경계는 칸 나누기에서 3(제외)과 4(포함)로 만난다", () => {
    const a = respondSettled({ "money.check.3": 3, "money.moment.1": 4 });
    const b = respondSettled({ "money.check.3": 6, "money.moment.1": 5 });
    const result = compareCouple(bank, person(a), person(b));
    expect(allCompared(result)).toBe(true);
    expect(result.similar.map((pair) => [pair.itemId, pair.firstValue, pair.secondValue])).toEqual([["money.moment.1", 4, 5]]);
  });

  it("비슷한 질문은 부호가 같고 둘 다 |값| 4 이상일 때만 뽑는다(경계 3 과 4)", () => {
    const a = respondSettled({ "money.limit.1": 4, "money.worth.3": 6, "money.check.4": -6, "money.limit.2": 3, "money.check.1": 6, "money.limit.3": 2, "money.moment.2": -4 });
    const b = respondSettled({ "money.limit.1": 6, "money.worth.3": 6, "money.check.4": -4, "money.limit.2": 6, "money.check.1": 3, "money.limit.3": 6, "money.moment.2": 2 });
    const result = compareCouple(bank, person(a), person(b));
    expect(allCompared(result)).toBe(true);
    const found = result.similar.map((pair) => pair.itemId);
    expect(found).not.toContain("money.limit.2");
    expect(found).not.toContain("money.check.1");
    expect(found).not.toContain("money.limit.3");
    expect(found).not.toContain("money.moment.2");
    expect(summary(result.similar)).toEqual(summary(referenceLists(person(a), person(b)).similar));
    // 순위는 두 값 중 작은 절댓값: worth.3 은 6, check.4 는 4, limit.1 은 4.
    expect(result.similar.map((pair) => pair.itemId)).toEqual(["money.worth.3", "money.limit.1", "money.check.4"]);
  });

  it("건너뜀, 해당 없음, 빠진 값이 한쪽에라도 있는 문항은 비교하지 않는다", () => {
    const a = respondSettled({ "money.limit.1": -6, "money.worth.3": -6, "money.check.4": -6, "money.limit.2": -6 });
    const b = respondSettled({ "money.limit.1": "skip", "money.worth.3": "na", "money.check.4": 6, "money.limit.2": 6 }, ["money.limit.2"]);
    const result = compareCouple(bank, person(a), person(b));
    expect(allCompared(result)).toBe(true);
    expect(b["money.limit.2"]).toBeUndefined();
    expect(result.talk.map((pair) => pair.itemId)).toEqual(["money.check.4"]);
    expect(result.similar).toEqual([]);
  });

  it("주제마다 하나씩 먼저 뽑고 남는 자리를 채우며 최종 목록은 차이 큰 순이다", () => {
    const a = respondSettled({
      "money.limit.1": -6, "money.worth.3": -6, "money.check.4": -6,
      "scope.final.1": 4,
      "process.owner.1": -4,
    });
    const b = respondSettled({
      "money.limit.1": 6, "money.worth.3": 6, "money.check.4": 6,
      "scope.final.1": -6,
      "process.owner.1": 4,
    });
    const result = compareCouple(bank, person(a), person(b));
    expect(allCompared(result)).toBe(true);
    // 돈에 차이 12 가 셋이나 있어도 주제마다 하나씩 먼저 뽑으므로 정하는 사람(10)과 준비(8)가 들어간다.
    expect(result.talk.map((pair) => [pair.itemId, pair.gap])).toEqual([
      ["money.limit.1", 12],
      ["scope.final.1", 10],
      ["process.owner.1", 8],
    ]);
  });

  it("주제가 셋보다 적으면 남는 자리를 같은 주제의 다음 후보가 채운다(차이 큰 순, 같으면 질문 순서)", () => {
    const a = respondSettled({ "money.limit.1": -6, "money.worth.3": -6, "money.check.4": -6, "scope.final.1": 4 });
    const b = respondSettled({ "money.limit.1": 6, "money.worth.3": 6, "money.check.4": 6, "scope.final.1": -6 });
    const result = compareCouple(bank, person(a), person(b));
    expect(allCompared(result)).toBe(true);
    // 돈의 대표(limit.1)와 정하는 사람의 대표(final.1)를 먼저 뽑고 남은 한 자리는 차이 12 중 질문 순서가 앞선 worth.3 이 채운다.
    expect(result.talk.map((pair) => [pair.itemId, pair.gap])).toEqual([
      ["money.limit.1", 12],
      ["money.worth.3", 12],
      ["scope.final.1", 10],
    ]);
    expect(summary(result.talk)).toEqual(summary(referenceLists(person(a), person(b)).talk));
  });

  it("각 항목은 문항 제목과 두 사람이 고른 답의 원문(캡션 없음)을 그대로 싣는다", () => {
    const result = compareCouple(bank, fixture("swua-example"), fixture("couple-partner"));
    expect(result.talk.length).toBeGreaterThan(0);
    for (const pair of [...result.talk, ...result.similar]) {
      const target = bank.byId.get(pair.itemId);
      if (!target) throw new Error("문항 없음");
      expect(pair.caption).toBe(target.caption);
      expect(pair.axis).toBe(target.axis);
      expect(pair.firstText).toBe(answerText(target, fixture("swua-example").responses[pair.itemId]));
      expect(pair.secondText).toBe(answerText(target, fixture("couple-partner").responses[pair.itemId]));
      expect(pair.firstText.length).toBeGreaterThan(0);
    }
  });

  it("swua-example 와 couple-partner 는 이야기해 볼 질문 셋(세 주제)과 비슷한 질문 셋을 낸다", () => {
    const result = compareCouple(bank, fixture("swua-example"), fixture("couple-partner"));
    expect(result.talk).toHaveLength(3);
    expect(new Set(result.talk.map((pair) => pair.axis)).size).toBe(3);
    expect(result.similar).toHaveLength(3);
    expect(new Set(result.similar.map((pair) => pair.axis)).size).toBeGreaterThanOrEqual(2);
    const expected = referenceLists(fixture("swua-example"), fixture("couple-partner"));
    expect(summary(result.talk)).toEqual(summary(expected.talk));
    expect(summary(result.similar)).toEqual(summary(expected.similar));
  });

  it("두 코드를 하나의 수치나 점수로 합치지 않는다(결과의 모양이 세 조각뿐이다)", () => {
    const result = compareCouple(bank, fixture("swua-example"), fixture("couple-partner"));
    expect(Object.keys(result).sort()).toEqual(["axes", "similar", "talk"]);
    for (const row of result.axes) {
      expect(Object.keys(row).sort()).toEqual(["axis", "excluded", "first", "second", "tag"]);
      expect(Object.keys(row.first).sort()).toEqual(["answered", "backCount", "facets", "frontCount", "letter", "neutralCount", "provisional", "shownBand"]);
    }
    for (const pair of [...result.talk, ...result.similar]) {
      expect(Object.keys(pair).sort()).toEqual(["axis", "caption", "facet", "firstText", "firstValue", "gap", "itemId", "prompt", "secondText", "secondValue"]);
    }
    expect(JSON.stringify(result)).not.toMatch(/total|score|match|sum/iu);
  });
});

// ---------------------------------------------------------------------------
// 비교에서 뺀 주제와 닫힌 관문: 문항 목록에도 넣지 않는다(설계 7절: 그 자리는 비교에서 뺀다)
// ---------------------------------------------------------------------------

/** 목록에 오를 만한 문항인가(두 사람 모두 유효 답이고 부호 반대 값 차이 8 이상, 또는 부호 같고 둘 다 |값| 4 이상). */
function qualifies(target: ScoredItem, first: DecodedCode, second: DecodedCode): boolean {
  const a = itemValue(target, first.responses[target.id]);
  const b = itemValue(target, second.responses[target.id]);
  if (a === null || b === null || a === 0 || b === 0) return false;
  return a * b < 0 ? Math.abs(a - b) >= COUPLE_TALK_MIN_GAP : Math.min(Math.abs(a), Math.abs(b)) >= COUPLE_SIMILAR_MIN_ABS;
}

describe("compareCouple: 비교에서 뺀 주제와 닫힌 관문", () => {
  it("글자를 못 정한 주제(유효 답 12개 미만)의 문항은 두 사람이 답했어도 목록에 넣지 않는다", () => {
    const scopeIds = bank.scoredByAxis.scope.map((target) => target.id).filter((id) => id !== "scope.final.1");
    const skips = Object.fromEntries(scopeIds.slice(0, 5).map((id) => [id, "skip" as const]));
    const a = respondSettled({ "scope.final.1": 4, "money.limit.1": -6 });
    const b = respondSettled({ "scope.final.1": -6, "money.limit.1": 6, ...skips });
    const result = compareCouple(bank, person(a), person(b));
    expect(result.axes[2]).toMatchObject({ axis: "scope", excluded: true, tag: "even" });
    expect(result.axes[2].second.letter).toBeNull();
    expect(result.axes.filter((row) => row.excluded)).toHaveLength(1);
    // scope.final.1 은 차이 10 이라 주제를 빼지 않았다면 목록에 오른다.
    expect(result.talk.map((pair) => pair.itemId)).toEqual(["money.limit.1"]);
  });

  it("임시 글자 주제의 문항도 목록에 넣지 않는다(표본 provisional-tie 와 swua-example)", () => {
    const first = fixture("provisional-tie");
    const second = fixture("swua-example");
    const result = compareCouple(bank, first, second);
    expect(result.axes[3]).toMatchObject({ axis: "support", excluded: true });
    const wouldQualify = bank.scoredByAxis.support.filter((target) => qualifies(target, first, second));
    expect(wouldQualify.length).toBeGreaterThan(0);
    for (const pair of [...result.talk, ...result.similar]) expect(pair.axis).not.toBe("support");
  });

  it("표본 열두 개의 모든 순서쌍에서 목록은 빠진 주제를 뺀 기준 구현과 같고, 빼지 않았다면 달라졌을 쌍이 실제로 있다", () => {
    let affected = 0;
    let pairsSeen = 0;
    for (const first of V40_FIXTURES) {
      for (const second of V40_FIXTURES) {
        const a = person(first.responses, first.formBit);
        const b = person(second.responses, second.formBit);
        const result = compareCouple(bank, a, b);
        const excluded = new Set(result.axes.filter((row) => row.excluded).map((row) => row.axis));
        const filtered = referenceLists(a, b);
        const unfiltered = referenceLists(a, b, { ignoreExclusion: true });
        expect(summary(result.talk), `${first.name} / ${second.name} talk`).toEqual(summary(filtered.talk));
        expect(summary(result.similar), `${first.name} / ${second.name} similar`).toEqual(summary(filtered.similar));
        for (const pair of [...result.talk, ...result.similar]) expect(excluded.has(pair.axis), `${first.name} / ${second.name} ${pair.itemId}`).toBe(false);
        // 빼지 않았다면 빠진 주제의 문항이 목록에 올랐을 쌍(이 시험이 무엇을 가르는지 보이는 표시).
        if ([...unfiltered.talk, ...unfiltered.similar].some((pair) => excluded.has(pair.axis))) affected += 1;
        pairsSeen += 1;
      }
    }
    expect(pairsSeen).toBe(144);
    expect(affected).toBeGreaterThan(20);
  });

  it("어느 쪽이든 관문이 닫혀 있으면 네 주제가 모두 빠지고 두 목록이 빈다", () => {
    const closed = fixture("rhythm-gate");
    expect(buildResult(bank, closed.formBit, closed.responses).gate).toEqual({ closed: true, reason: "rhythm" });
    const open = fixture("swua-example");
    const wouldQualify = bank.scored.filter((target) => qualifies(target, closed, open));
    expect(wouldQualify.length).toBeGreaterThan(0);
    for (const [first, second] of [[closed, open], [open, closed], [closed, closed]] as const) {
      const result = compareCouple(bank, first, second);
      expect(result.axes.every((row) => row.excluded && row.tag === "even")).toBe(true);
      expect(result.talk).toEqual([]);
      expect(result.similar).toEqual([]);
    }
  });

  it("관문이 열려 있는 짝은 주제를 빼지 않아 목록이 나온다(대조)", () => {
    const result = compareCouple(bank, fixture("swua-example"), fixture("couple-partner"));
    expect(result.axes.every((row) => !row.excluded)).toBe(true);
    expect(result.talk.length).toBeGreaterThan(0);
    expect(result.similar.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 대칭: 두 사람을 바꾸면 결과도 거울처럼 바뀐다
// ---------------------------------------------------------------------------

function mirrored(result: CoupleResult): CoupleResult {
  return {
    axes: result.axes.map((row) => ({ ...row, first: row.second, second: row.first })) as unknown as CoupleResult["axes"],
    talk: result.talk.map((pair) => ({ ...pair, firstValue: pair.secondValue, secondValue: pair.firstValue, firstText: pair.secondText, secondText: pair.firstText })),
    similar: result.similar.map((pair) => ({ ...pair, firstValue: pair.secondValue, secondValue: pair.firstValue, firstText: pair.secondText, secondText: pair.firstText })),
  };
}

describe("compareCouple: 대칭", () => {
  it("표본 열두 개의 모든 조합에서 두 사람을 바꾸면 결과가 거울처럼 바뀐다", () => {
    for (const first of V40_FIXTURES) {
      for (const second of V40_FIXTURES) {
        const a = { formBit: first.formBit, responses: first.responses };
        const b = { formBit: second.formBit, responses: second.responses };
        expect(compareCouple(bank, b, a), `${first.name} / ${second.name}`).toEqual(mirrored(compareCouple(bank, a, b)));
      }
    }
  });

  it("무작위 응답 400쌍에서 두 사람을 바꾸면 결과가 거울처럼 바뀌고 문항 목록은 기준 구현과 같다", () => {
    let talkSeen = 0;
    let similarSeen = 0;
    let differentSeen = 0;
    let sameSeen = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const a = randomPerson(seed * 2);
      const b = randomPerson(seed * 2 + 1);
      const forward = compareCouple(bank, a, b);
      expect(compareCouple(bank, b, a), `seed ${seed}`).toEqual(mirrored(forward));
      const expected = referenceLists(a, b);
      expect(summary(forward.talk), `seed ${seed} talk`).toEqual(summary(expected.talk));
      expect(summary(forward.similar), `seed ${seed} similar`).toEqual(summary(expected.similar));
      expect(forward.talk.length).toBeLessThanOrEqual(3);
      expect(forward.similar.length).toBeLessThanOrEqual(3);
      for (let index = 1; index < forward.talk.length; index += 1) expect(forward.talk[index - 1].gap).toBeGreaterThanOrEqual(forward.talk[index].gap);
      talkSeen += forward.talk.length;
      similarSeen += forward.similar.length;
      for (const row of forward.axes) {
        if (row.tag === "different") differentSeen += 1;
        if (row.tag === "same") sameSeen += 1;
        if (row.tag !== "even") expect(row.excluded).toBe(false);
        if (row.excluded) expect(row.tag).toBe("even");
      }
    }
    expect(talkSeen).toBeGreaterThan(100);
    expect(similarSeen).toBeGreaterThan(100);
    expect(differentSeen).toBeGreaterThan(20);
    expect(sameSeen).toBeGreaterThan(20);
  });

  it("문항 목록은 폼 비트와 무관하다(값은 저장 상태에서 나온다)", () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const a = randomPerson(seed * 5);
      const b = randomPerson(seed * 5 + 1);
      const base = compareCouple(bank, { formBit: 0, responses: a.responses }, { formBit: 0, responses: b.responses });
      const other = compareCouple(bank, { formBit: 1, responses: a.responses }, { formBit: 0, responses: b.responses });
      expect(other.talk).toEqual(base.talk);
      expect(other.similar).toEqual(base.similar);
    }
  });

  it("입력을 바꾸지 않는다", () => {
    const a = Object.freeze({ formBit: 0 as FormBit, responses: Object.freeze({ ...fixture("swua-example").responses }) });
    const b = Object.freeze({ formBit: 1 as FormBit, responses: Object.freeze({ ...fixture("couple-partner").responses }) });
    expect(compareCouple(bank, a, b)).toEqual(compareCouple(bank, a, b));
  });

  it("빠진 문항이 많은 부분 응답에도 던지지 않는다", () => {
    const empty = compareCouple(bank, person({}), person({}));
    expect(empty.talk).toEqual([]);
    expect(empty.similar).toEqual([]);
    expect(empty.axes.every((row) => row.excluded && row.tag === "even")).toBe(true);
    const half = compareCouple(bank, person(respond({ "money.limit.1": 6 })), fixture("swua-example"));
    expect(half.axes[0].excluded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 나 기준 전환
// ---------------------------------------------------------------------------

describe("detectPerspective", () => {
  const first = fixture("swua-example");
  const second = fixture("couple-partner");

  it("이 기기에 저장된 본인 답이 링크의 a 와 같으면 first, b 와 같으면 second", () => {
    expect(detectPerspective(bank, first, first, second)).toBe("first");
    expect(detectPerspective(bank, second, first, second)).toBe("second");
  });

  it("둘 다 아니거나 저장된 본인 답이 없으면 null 이다", () => {
    expect(detectPerspective(bank, fixture("all-clear"), first, second)).toBeNull();
    expect(detectPerspective(bank, null, first, second)).toBeNull();
  });

  it("코드로 만들 수 없는 본인 답(모두 답하지 않음)은 null 이다", () => {
    expect(detectPerspective(bank, person({}), first, second)).toBeNull();
    const partial = { formBit: first.formBit, responses: Object.fromEntries(Object.entries(first.responses).slice(0, 30)) };
    expect(detectPerspective(bank, partial, first, second)).toBeNull();
    // 링크 쪽 답도 코드로 만들 수 없으면 (코드 없음) 끼리 같다고 보고 first 나 second 라고 답하면 안 된다.
    expect(detectPerspective(bank, person({}), person({}), person({}))).toBeNull();
    expect(detectPerspective(bank, partial, partial, second)).toBeNull();
    expect(detectPerspective(bank, partial, first, partial)).toBeNull();
  });

  it("폼 비트가 다르면 같은 답이어도 다른 코드라 null 이다(70자 코드가 같은지로 가른다)", () => {
    const flipped: DecodedCode = { formBit: first.formBit === 0 ? 1 : 0, responses: first.responses };
    expect(detectPerspective(bank, flipped, first, second)).toBeNull();
  });

  it("링크 코드로 풀어낸 답과 본인 답을 견준다(왕복)", () => {
    const codeA = encodeCode(bank, first.formBit, first.responses);
    const codeB = encodeCode(bank, second.formBit, second.responses);
    const decodedA = decodeCode(bank, codeA);
    const decodedB = decodeCode(bank, codeB);
    if (!decodedA || !decodedB) throw new Error("디코드 실패");
    expect(detectPerspective(bank, first, decodedA, decodedB)).toBe("first");
    expect(detectPerspective(bank, second, decodedA, decodedB)).toBe("second");
  });

  it("두 코드가 같으면 first 로 답한다", () => {
    expect(detectPerspective(bank, first, first, first)).toBe("first");
  });

  it("결과는 두 사람 비교 결과에 영향을 주지 않는다(compareCouple 은 나 기준을 모른다)", () => {
    expect(compareCouple(bank, first, second)).toEqual(compareCouple(bank, first, second));
    expect(buildResult(bank, first.formBit, first.responses).code).toBe("SWUA");
  });
});

describe("계약", () => {
  it("coupleModule 은 compareCouple 과 detectPerspective 를 낸다", () => {
    expect(Object.keys(coupleModule).sort()).toEqual(["compareCouple", "detectPerspective"]);
  });
});
