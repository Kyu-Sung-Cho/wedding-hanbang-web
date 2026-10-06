import { describe, expect, it } from "vitest";
import { V40_AXIS_KEYS, V40_STATE_COUNTS } from "@/constants/weddingCodeV40";
import type { Axis, AxisQuotes, AxisResult, QuoteItem, ResponseValue, Responses, ScoredItem } from "./types";
import { WEDDING_CODE_V40_BANK } from "./bank";
import { V40_FIXTURES } from "./fixtures";
import { answerLabel, answerText } from "./present";
import { QUOTE_LIMITS, pickQuotes, quoteModule } from "./quote";
import { buildResult } from "./score";
import { stateChar } from "./states";
import { itemValue, stateValue } from "./value";

const bank = WEDDING_CODE_V40_BANK;

// ---------------------------------------------------------------------------
// 시험 도구
// ---------------------------------------------------------------------------

type Wanted = number | "skip" | "na";

/** 그 문항에서 원하는 값을 내는 저장 상태 문자(첫 번째 상태). 값을 낼 수 없으면 던진다. */
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

function axisResult(responses: Responses, axis: Axis, formBit: 0 | 1 = 0): AxisResult {
  return buildResult(bank, formBit, responses).axes[V40_AXIS_KEYS.indexOf(axis)];
}

const ids = (list: readonly QuoteItem[]): string[] => list.map((quote) => quote.itemId);

/** 돈 주제 16개의 원하는 값(설계 5절 예와 같은 합 -44, 글자 S 기울어요). 다른 갈래를 시험할 때 이 표를 조금씩 바꿔 쓴다. */
const MONEY: Readonly<Record<string, Wanted>> = {
  "money.limit.1": -6, "money.limit.2": -6, "money.limit.3": -2, "money.limit.4": -6,
  "money.check.1": -3, "money.check.2": 6, "money.check.3": -4, "money.check.4": -4,
  "money.worth.1": -2, "money.worth.2": 2, "money.worth.3": -6, "money.worth.4": -6,
  "money.moment.1": 4, "money.moment.2": -2, "money.moment.3": -3, "money.moment.4": -6,
};

// ---------------------------------------------------------------------------
// 독립 기준 구현: 계약 문장을 그대로 옮긴 짧은 계산(구현과 따로 쓴다)
// ---------------------------------------------------------------------------

interface Ref {
  readonly id: string;
  readonly value: number;
}

function referencePick(responses: Responses, axis: AxisResult): { kind: "settled"; own: string[]; opposite: string[] } | { kind: "even"; front: string[]; back: string[] } | { kind: "none" } {
  if (axis.shownBand === null || axis.side === null) return { kind: "none" };
  const candidates: (Ref & { facet: string; fmt: string; order: number })[] = [];
  bank.scored.forEach((target, order) => {
    if (target.axis !== axis.axis) return;
    const raw = responses[target.id];
    if (raw === undefined) return;
    const value = itemValue(target, raw);
    if (value === null || value === 0 || answerText(target, raw) === null) return;
    candidates.push({ id: target.id, value, facet: target.facet, fmt: target.fmt, order });
  });
  candidates.sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.order - b.order);
  const take = (accept: (value: number) => boolean, limit: number): string[] => {
    const facets = new Set<string>();
    const formats = new Set<string>();
    const out: string[] = [];
    for (const candidate of candidates) {
      if (out.length === limit) break;
      if (!accept(candidate.value) || facets.has(candidate.facet) || formats.has(candidate.fmt)) continue;
      facets.add(candidate.facet);
      formats.add(candidate.fmt);
      out.push(candidate.id);
    }
    return out;
  };
  if (axis.shownBand === "even") return { kind: "even", front: take((v) => v > 0, 2), back: take((v) => v < 0, 2) };
  const sign = axis.side === "front" ? 1 : -1;
  return { kind: "settled", own: take((v) => v * sign > 0, 3), opposite: take((v) => v * sign < 0 && Math.abs(v) >= 3, 2) };
}

function summarize(quotes: AxisQuotes) {
  if (quotes.kind === "none") return { kind: "none" as const };
  if (quotes.kind === "even") return { kind: "even" as const, front: ids(quotes.front), back: ids(quotes.back) };
  return { kind: "settled" as const, own: ids(quotes.own), opposite: ids(quotes.opposite) };
}

// ---------------------------------------------------------------------------
// 손으로 계산한 예
// ---------------------------------------------------------------------------

describe("pickQuotes: 기울어요 주제 (글자 쪽 답 최대 3개, 반대로 고른 답 최대 2개)", () => {
  const responses = respond(MONEY);
  const axis = axisResult(responses, "money");

  it("예의 주제는 돈 S 기울어요다(합 -44)", () => {
    expect(axis).toMatchObject({ letter: "S", side: "back", band: "lean", shownBand: "lean", sum: -44, weighted: -132 });
  });

  it("글자 쪽 답은 |값| 큰 순, 같으면 질문 순서로 훑고 측면과 형식이 겹치는 것은 건너뛴다", () => {
    // 값 -6 후보(질문 순서): limit.1(pair), limit.2(react), worth.3(pair), limit.4(bestworst), worth.4(react), moment.4(instant).
    // limit.1 을 뽑은 뒤 limit.2, limit.4 는 측면이 같고 worth.3 은 형식이 같아 건너뛴다. worth.4(react), moment.4(instant) 가 이어진다.
    const quotes = pickQuotes(bank, responses, axis);
    expect(quotes.kind).toBe("settled");
    if (quotes.kind !== "settled") return;
    expect(ids(quotes.own)).toEqual(["money.limit.1", "money.worth.4", "money.moment.4"]);
  });

  it("반대로 고른 답은 부호가 반대이고 |값| 3 이상인 것 중 최대 2개(측면과 형식이 겹치지 않게)", () => {
    const quotes = pickQuotes(bank, responses, axis);
    if (quotes.kind !== "settled") throw new Error("settled 가 아니다");
    // +6 check.2(recall), +4 moment.1(split) 이 뽑히고 worth.2 의 +2 는 |값| 3 미만이라 빠진다.
    expect(ids(quotes.opposite)).toEqual(["money.check.2", "money.moment.1"]);
    expect(quotes.opposite.every((quote) => quote.value > 0 && Math.abs(quote.value) >= 3)).toBe(true);
  });

  it("각 인용은 문항 정보와 원문, 캡션을 붙인 문장을 함께 담는다", () => {
    const quotes = pickQuotes(bank, responses, axis);
    if (quotes.kind !== "settled") throw new Error("settled 가 아니다");
    const [first] = quotes.own;
    const target = bank.byId.get("money.limit.1");
    if (!target || target.fmt === "self") throw new Error("문항 없음");
    expect(first).toEqual({
      itemId: "money.limit.1",
      caption: target.caption,
      prompt: [target.stem],
      facet: "limit",
      format: "pair",
      value: -6,
      text: answerText(target, responses["money.limit.1"]),
      label: answerLabel(target, responses["money.limit.1"]),
    });
    expect(first.label).toBe(`${target.caption}: ${first.text}`);
  });

  it("건너뜀과 해당 없음은 뽑지 않고 다음 후보가 그 자리를 채운다", () => {
    const changed = respond({ ...MONEY, "money.limit.1": "skip", "money.worth.4": "na" });
    const quotes = pickQuotes(bank, changed, axisResult(changed, "money"));
    if (quotes.kind !== "settled") throw new Error("settled 가 아니다");
    const all = [...ids(quotes.own), ...ids(quotes.opposite)];
    expect(all).not.toContain("money.limit.1");
    expect(all).not.toContain("money.worth.4");
    // limit.1 이 빠지면 limit.2(react, limit), worth.3(pair, worth), moment.4(instant, moment) 순이다.
    expect(ids(quotes.own)).toEqual(["money.limit.2", "money.worth.3", "money.moment.4"]);
  });

  it("후보가 모자라면 모자란 대로 낸다(형식이 둘뿐이면 둘)", () => {
    const plan: Record<string, Wanted> = {};
    for (const target of bank.scoredByAxis.money) {
      if (target.fmt === "pair") plan[target.id] = -6;
      else if (target.fmt === "react") plan[target.id] = -6;
      else if (target.fmt === "split") plan[target.id] = 0;
      else plan[target.id] = 2;
    }
    const changed = respond(plan);
    const result = axisResult(changed, "money");
    expect(result).toMatchObject({ side: "back", shownBand: "lean" });
    const quotes = pickQuotes(bank, changed, result);
    if (quotes.kind !== "settled") throw new Error("settled 가 아니다");
    expect(quotes.own.map((quote) => quote.format).sort()).toEqual(["pair", "react"]);
    expect(quotes.opposite).toEqual([]);
  });

  it("값이 0 인 답(가운데 칸, 균등 나누기)은 뽑지 않는다", () => {
    const plan: Record<string, Wanted> = { ...MONEY, "money.check.1": 0, "money.moment.1": 0 };
    const changed = respond(plan);
    const quotes = pickQuotes(bank, changed, axisResult(changed, "money"));
    if (quotes.kind !== "settled") throw new Error("settled 가 아니다");
    expect([...quotes.own, ...quotes.opposite].every((quote) => quote.value !== 0)).toBe(true);
    expect(ids(quotes.opposite)).not.toContain("money.moment.1");
  });
});

describe("pickQuotes: 앞 글자 쪽 (부호 규칙)", () => {
  it("앞 글자(V)가 나온 주제는 양수 값이 글자 쪽이고 음수 값(3 이상)이 반대쪽이다", () => {
    const flipped: Record<string, Wanted> = {};
    for (const [id, wanted] of Object.entries(MONEY)) flipped[id] = typeof wanted === "number" ? -wanted : wanted;
    const responses = respond(flipped);
    const axis = axisResult(responses, "money");
    expect(axis).toMatchObject({ letter: "V", side: "front", shownBand: "lean" });
    const quotes = pickQuotes(bank, responses, axis);
    if (quotes.kind !== "settled") throw new Error("settled 가 아니다");
    expect(ids(quotes.own)).toEqual(["money.limit.1", "money.worth.4", "money.moment.4"]);
    expect(quotes.own.every((quote) => quote.value > 0)).toBe(true);
    expect(quotes.opposite.every((quote) => quote.value < 0)).toBe(true);
    expect(ids(quotes.opposite)).toEqual(["money.check.2", "money.moment.1"]);
  });
});

describe("pickQuotes: 반반이에요와 글자를 못 정한 주제", () => {
  it("반반이에요 주제는 앞쪽 답과 뒤쪽 답을 각각 최대 2개, |값| 조건 없이 뽑는다", () => {
    // 합을 -44 에서 -8 로 돌린다: 뒤쪽이던 큰 값 셋(limit.2, worth.3, moment.4)을 앞쪽으로 뒤집는다.
    const responses = respond({ ...MONEY, "money.limit.2": 6, "money.worth.3": 6, "money.moment.4": 6 });
    const axis = axisResult(responses, "money");
    expect(axis).toMatchObject({ sum: -8, shownBand: "even", side: "back" });
    const quotes = pickQuotes(bank, responses, axis);
    if (quotes.kind !== "even") throw new Error("even 이 아니다");
    // 앞쪽 +6 후보(질문 순서): limit.2(react), check.2(recall), worth.3(pair), moment.4(instant). 앞의 둘이 뽑힌다.
    expect(ids(quotes.front)).toEqual(["money.limit.2", "money.check.2"]);
    // 뒤쪽 -6 후보: limit.1(pair), limit.4(bestworst, 측면 limit 이 겹침), worth.4(react). limit.1 과 worth.4 가 뽑힌다.
    expect(ids(quotes.back)).toEqual(["money.limit.1", "money.worth.4"]);
    expect(quotes.front.every((quote) => quote.value > 0)).toBe(true);
    expect(quotes.back.every((quote) => quote.value < 0)).toBe(true);
    expect(summarize(quotes)).toEqual(referencePick(responses, axis));
  });

  it("반반이에요는 작은 값(|값| 3 미만)도 뽑는다", () => {
    const plan: Record<string, Wanted> = {};
    for (const target of bank.scoredByAxis.money) plan[target.id] = target.fmt === "react" ? 3 : 2;
    plan["money.limit.3"] = -2;
    plan["money.check.2"] = -2;
    plan["money.worth.1"] = -2;
    plan["money.moment.4"] = -2;
    plan["money.limit.2"] = -3;
    plan["money.moment.3"] = -3;
    plan["money.check.1"] = -3;
    plan["money.worth.4"] = -3;
    const responses = respond(plan);
    const axis = axisResult(responses, "money");
    expect(axis.shownBand).toBe("even");
    const quotes = pickQuotes(bank, responses, axis);
    if (quotes.kind !== "even") throw new Error("even 이 아니다");
    expect(quotes.front.some((quote) => Math.abs(quote.value) < 3)).toBe(true);
    expect(summarize(quotes)).toEqual(referencePick(responses, axis));
  });

  it("건너뜀으로 세기가 한 단계 낮춰진 주제는 낮춰진 세기(shownBand)를 따른다", () => {
    const fixture = V40_FIXTURES.find((entry) => entry.name === "rhythm-hint")!;
    const result = buildResult(bank, fixture.formBit, fixture.responses);
    const money = result.axes[0];
    expect(money.band).toBe("clear");
    expect(money.shownBand).toBe("lean");
    expect(pickQuotes(bank, fixture.responses, money).kind).toBe("settled");
    const process = result.axes[1];
    expect(process.band).toBe("lean");
    expect(process.shownBand).toBe("even");
    expect(pickQuotes(bank, fixture.responses, process).kind).toBe("even");
  });

  it("글자를 못 정한 주제는 none 이다", () => {
    const fixture = V40_FIXTURES.find((entry) => entry.name === "unusable-axis")!;
    const scope = buildResult(bank, fixture.formBit, fixture.responses).axes[2];
    expect(scope.unusable).toBe(true);
    expect(pickQuotes(bank, fixture.responses, scope)).toEqual({ kind: "none" });
  });

  it("임시 글자(동점 사슬 끝)는 반반이에요로 앞쪽과 뒤쪽 답을 같은 무게로 낸다", () => {
    const fixture = V40_FIXTURES.find((entry) => entry.name === "provisional-tie")!;
    const support = buildResult(bank, fixture.formBit, fixture.responses).axes[3];
    expect(support.provisional).toBe(true);
    const quotes = pickQuotes(bank, fixture.responses, support);
    expect(quotes.kind).toBe("even");
    if (quotes.kind === "even") expect(quotes.front.length + quotes.back.length).toBeGreaterThan(0);
  });
});

describe("pickQuotes: 고정 표본 열두 개", () => {
  it("모든 표본의 모든 주제에서 기준 구현과 같은 답을 낸다", () => {
    for (const fixture of V40_FIXTURES) {
      const result = buildResult(bank, fixture.formBit, fixture.responses);
      for (const axis of result.axes) {
        const quotes = pickQuotes(bank, fixture.responses, axis);
        expect(summarize(quotes), `${fixture.name} ${axis.axis}`).toEqual(referencePick(fixture.responses, axis));
      }
    }
  });

  it("swua-example 의 돈 주제는 문서 예시처럼 글자 쪽 답 셋과 반대로 고른 답을 갖는다", () => {
    const fixture = V40_FIXTURES.find((entry) => entry.name === "swua-example")!;
    const money = buildResult(bank, fixture.formBit, fixture.responses).axes[0];
    const quotes = pickQuotes(bank, fixture.responses, money);
    if (quotes.kind !== "settled") throw new Error("settled 가 아니다");
    expect(quotes.own).toHaveLength(3);
    expect(quotes.opposite.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 무작위 응답: 성질과 기준 구현 대조
// ---------------------------------------------------------------------------

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

function randomResponses(seed: number): Responses {
  const rng = mulberry32(seed);
  const skipRate = [0, 0.05, 0.2, 0.45][seed % 4];
  const sides = V40_AXIS_KEYS.map(() => (rng() < 0.5 ? 1 : -1));
  const responses: Record<string, ResponseValue> = {};
  for (const target of bank.items) {
    const roll = rng();
    if (roll < 0.02) continue;
    if (roll < 0.02 + skipRate) {
      responses[target.id] = "skip";
      continue;
    }
    if (roll < 0.06 + skipRate) {
      responses[target.id] = "na";
      continue;
    }
    const count = V40_STATE_COUNTS[target.fmt];
    let state = Math.floor(rng() * count);
    if (target.fmt !== "self" && seed % 3 !== 0) {
      const persona = sides[V40_AXIS_KEYS.indexOf(target.axis)];
      for (let retry = 0; retry < 4 && stateValue(target, state) * persona <= 0; retry += 1) state = Math.floor(rng() * count);
    }
    responses[target.id] = stateChar(state);
  }
  return responses;
}

describe("pickQuotes: 무작위 응답 600명 x 4주제", () => {
  it("개수 상한, 겹침 없음, 부호, 빠진 값 제외, 기준 구현과의 일치가 언제나 성립한다", () => {
    const kinds = { settled: 0, even: 0, none: 0 };
    let oppositeSeen = 0;
    for (let seed = 1; seed <= 600; seed += 1) {
      const responses = randomResponses(seed);
      const frozen = Object.freeze({ ...responses });
      const result = buildResult(bank, (seed % 2) as 0 | 1, frozen);
      for (const axis of result.axes) {
        const quotes = pickQuotes(bank, frozen, axis);
        kinds[quotes.kind] += 1;
        expect(summarize(quotes), `seed ${seed} ${axis.axis}`).toEqual(referencePick(frozen, axis));
        const lists = quotes.kind === "settled" ? [quotes.own, quotes.opposite] : quotes.kind === "even" ? [quotes.front, quotes.back] : [];
        for (const list of lists) {
          expect(new Set(list.map((quote) => quote.facet)).size).toBe(list.length);
          expect(new Set(list.map((quote) => quote.format)).size).toBe(list.length);
          for (const quote of list) {
            const target = bank.byId.get(quote.itemId);
            expect(target?.axis).toBe(axis.axis);
            expect(["skip", "na", undefined]).not.toContain(frozen[quote.itemId]);
            expect(quote.value).not.toBe(0);
            expect(quote.text.length).toBeGreaterThan(0);
            expect(quote.label.endsWith(quote.text)).toBe(true);
          }
          for (let index = 1; index < list.length; index += 1) expect(Math.abs(list[index - 1].value)).toBeGreaterThanOrEqual(Math.abs(list[index].value));
        }
        if (quotes.kind === "settled") {
          expect(quotes.own.length).toBeLessThanOrEqual(QUOTE_LIMITS.own);
          expect(quotes.opposite.length).toBeLessThanOrEqual(QUOTE_LIMITS.opposite);
          const sign = axis.side === "front" ? 1 : -1;
          expect(quotes.own.every((quote) => quote.value * sign > 0)).toBe(true);
          expect(quotes.opposite.every((quote) => quote.value * sign < 0 && Math.abs(quote.value) >= QUOTE_LIMITS.oppositeMinAbs)).toBe(true);
          oppositeSeen += quotes.opposite.length;
        }
        if (quotes.kind === "even") {
          expect(quotes.front.length).toBeLessThanOrEqual(QUOTE_LIMITS.evenEach);
          expect(quotes.back.length).toBeLessThanOrEqual(QUOTE_LIMITS.evenEach);
          expect(quotes.front.every((quote) => quote.value > 0)).toBe(true);
          expect(quotes.back.every((quote) => quote.value < 0)).toBe(true);
        }
        if (axis.shownBand === null) expect(quotes.kind).toBe("none");
      }
    }
    expect(kinds.settled).toBeGreaterThan(200);
    expect(kinds.even).toBeGreaterThan(100);
    expect(kinds.none).toBeGreaterThan(20);
    expect(oppositeSeen).toBeGreaterThan(100);
  });

  it("같은 입력에는 같은 답이 나오고 입력을 바꾸지 않는다", () => {
    const responses = Object.freeze(respond(MONEY));
    const axis = Object.freeze(axisResult(responses, "money"));
    expect(pickQuotes(bank, responses, axis)).toEqual(pickQuotes(bank, responses, axis));
  });
});

describe("계약", () => {
  it("quoteModule 은 pickQuotes 하나를 낸다", () => {
    expect(Object.keys(quoteModule)).toEqual(["pickQuotes"]);
    expect(quoteModule.pickQuotes).toBe(pickQuotes);
  });
});
