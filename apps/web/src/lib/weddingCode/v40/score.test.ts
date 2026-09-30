import { describe, expect, it } from "vitest";
import { V40_AXIS_KEYS, V40_STATE_COUNTS, V40_UNSET_LETTER_MARK, demoteBand } from "@/constants/weddingCodeV40";
import type { Axis, FormBit, Item, ResponseValue, Responses, ScoredFormat, ScoredItem, Side, StrengthBand, V40Result } from "./types";
import { WEDDING_CODE_V40_BANK } from "./bank";
import { V40_LAYOUT_BY_ID } from "./layout";
import { toStored } from "./present";
import { buildResult, scoreModule, scoreResponses } from "./score";
import { stateChar } from "./states";
import { itemValue } from "./value";

const bank = WEDDING_CODE_V40_BANK;

// ---------------------------------------------------------------------------
// 시험용 도구: 구현과 따로, 배치 골격의 키와 형식표에서 값 -> 상태를 찾는다
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

/** 그 문항에서 원하는 값을 내는 저장 상태 문자. 그 값을 낼 수 없으면 던진다(시험 자료가 틀린 것이다). */
function stateForValue(item: ScoredItem, wanted: number): string {
  const key = V40_LAYOUT_BY_ID.get(item.id)!.key;
  const state = expectedTable(item.fmt, key).indexOf(wanted);
  if (state < 0) throw new Error(`${item.id}(${item.fmt}, 키 ${key})는 값 ${wanted} 를 낼 수 없다`);
  return stateChar(state);
}

/** 자기 선택 상태: 위 카드 아주, 꽤, 조금 = 0, 1, 2 / 아래 카드 조금, 꽤, 아주 = 3, 4, 5. 고른 방향과 세기(1에서 3)로 찾는다. */
function selfState(axis: Axis, side: Side, level: 1 | 2 | 3): string {
  const key = V40_LAYOUT_BY_ID.get(`self.${axis}`)!.key;
  const topSide: Side = key === 1 ? "front" : "back";
  return stateChar(side === topSide ? 3 - level : 2 + level);
}

type Wanted = number | "skip" | "na";

/** id -> 원하는 값(또는 skip, na)으로 응답을 만든다. 적지 않은 문항은 답하지 않은 것이다. */
function respond(plan: Readonly<Record<string, Wanted>>, extra: Readonly<Record<string, ResponseValue>> = {}): Responses {
  const responses: Record<string, ResponseValue> = {};
  for (const [id, wanted] of Object.entries(plan)) {
    const item = bank.byId.get(id);
    if (!item || item.fmt === "self") throw new Error(`채점 문항이 아니다: ${id}`);
    responses[id] = wanted === "skip" || wanted === "na" ? wanted : stateForValue(item, wanted);
  }
  return { ...responses, ...extra };
}

/** 돈 주제 16개를 짧은 이름(limit.1 ...)으로 적은 값에서 응답을 만든다. */
function money(values: Readonly<Record<string, Wanted>>, extra: Readonly<Record<string, ResponseValue>> = {}): Responses {
  return respond(Object.fromEntries(Object.entries(values).map(([name, wanted]) => [`money.${name}`, wanted])), extra);
}

const MONEY_FORMATS: Readonly<Record<string, string>> = {
  "limit.1": "pair", "limit.2": "react", "limit.3": "recall", "limit.4": "bestworst",
  "check.1": "react", "check.2": "recall", "check.3": "split", "check.4": "pair",
  "worth.1": "instant", "worth.2": "bestworst", "worth.3": "pair", "worth.4": "react",
  "moment.1": "split", "moment.2": "pair", "moment.3": "react", "moment.4": "instant",
};

const moneyScore = (responses: Responses) => scoreResponses(bank, responses).axes[0];

/** 돈 주제 문항 name 이 낼 수 있는 작은 앞극 값: 이럴 때는 +3, 나머지는 +2. */
const small = (name: string): number => (MONEY_FORMATS[name] === "react" ? 3 : 2);

describe("손계산 예제 열두 개(돈 주제, 정수로 계산)", () => {
  it("돈 주제 16개의 형식 구성이 예제의 가정과 같다", () => {
    for (const [name, fmt] of Object.entries(MONEY_FORMATS)) expect(bank.byId.get(`money.${name}`)?.fmt, name).toBe(fmt);
    expect(Object.keys(MONEY_FORMATS)).toHaveLength(16);
  });

  it("예제 1 (설계 5절 예): 측면 합 -15, +10, -24, -15 = -44, N = -132, m = 4, S = -132 / 288 = -0.458 -> 글자 S, 기울어요", () => {
    const axis = moneyScore(
      money({
        "limit.1": -4, "limit.2": -3, "limit.3": -2, "limit.4": -6,
        "check.1": 3, "check.2": 2, "check.3": 1, "check.4": 4,
        "worth.1": -6, "worth.2": -6, "worth.3": -6, "worth.4": -6,
        "moment.1": -2, "moment.2": -4, "moment.3": -3, "moment.4": -6,
      }),
    );
    expect(axis.facets.map((facet) => facet.sum)).toEqual([-15, 10, -24, -15]);
    expect(axis.facets.map((facet) => facet.answered)).toEqual([4, 4, 4, 4]);
    expect(axis.sum).toBe(-44);
    expect(axis.answered).toBe(16);
    expect(axis.countedFacets).toBe(4);
    expect(axis.weighted).toBe(-132);
    expect(axis.s).toBeCloseTo(-132 / 288, 12);
    expect(axis.s).toBeCloseTo(-0.4583333, 6);
    expect(axis).toMatchObject({ unusable: false, side: "back", letter: "S", tieLevel: 0, provisional: false, band: "lean" });
  });

  it("예제 2: 모두 앞극 쪽 가장 센 답(+6 이 열여섯 개)이면 N = 288, S = 1, 뚜렷해요", () => {
    const values = Object.fromEntries(Object.keys(MONEY_FORMATS).map((name) => [name, 6]));
    const axis = moneyScore(money(values));
    expect(axis.facets.map((facet) => facet.sum)).toEqual([24, 24, 24, 24]);
    expect(axis.sum).toBe(96);
    expect(axis.weighted).toBe(288);
    expect(axis.s).toBe(1);
    expect(axis).toMatchObject({ letter: "V", side: "front", band: "clear", tieLevel: 0 });
  });

  const base48 = {
    "limit.1": 6, "limit.2": 6, "limit.3": 6, "limit.4": 6,
    "check.1": 6, "check.2": 6, "check.3": 6, "check.4": 6,
    "worth.1": 2, "worth.2": -2, "worth.3": 2, "worth.4": 0,
    "moment.1": -2, "moment.2": 2, "moment.3": 0, "moment.4": -2,
  };

  it("예제 3: 뚜렷해요 경계 위 - 합 48, N = 144 = 36 x 4 이면 뚜렷해요", () => {
    const axis = moneyScore(money(base48));
    expect(axis.facets.map((facet) => facet.sum)).toEqual([24, 24, 2, -2]);
    expect(axis.sum).toBe(48);
    expect(axis.weighted).toBe(144);
    expect(axis.band).toBe("clear");
    expect(axis.letter).toBe("V");
  });

  it("예제 4: 뚜렷해요 경계 바로 아래 - 합 47, N = 141 이면 기울어요", () => {
    const axis = moneyScore(money({ ...base48, "moment.1": -3 }));
    expect(axis.sum).toBe(47);
    expect(axis.weighted).toBe(141);
    expect(axis.band).toBe("lean");
    expect(axis.letter).toBe("V");
  });

  const baseMinus24 = {
    "limit.1": -6, "limit.2": -6, "limit.3": -6, "limit.4": -6,
    "check.1": 0, "check.2": 2, "check.3": 0, "check.4": -2,
    "worth.1": 2, "worth.2": 2, "worth.3": -4, "worth.4": 0,
    "moment.1": 0, "moment.2": 2, "moment.3": 0, "moment.4": -2,
  };

  it("예제 5: 기울어요 경계 위 - 합 -24, N = -72 = -18 x 4 이면 기울어요, 글자 S", () => {
    const axis = moneyScore(money(baseMinus24));
    expect(axis.facets.map((facet) => facet.sum)).toEqual([-24, 0, 0, 0]);
    expect(axis.weighted).toBe(-72);
    expect(axis).toMatchObject({ band: "lean", letter: "S", side: "back", tieLevel: 0 });
  });

  it("예제 6: 기울어요 경계 바로 아래 - 합 -23, N = -69 이면 반반이에요(동점은 아니다), 글자는 S", () => {
    const axis = moneyScore(money({ ...baseMinus24, "moment.1": 1 }));
    expect(axis.sum).toBe(-23);
    expect(axis.weighted).toBe(-69);
    expect(axis).toMatchObject({ band: "even", letter: "S", tieLevel: 0, provisional: false });
  });

  it("예제 7: 동점 1단계 - N = 0 이고 고르기 합 +4 이면 앞 글자 V, 반반이에요", () => {
    const axis = moneyScore(
      money({
        "limit.1": -2, "limit.2": -3, "limit.3": 2, "limit.4": -2,
        "check.1": 0, "check.2": 2, "check.3": -2, "check.4": 2,
        "worth.1": -2, "worth.2": 2, "worth.3": -2, "worth.4": 3,
        "moment.1": 2, "moment.2": -2, "moment.3": 0, "moment.4": 2,
      }),
    );
    expect(axis.facets.map((facet) => facet.sum)).toEqual([-5, 2, 1, 2]);
    expect(axis.weighted).toBe(0);
    expect(axis).toMatchObject({ tieLevel: 1, side: "front", letter: "V", band: "even", provisional: false });
  });

  it("예제 8: 동점 2단계 - N = 0, 고르기 합 0, 이럴 때 합 -6 이면 뒤 글자 S", () => {
    const axis = moneyScore(
      money({
        "limit.1": 4, "limit.2": -3, "limit.3": 2, "limit.4": 2,
        "check.1": -3, "check.2": -2, "check.3": 2, "check.4": -2,
        "worth.1": -2, "worth.2": -2, "worth.3": 2, "worth.4": 0,
        "moment.1": 2, "moment.2": -2, "moment.3": 0, "moment.4": 2,
      }),
    );
    expect(axis.facets.map((facet) => facet.sum)).toEqual([5, -5, -2, 2]);
    expect(axis.weighted).toBe(0);
    expect(axis).toMatchObject({ tieLevel: 2, side: "back", letter: "S", band: "even", provisional: false });
  });

  it("예제 9: 동점 3단계 - N = 0, 고르기 합 0, 이럴 때 합 0, 측면 합 +4, +2, -6, 0 이면 양이 음보다 많아 앞 글자 V", () => {
    const axis = moneyScore(
      money({
        "limit.1": 4, "limit.2": 0, "limit.3": 2, "limit.4": -2,
        "check.1": 0, "check.2": -2, "check.3": 2, "check.4": 2,
        "worth.1": -2, "worth.2": -2, "worth.3": -2, "worth.4": 0,
        "moment.1": 0, "moment.2": -2, "moment.3": 0, "moment.4": 2,
      }),
    );
    expect(axis.facets.map((facet) => facet.sum)).toEqual([4, 2, -6, 0]);
    expect(axis.weighted).toBe(0);
    expect(axis).toMatchObject({ tieLevel: 3, side: "front", letter: "V", band: "even", provisional: false });
  });

  const tie4 = {
    "limit.1": 2, "limit.2": 0, "limit.3": 2, "limit.4": -2,
    "check.1": 0, "check.2": -2, "check.3": 2, "check.4": -2,
    "worth.1": 2, "worth.2": 2, "worth.3": -4, "worth.4": 0,
    "moment.1": 0, "moment.2": 2, "moment.3": 0, "moment.4": -2,
  };

  it("예제 10: 동점 4단계 - 측면 합 +2, -2, 0, 0 은 양과 음이 같아서 자기 선택(뒤쪽 꽤)으로 뒤 글자 S", () => {
    const responses = money(tie4, { "self.money": selfState("money", "back", 2) });
    const axis = moneyScore(responses);
    expect(axis.facets.map((facet) => facet.sum)).toEqual([2, -2, 0, 0]);
    expect(axis.weighted).toBe(0);
    expect(axis).toMatchObject({ tieLevel: 4, side: "back", letter: "S", band: "even", provisional: false });
    // 자기 선택이 앞쪽이면 앞 글자
    const front = moneyScore(money(tie4, { "self.money": selfState("money", "front", 1) }));
    expect(front).toMatchObject({ tieLevel: 4, side: "front", letter: "V", provisional: false });
  });

  it("예제 11: 동점 5단계 - 같은 응답에서 자기 선택을 건너뛰면(또는 답하지 않으면) 앞 글자 V 를 임시로 적는다", () => {
    for (const extra of [{ "self.money": "skip" }, { "self.money": "na" }, {}] as Record<string, ResponseValue>[]) {
      const axis = moneyScore(money(tie4, extra));
      expect(axis.weighted).toBe(0);
      expect(axis).toMatchObject({ tieLevel: 5, side: "front", letter: "V", band: "even", provisional: true, unusable: false });
    }
  });

  it("예제 12: 답이 13개 - 유효 답 수가 4, 3, 2, 4 인 측면의 가중치 3, 4, 6, 3 으로 N = 33 + 12 - 6 - 6 = 33, 반반이에요", () => {
    const axis = moneyScore(
      money({
        "limit.1": 4, "limit.2": 3, "limit.3": -2, "limit.4": 6,
        "check.1": 3, "check.2": 2, "check.3": "skip", "check.4": -2,
        "worth.1": "na", "worth.2": "skip", "worth.3": -4, "worth.4": 3,
        "moment.1": 1, "moment.2": -2, "moment.3": -3, "moment.4": 2,
      }),
    );
    expect(axis.answered).toBe(13);
    expect(axis.skipped).toBe(2);
    expect(axis.notApplicable).toBe(1);
    expect(axis.facets.map((facet) => facet.answered)).toEqual([4, 3, 2, 4]);
    expect(axis.facets.map((facet) => facet.sum)).toEqual([11, 3, -1, -2]);
    expect(axis.facets.map((facet) => facet.counted)).toEqual([true, true, true, true]);
    expect(axis.sum).toBe(11);
    expect(axis.countedFacets).toBe(4);
    expect(axis.weighted).toBe(33);
    expect(axis).toMatchObject({ side: "front", letter: "V", band: "even", tieLevel: 0, unusable: false });
  });

  it("예제 13: 동점 1단계의 고르기 합에는 그때 나는(instant) 답도 들어간다 - 떠올리기 합 0, 그때 나는 합 +8 이면 앞 글자 V, 부호를 뒤집으면 뒤 글자 S", () => {
    for (const sign of [1, -1] as const) {
      const axis = moneyScore(
        money({
          "limit.1": -2 * sign, "limit.2": 0, "limit.3": 2 * sign, "limit.4": 2 * sign,
          "check.1": 0, "check.2": -2 * sign, "check.3": 0, "check.4": -2 * sign,
          "worth.1": 6 * sign, "worth.2": -2 * sign, "worth.3": -2 * sign, "worth.4": 0,
          "moment.1": 0, "moment.2": -2 * sign, "moment.3": 0, "moment.4": 2 * sign,
        }),
      );
      expect(axis.weighted, `부호 ${sign}`).toBe(0);
      // 떠올리기(limit.3, check.2)는 합 0, 그때 나는(worth.1, moment.4)이 +8 x 부호 - 동점 1단계는 이 둘을 합쳐 본다
      expect(axis, `부호 ${sign}`).toMatchObject({ tieLevel: 1, side: sign === 1 ? "front" : "back", letter: sign === 1 ? "V" : "S", band: "even", provisional: false });
    }
  });

  /**
   * 돈 밖의 세 주제 손계산: 측면 합이 모두 0, 고르기 합 0, 이럴 때 합 0 이라 동점 3단계까지도 갈리지 않고 자기 선택(4단계)이 정한다.
   * 이름은 주제.측면.구간 번호(1에서 4)이고 값은 그 문항이 낼 수 있는 값이다.
   */
  const TIE4_PLANS: Readonly<Record<"process" | "scope" | "support", Readonly<Record<string, Wanted>>>> = {
    process: {
      "process.search.1": 0, "process.search.2": 2, "process.search.3": 2, "process.search.4": -4,
      "process.owner.1": 2, "process.owner.2": 0, "process.owner.3": 2, "process.owner.4": -4,
      "process.report.1": -2, "process.report.2": 4, "process.report.3": 0, "process.report.4": -2,
      "process.detail.1": -2, "process.detail.2": 0, "process.detail.3": 2, "process.detail.4": 0,
    },
    scope: {
      "scope.final.1": 2, "scope.final.2": 0, "scope.final.3": -2, "scope.final.4": 0,
      "scope.circle.1": 2, "scope.circle.2": -4, "scope.circle.3": 0, "scope.circle.4": 2,
      "scope.timing.1": -2, "scope.timing.2": 0, "scope.timing.3": 2, "scope.timing.4": 0,
      "scope.form.1": 0, "scope.form.2": 2, "scope.form.3": -6, "scope.form.4": 4,
    },
    support: {
      "support.vent.1": 0, "support.vent.2": 2, "support.vent.3": 0, "support.vent.4": -2,
      "support.give.1": 0, "support.give.2": 2, "support.give.3": 0, "support.give.4": -2,
      "support.fight.1": -4, "support.fight.2": 0, "support.fight.3": 2, "support.fight.4": 2,
      "support.recover.1": -2, "support.recover.2": 6, "support.recover.3": -4, "support.recover.4": 0,
    },
  };

  it("예제 14: 동점 3단계 다수결은 세는 측면만 본다 - 답이 1개뿐인 측면의 부호는 다수결에 들어가지 않아 4단계 자기 선택이 정한다", () => {
    // 측면 합 +2, -2, 0 은 세는 측면이고 moment 는 답이 1개(+2)뿐이라 세지 않는다. N = 3 x (2 - 2 + 0) = 0,
    // 고르기 합(limit.3, check.2, worth.1, moment.4) = 2 - 2 - 2 + 2 = 0, 이럴 때 합 0. 양 1 음 1 이라 3단계에서 갈리지 않는다.
    const plan = {
      "limit.1": 2, "limit.2": 0, "limit.3": 2, "limit.4": -2,
      "check.1": 0, "check.2": -2, "check.3": 2, "check.4": -2,
      "worth.1": -2, "worth.2": -2, "worth.3": 4, "worth.4": 0,
      "moment.4": 2,
    };
    for (const [side, letter] of [["back", "S"], ["front", "V"]] as const) {
      const axis = moneyScore(money(plan, { "self.money": selfState("money", side, 2) }));
      expect(axis.facets.map((facet) => facet.answered)).toEqual([4, 4, 4, 1]);
      expect(axis.facets.map((facet) => facet.sum)).toEqual([2, -2, 0, 2]);
      expect(axis.facets.map((facet) => facet.counted)).toEqual([true, true, true, false]);
      expect(axis.weighted).toBe(0);
      expect(axis, side).toMatchObject({ tieLevel: 4, side, letter, band: "even", provisional: false, unusable: false });
    }
  });

  it("예제 15: 동점 4단계는 돈 밖의 세 주제에서도 그 주제의 자기 선택으로 글자를 정하고, 자기 선택이 없으면 5단계 임시 글자다", () => {
    const letters = { process: ["W", "D"], scope: ["U", "F"], support: ["H", "A"] } as const;
    for (const axis of ["process", "scope", "support"] as const) {
      const at = (extra: Record<string, ResponseValue>) => scoreResponses(bank, respond(TIE4_PLANS[axis], extra)).axes[V40_AXIS_KEYS.indexOf(axis)];
      // 다른 주제(돈)의 자기 선택은 일부러 반대로 눌러 둔다: 그 주제 것을 읽으면 결과가 뒤집힌다
      const back = at({ [`self.${axis}`]: selfState(axis, "back", 2), "self.money": selfState("money", "front", 3) });
      expect(back.facets.map((facet) => facet.sum), axis).toEqual([0, 0, 0, 0]);
      expect(back.weighted, axis).toBe(0);
      expect(back, axis).toMatchObject({ tieLevel: 4, side: "back", letter: letters[axis][1], band: "even", provisional: false });
      const front = at({ [`self.${axis}`]: selfState(axis, "front", 1), "self.money": selfState("money", "back", 3) });
      expect(front, axis).toMatchObject({ tieLevel: 4, side: "front", letter: letters[axis][0], provisional: false });
      const none = at({ "self.money": selfState("money", "back", 3) });
      expect(none, axis).toMatchObject({ tieLevel: 5, side: "front", letter: letters[axis][0], provisional: true });
    }
  });
});

describe("경계: 세는 측면 수 m 에 따른 정수 임계 |N| >= 36 m 와 |N| >= 18 m", () => {
  /** 측면 moment 를 통째로 건너뛰어 답 12개, 세는 측면 3개를 만든다. 합은 limit + check + worth. */
  const three = (limit: Record<string, number>, check: Record<string, number>, worth: Record<string, number>) => {
    const plan: Record<string, Wanted> = { "moment.1": "skip", "moment.2": "skip", "moment.3": "skip", "moment.4": "skip" };
    for (const [name, value] of Object.entries(limit)) plan[`limit.${name}`] = value;
    for (const [name, value] of Object.entries(check)) plan[`check.${name}`] = value;
    for (const [name, value] of Object.entries(worth)) plan[`worth.${name}`] = value;
    return money(plan);
  };
  const limit24 = { "1": 6, "2": 6, "3": 6, "4": 6 };

  it("m = 3: 합 36 -> N = 108 = 36 x 3 뚜렷해요, 합 35 -> N = 105 기울어요", () => {
    const worth = { "1": 2, "2": -2, "3": 2, "4": 0 };
    const clear = moneyScore(three(limit24, { "1": 3, "2": 2, "3": 3, "4": 2 }, worth));
    expect(clear).toMatchObject({ answered: 12, countedFacets: 3, sum: 36, weighted: 108, band: "clear", unusable: false });
    const lean = moneyScore(three(limit24, { "1": 3, "2": 2, "3": 2, "4": 2 }, worth));
    expect(lean).toMatchObject({ sum: 35, weighted: 105, band: "lean" });
  });

  it("m = 3: 합 18 -> N = 54 = 18 x 3 기울어요, 합 17 -> N = 51 반반이에요", () => {
    const limit = { "1": 2, "2": 3, "3": 2, "4": 2 };
    const worth = { "1": 2, "2": 2, "3": -2, "4": 0 };
    const lean = moneyScore(three(limit, { "1": 3, "2": 2, "3": 0, "4": 2 }, worth));
    expect(lean).toMatchObject({ sum: 18, weighted: 54, band: "lean", tieLevel: 0 });
    const even = moneyScore(three(limit, { "1": 3, "2": 2, "3": -1, "4": 2 }, worth));
    expect(even).toMatchObject({ sum: 17, weighted: 51, band: "even", tieLevel: 0 });
  });

  it("세는 측면이 3개라도 답이 12개 미만이면 글자를 만들지 않는다", () => {
    const plan: Record<string, Wanted> = {};
    for (const name of Object.keys(MONEY_FORMATS)) plan[name] = name.startsWith("moment") ? "skip" : small(name);
    plan["limit.4"] = "skip"; // 답 11개
    const axis = moneyScore(money(plan));
    expect(axis).toMatchObject({ answered: 11, unusable: true, weighted: null, s: null, side: null, letter: null, tieLevel: null, band: null, provisional: false });
  });

  it("세는 측면이 2개뿐이면 답이 몇 개든 글자를 만들지 않는다", () => {
    // 측면 둘에 4개씩 8개만 답하면 답이 12개 미만이기도 하다. 측면 하나에 1개만 답한 경우는 세지 않는 측면이다.
    const plan: Record<string, Wanted> = {};
    for (const name of Object.keys(MONEY_FORMATS)) plan[name] = name.startsWith("limit") || name.startsWith("check") ? small(name) : "skip";
    const axis = moneyScore(money(plan));
    expect(axis.countedFacets).toBe(2);
    expect(axis.unusable).toBe(true);
    expect(axis.letter).toBeNull();
  });

  it("답이 1개뿐인 측면은 세지 않지만 그 답은 문항 합에 들어간다", () => {
    const axis = moneyScore(
      money({
        "limit.1": 6, "limit.2": "skip", "limit.3": "skip", "limit.4": "skip",
        "check.1": 3, "check.2": 2, "check.3": 1, "check.4": 2,
        "worth.1": 2, "worth.2": -2, "worth.3": 2, "worth.4": 0,
        "moment.1": -2, "moment.2": 2, "moment.3": 0, "moment.4": -2,
      }),
    );
    expect(axis.answered).toBe(13);
    expect(axis.facets.map((facet) => facet.counted)).toEqual([false, true, true, true]);
    expect(axis.countedFacets).toBe(3);
    expect(axis.sum).toBe(6 + 8 + 2 - 2);
    expect(axis.weighted).toBe(3 * (8 + 2 - 2));
    expect(axis).toMatchObject({ band: "even", letter: "V", tieLevel: 0 });
  });

  it("답이 11개(네 측면 모두 세는 경우)면 글자를 만들지 않는다", () => {
    const plan: Record<string, Wanted> = {};
    for (const name of Object.keys(MONEY_FORMATS)) plan[name] = small(name);
    for (const name of ["limit.4", "check.2", "worth.2", "moment.2", "moment.4"]) plan[name] = "skip";
    const axis = moneyScore(money(plan));
    expect(axis.answered).toBe(11);
    expect(axis.countedFacets).toBe(4);
    expect(axis.unusable).toBe(true);
    expect(axis.letter).toBeNull();
    expect(axis.provisional).toBe(false);
  });

  it("아무 답도 없어도 던지지 않고 사용 불가 집계를 낸다", () => {
    const axis = moneyScore({});
    expect(axis).toMatchObject({ answered: 0, skipped: 0, notApplicable: 0, sum: 0, countedFacets: 0, unusable: true, letter: null, band: null });
    expect(axis.facets.map((facet) => facet.counted)).toEqual([false, false, false, false]);
  });
});

describe("성질 검사(무작위 응답)", () => {
  function makeRandom(count: number, skipRate: number): Responses[] {
    let seed = 20260929;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const list: Responses[] = [];
    for (let n = 0; n < count; n += 1) {
      const responses: Record<string, ResponseValue> = {};
      for (const item of bank.items) {
        const r = next();
        responses[item.id] = r < skipRate ? "skip" : r < skipRate * 1.5 ? "na" : stateChar(Math.floor(next() * V40_STATE_COUNTS[item.fmt]));
      }
      list.push(responses);
    }
    return list;
  }

  it("완전한 응답이면 N = 3 x 문항 합, m = 4 이고 S = 문항 합 / 96 이다", () => {
    for (const responses of makeRandom(400, 0)) {
      for (const axis of scoreResponses(bank, responses).axes) {
        expect(axis.answered).toBe(16);
        expect(axis.countedFacets).toBe(4);
        expect(axis.weighted).toBe(3 * axis.sum);
        expect(axis.s).toBeCloseTo(axis.sum / 96, 12);
      }
    }
  });

  it("글자, 세기, 동점 단계가 N 과 m 에서 정수 비교로 정해진다", () => {
    for (const responses of makeRandom(600, 0.06)) {
      for (const axis of scoreResponses(bank, responses).axes) {
        if (axis.unusable) {
          expect(axis).toMatchObject({ weighted: null, s: null, side: null, letter: null, tieLevel: null, band: null, provisional: false });
          continue;
        }
        const weighted = axis.weighted as number;
        expect(Number.isInteger(weighted)).toBe(true);
        const m = axis.countedFacets;
        // 가중합을 측면 집계에서 다시 만든다
        const recomputed = axis.facets.filter((facet) => facet.counted).reduce((sum, facet) => sum + facet.sum * (12 / facet.answered), 0);
        expect(recomputed).toBe(weighted);
        if (weighted !== 0) {
          expect(axis.tieLevel).toBe(0);
          expect(axis.side).toBe(weighted > 0 ? "front" : "back");
          const magnitude = Math.abs(weighted);
          const expectedBand: StrengthBand = magnitude >= 36 * m ? "clear" : magnitude >= 18 * m ? "lean" : "even";
          expect(axis.band).toBe(expectedBand);
        } else {
          expect(axis.tieLevel).toBeGreaterThanOrEqual(1);
          expect(axis.band).toBe("even");
        }
        expect(axis.provisional).toBe(axis.tieLevel === 5);
        expect(axis.letter).toBe(axis.side === "front" ? ["V", "W", "U", "H"][V40_AXIS_KEYS.indexOf(axis.axis)] : ["S", "D", "F", "A"][V40_AXIS_KEYS.indexOf(axis.axis)]);
        expect(axis.answered + axis.skipped + axis.notApplicable).toBeLessThanOrEqual(16);
      }
    }
  });

  it("scoreResponses 는 폼 비트가 없고 buildResult 의 축 집계는 폼 비트와 무관하다", () => {
    for (const responses of makeRandom(150, 0.04)) {
      const zero = buildResult(bank, 0, responses);
      const one = buildResult(bank, 1, responses);
      expect(one.formBit).toBe(1);
      expect(zero.formBit).toBe(0);
      expect({ ...one, formBit: 0 }).toEqual(zero);
    }
  });

  it("순수하다: 얼려 둔 응답을 넣어도 바꾸지 않고 같은 결과를 낸다", () => {
    const responses = Object.freeze({ ...makeRandom(1, 0.05)[0] });
    expect(buildResult(bank, 1, responses)).toEqual(buildResult(bank, 1, responses));
    expect(scoreResponses(bank, responses)).toEqual(scoreResponses(bank, responses));
  });
});

// ---------------------------------------------------------------------------
// buildResult
// ---------------------------------------------------------------------------

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

describe("buildResult: 코드와 관문", () => {
  it("네 주제가 뚜렷한 응답은 네 글자 코드를 낸다", () => {
    const result = buildResult(bank, 0, strong(FRONT4));
    expect(result.code).toBe("VWUH");
    expect(result.gate).toEqual({ closed: false, reason: null });
    expect(result.axes.map((axis) => axis.letter)).toEqual(["V", "W", "U", "H"]);
    expect(result.axes.map((axis) => axis.shownBand)).toEqual(["clear", "clear", "clear", "clear"]);
    expect(result.notes).toMatchObject({ hintRhythm: false, hintSkip: false, demoted: false, hasOmitted: false, skippedCount: 0, notApplicableCount: 0 });
    expect(result.notes.unusableAxes).toEqual([]);
    expect(result.notes.provisionalAxes).toEqual([]);
    expect(buildResult(bank, 0, strong(["back", "back", "back", "back"])).code).toBe("SDFA");
    expect(buildResult(bank, 1, strong(["front", "back", "back", "front"])).code).toBe("VDFH");
    expect(buildResult(bank, 1, strong(["back", "front", "front", "back"])).code).toBe("SWUA");
  });

  it("글자를 못 정한 주제는 가운뎃점으로 적고 나머지는 그대로 코드가 만들어진다", () => {
    const responses = strong(["front", "front", "back", "front"]);
    for (const item of bank.scoredByAxis.process) delete responses[item.id];
    const result = buildResult(bank, 0, responses);
    expect(result.code).toBe(`V${V40_UNSET_LETTER_MARK}FH`);
    expect(result.axes[1]).toMatchObject({ unusable: true, letter: null, shownBand: null });
    expect(result.notes.unusableAxes).toEqual(["process"]);
    expect(result.gate.closed).toBe(false);
  });

  it("확정 글자가 하나도 없으면 관문이 닫힌다(noInformation): 아무 답도 없음, 전부 건너뜀, 임시 글자만 있음", () => {
    const empty = buildResult(bank, 0, {});
    expect(empty.code).toBeNull();
    expect(empty.gate).toEqual({ closed: true, reason: "noInformation" });
    expect(empty.notes.unusableAxes).toEqual(["money", "process", "scope", "support"]);

    const allSkip: Record<string, ResponseValue> = {};
    for (const item of bank.items) allSkip[item.id] = "skip";
    const skipped = buildResult(bank, 1, allSkip);
    expect(skipped.code).toBeNull();
    expect(skipped.gate).toEqual({ closed: true, reason: "noInformation" });
    expect(skipped.notes.hintSkip).toBe(true);

    // 돈 주제만 임시 글자이고 나머지는 사용 불가
    const tie4 = {
      "money.limit.1": 2, "money.limit.2": 0, "money.limit.3": 2, "money.limit.4": -2,
      "money.check.1": 0, "money.check.2": -2, "money.check.3": 2, "money.check.4": -2,
      "money.worth.1": 2, "money.worth.2": 2, "money.worth.3": -4, "money.worth.4": 0,
      "money.moment.1": 0, "money.moment.2": 2, "money.moment.3": 0, "money.moment.4": -2,
    };
    const provisionalOnly = buildResult(bank, 0, respond(tie4));
    expect(provisionalOnly.axes[0]).toMatchObject({ provisional: true, letter: "V", tieLevel: 5 });
    expect(provisionalOnly.code).toBeNull();
    expect(provisionalOnly.gate).toEqual({ closed: true, reason: "noInformation" });
    expect(provisionalOnly.notes.provisionalAxes).toEqual(["money"]);
  });

  it("임시 글자가 있어도 확정 글자가 하나라도 있으면 코드에 임시 글자가 그대로 적힌다", () => {
    const responses = { ...strong(["front", "front", "front", "front"]) };
    const tie4 = {
      "money.limit.1": 2, "money.limit.2": 0, "money.limit.3": 2, "money.limit.4": -2,
      "money.check.1": 0, "money.check.2": -2, "money.check.3": 2, "money.check.4": -2,
      "money.worth.1": 2, "money.worth.2": 2, "money.worth.3": -4, "money.worth.4": 0,
      "money.moment.1": 0, "money.moment.2": 2, "money.moment.3": 0, "money.moment.4": -2,
    };
    const overridden = { ...responses, ...respond(tie4), "self.money": "skip" };
    const result = buildResult(bank, 0, overridden);
    expect(result.axes[0]).toMatchObject({ provisional: true, letter: "V", shownBand: "even" });
    expect(result.code).toBe("VWUH");
    expect(result.gate.closed).toBe(false);
    expect(result.notes.provisionalAxes).toEqual(["money"]);
  });

  it("코드는 항상 글자 네 자리(가운뎃점 포함)이고 관문이 닫히면 null 이다", () => {
    for (const sides of [FRONT4, ["back", "front", "back", "front"], ["front", "back", "front", "back"]] as const) {
      const code = buildResult(bank, 0, strong(sides)).code as string;
      expect(Array.from(code)).toHaveLength(4);
    }
  });
});

describe("buildResult: 힌트와 세기", () => {
  /** 두 가지 중 고르기(늘 위 카드)와 이럴 때(늘 왼쪽 칸)를 화면 답으로 눌러 위치 반복 표시를 두 묶음 만들고, 나머지는 주제 방향으로 가장 센 답을 준다. */
  function rhythmic(formBit: FormBit, skipFirst: number): Record<string, ResponseValue> {
    const responses = strong(FRONT4);
    for (const item of bank.items) {
      if (item.fmt === "pair") responses[item.id] = toStored(item, formBit, { fmt: "pair", cell: 0 }) as string;
      if (item.fmt === "react") responses[item.id] = toStored(item, formBit, { fmt: "react", cell: 0 }) as string;
    }
    // 뒷 세 주제에서만 골라 건너뛴다(돈 주제는 그대로 둬서 뚜렷해요가 남게 한다)
    let skipped = 0;
    for (const item of bank.scored) {
      if (skipped >= skipFirst) break;
      if (item.axis === "money" || item.fmt === "pair" || item.fmt === "react") continue;
      responses[item.id] = "skip";
      skipped += 1;
    }
    return responses;
  }

  it("위치 반복 형식이 2개이면 모든 자리의 세기를 한 단계 낮춘다", () => {
    for (const formBit of [0, 1] as const) {
      const result = buildResult(bank, formBit, rhythmic(formBit, 0));
      expect(result.rhythm.flaggedCount).toBeGreaterThanOrEqual(2);
      expect(result.notes.hintRhythm).toBe(true);
      expect(result.notes.hintSkip).toBe(false);
      expect(result.notes.demoted).toBe(true);
      for (const axis of result.axes) {
        expect(axis.band).not.toBeNull();
        expect(axis.shownBand).toBe(demoteBand(axis.band as StrengthBand));
      }
      // 글자 자체는 힌트로 바뀌지 않는다
      expect(result.axes.map((axis) => axis.letter)).toEqual(["V", "W", "U", "H"]);
      // 관문은 위치 반복 형식이 세 개일 때만 닫힌다: 두 개면 세기만 낮추고 코드는 그대로 나온다
      expect(result.rhythm.flaggedCount).toBe(2);
      expect(result.gate).toEqual({ closed: false, reason: null });
      expect(result.code).toBe("VWUH");
    }
  });

  it("건너뜀이 17개 이상이면 한 단계 낮추고, 위치 반복 힌트와 겹쳐도 한 단계까지만 낮춘다", () => {
    const skipOnly = strong(FRONT4);
    const targets = bank.scored.filter((item) => item.axis !== "money" && item.fmt !== "pair" && item.fmt !== "react").slice(0, 17);
    targets.forEach((item) => {
      skipOnly[item.id] = "skip";
    });
    const skipResult = buildResult(bank, 0, skipOnly);
    expect(skipResult.notes).toMatchObject({ hintSkip: true, hintRhythm: false, demoted: true, skippedCount: 17 });
    expect(skipResult.axes[0].band).toBe("clear");
    expect(skipResult.axes[0].shownBand).toBe("lean");

    const both = buildResult(bank, 0, rhythmic(0, 17));
    expect(both.notes).toMatchObject({ hintSkip: true, hintRhythm: true, demoted: true, skippedCount: 17 });
    expect(both.axes[0].band).toBe("clear");
    expect(both.axes[0].shownBand).toBe("lean"); // 두 단계 아래(반반이에요)가 아니다
    for (const axis of both.axes) {
      if (axis.band !== null) expect(axis.shownBand).toBe(demoteBand(axis.band));
    }
  });

  it("건너뜀 16개까지는 낮추지 않는다", () => {
    const responses = strong(FRONT4);
    bank.scored
      .filter((item) => item.axis !== "money" && item.fmt !== "pair" && item.fmt !== "react")
      .slice(0, 16)
      .forEach((item) => {
        responses[item.id] = "skip";
      });
    const result = buildResult(bank, 0, responses);
    expect(result.notes).toMatchObject({ hintSkip: false, demoted: false, skippedCount: 16 });
    expect(result.axes[0].shownBand).toBe(result.axes[0].band);
  });

  it("해당 없음은 건너뜀 힌트에 들어가지 않는다", () => {
    const responses = strong(FRONT4);
    bank.scored
      .filter((item) => item.axis !== "money" && item.fmt !== "pair" && item.fmt !== "react")
      .slice(0, 17)
      .forEach((item) => {
        responses[item.id] = "na";
      });
    const result = buildResult(bank, 0, responses);
    expect(result.notes).toMatchObject({ hintSkip: false, demoted: false, skippedCount: 0, notApplicableCount: 17, hasOmitted: true });
  });

  it("반반이에요는 더 낮아지지 않는다(demoteBand)", () => {
    expect(demoteBand("clear")).toBe("lean");
    expect(demoteBand("lean")).toBe("even");
    expect(demoteBand("even")).toBe("even");
  });

  it("위치 반복 형식이 세 개이면 관문이 닫혀 코드가 없다(rhythm), 축 집계는 그대로 계산된다", () => {
    const responses = strong(FRONT4);
    for (const item of bank.items) {
      if (item.fmt === "pair") responses[item.id] = toStored(item, 0, { fmt: "pair", cell: 0 }) as string;
      if (item.fmt === "react") responses[item.id] = toStored(item, 0, { fmt: "react", cell: 0 }) as string;
      if (item.fmt === "recall" || item.fmt === "instant") responses[item.id] = toStored(item, 0, { fmt: item.fmt, option: 0 }) as string;
    }
    const result = buildResult(bank, 0, responses);
    expect(result.rhythm.flaggedCount).toBe(3);
    expect(result.gate).toEqual({ closed: true, reason: "rhythm" });
    expect(result.code).toBeNull();
    expect(result.axes.some((axis) => axis.letter !== null)).toBe(true);
    expect(result.notes.hintRhythm).toBe(true);
  });
});

describe("buildResult: 직접 고른 쪽 대비", () => {
  const withSelf = (sides: readonly [Side, Side, Side, Side], self: Partial<Record<Axis, ResponseValue>>) => buildResult(bank, 0, strong(sides, self));

  it("답이 모인 쪽과 다른 쪽을 꽤 이상으로 직접 골랐고 세기가 뚜렷해요이면 대비를 만든다", () => {
    const result = withSelf(FRONT4, { money: selfState("money", "back", 2), process: selfState("process", "back", 3) });
    expect(result.axes[0].contrast).toEqual({
      axis: "money",
      selfSide: "back",
      selfLetter: "S",
      selfLevel: 2,
      gatheredSide: "front",
      gatheredLetter: "V",
      gatheredBand: "clear",
    });
    expect(result.axes[1].contrast).toEqual({
      axis: "process",
      selfSide: "back",
      selfLetter: "D",
      selfLevel: 3,
      gatheredSide: "front",
      gatheredLetter: "W",
      gatheredBand: "clear",
    });
    expect(result.axes[2].contrast).toBeNull();
    expect(result.axes[3].contrast).toBeNull();
  });

  it("한 단계 낮춰 뚜렷해요가 기울어요로 보이는 주제의 대비는 화면에 보이는 세기(기울어요)를 담는다", () => {
    const responses = strong(FRONT4, { money: selfState("money", "back", 2) });
    // 돈 밖의 채점 문항 17개를 건너뛰어 건너뜀 힌트를 켠다(돈 주제 답은 그대로라 원래 세기는 뚜렷해요)
    bank.scored
      .filter((item) => item.axis !== "money" && item.fmt !== "pair" && item.fmt !== "react")
      .slice(0, 17)
      .forEach((item) => {
        responses[item.id] = "skip";
      });
    const result = buildResult(bank, 0, responses);
    expect(result.notes.hintSkip).toBe(true);
    expect(result.axes[0]).toMatchObject({ band: "clear", shownBand: "lean" });
    expect(result.axes[0].contrast).toEqual({
      axis: "money",
      selfSide: "back",
      selfLetter: "S",
      selfLevel: 2,
      gatheredSide: "front",
      gatheredLetter: "V",
      gatheredBand: "lean",
    });
  });

  it("같은 쪽을 골랐거나, 조금만 골랐거나, 자기 선택을 건너뛰었거나 답하지 않았으면 대비가 없다", () => {
    const same = withSelf(FRONT4, { money: selfState("money", "front", 3) });
    expect(same.axes[0].contrast).toBeNull();
    const little = withSelf(FRONT4, { money: selfState("money", "back", 1) });
    expect(little.axes[0].contrast).toBeNull();
    const skipped = withSelf(FRONT4, { money: "skip" });
    expect(skipped.axes[0].contrast).toBeNull();
    const na = withSelf(FRONT4, { money: "na" });
    expect(na.axes[0].contrast).toBeNull();
    const missing = withSelf(FRONT4, {});
    expect(missing.axes.map((axis) => axis.contrast)).toEqual([null, null, null, null]);
  });

  it("세기가 반반이에요이면(또는 한 단계 낮춰 반반이에요가 되면) 대비가 없다", () => {
    const tie = {
      "money.limit.1": 2, "money.limit.2": 0, "money.limit.3": 2, "money.limit.4": -2,
      "money.check.1": 0, "money.check.2": -2, "money.check.3": 2, "money.check.4": -2,
      "money.worth.1": 2, "money.worth.2": 2, "money.worth.3": -4, "money.worth.4": 0,
      "money.moment.1": 0, "money.moment.2": 2, "money.moment.3": 0, "money.moment.4": -2,
    };
    // 동점 4단계: 자기 선택이 앞쪽 꽤이면 글자는 앞쪽이고 같은 쪽이라 대비가 없다
    const responses = { ...strong(FRONT4), ...respond(tie), "self.money": selfState("money", "front", 2) };
    const result = buildResult(bank, 0, responses);
    expect(result.axes[0]).toMatchObject({ tieLevel: 4, letter: "V", shownBand: "even", contrast: null });
  });

  it("힌트로 세기가 반반이에요까지 낮아진 주제에는 대비가 없다", () => {
    const responses = strong(FRONT4, { money: selfState("money", "back", 3) });
    // 돈 주제만 기울어요로 만든다: 앞극 값을 절반쯤 약하게
    const lean = { ...responses };
    for (const item of bank.scoredByAxis.money) lean[item.id] = "skip";
    Object.assign(
      lean,
      respond({
        "money.limit.1": 6, "money.limit.2": 3, "money.limit.3": 2, "money.limit.4": 2,
        "money.check.1": 3, "money.check.2": 2, "money.check.3": 3, "money.check.4": 2,
        "money.worth.1": 2, "money.worth.2": -2, "money.worth.3": 2, "money.worth.4": 0,
        "money.moment.1": 1, "money.moment.2": 2, "money.moment.3": 0, "money.moment.4": -2,
      }),
    );
    const plain = buildResult(bank, 0, lean);
    expect(plain.axes[0]).toMatchObject({ band: "lean", shownBand: "lean" });
    expect(plain.axes[0].contrast).toMatchObject({ gatheredBand: "lean", selfLevel: 3 });
    // 건너뜀 17개 이상이면 한 단계 낮아져 반반이에요가 되고 대비가 사라진다
    const skipped = { ...lean };
    bank.scored
      .filter((item) => item.axis !== "money" && item.fmt !== "pair" && item.fmt !== "react")
      .slice(0, 17)
      .forEach((item) => {
        skipped[item.id] = "skip";
      });
    const demoted = buildResult(bank, 0, skipped);
    expect(demoted.axes[0]).toMatchObject({ band: "lean", shownBand: "even", contrast: null });
  });
});

describe("buildResult: 품질 안내", () => {
  it("넘어간 질문 개수와 사용 불가, 임시 주제를 알린다", () => {
    const responses = strong(FRONT4);
    bank.scoredByAxis.scope.forEach((item, index) => {
      responses[item.id] = index < 6 ? "skip" : index < 8 ? "na" : responses[item.id];
    });
    const result = buildResult(bank, 0, responses);
    expect(result.notes).toMatchObject({ hasOmitted: true, skippedCount: 6, notApplicableCount: 2, hintSkip: false });
    expect(result.notes.unusableAxes).toEqual(["scope"]); // 답이 8개
    expect(result.code).toBe(`VW${V40_UNSET_LETTER_MARK}H`);
  });

  it("넘어간 질문이 없으면 hasOmitted 가 false 이고 자기 선택만 건너뛴 것은 세지 않는다", () => {
    const responses = strong(FRONT4);
    for (const item of bank.self) responses[item.id] = "skip";
    const result = buildResult(bank, 0, responses);
    expect(result.notes).toMatchObject({ hasOmitted: false, skippedCount: 0, notApplicableCount: 0 });
  });
});

// ---------------------------------------------------------------------------
// 정적 균형: 고정 화면 답과 위치 함수 응답은 형식별 축 합이 정확히 0 (설계 4절, 5절 방향 균형과 거울 구조)
// ---------------------------------------------------------------------------

type Family = "pair" | "react" | "choose" | "bestworst" | "split";
const FAMILIES: readonly Family[] = ["pair", "react", "choose", "bestworst", "split"];
const familyOf = (item: ScoredItem): Family => (item.fmt === "recall" || item.fmt === "instant" ? "choose" : item.fmt);

/** 그 묶음에서 누를 수 있는 화면 답 하나를 문항의 형식에 맞는 화면 답으로 만든다. */
type ViewSpec =
  | { readonly kind: "pair"; readonly cell: number }
  | { readonly kind: "react"; readonly cell: number }
  | { readonly kind: "choose"; readonly option: number }
  | { readonly kind: "bestworst"; readonly best: number; readonly worst: number }
  | { readonly kind: "split"; readonly counts: readonly [number, number, number] };

function storedFor(item: ScoredItem, formBit: FormBit, spec: ViewSpec): string {
  const stored = (() => {
    switch (item.fmt) {
      case "pair":
        return spec.kind === "pair" ? toStored(item, formBit, { fmt: "pair", cell: spec.cell }) : null;
      case "react":
        return spec.kind === "react" ? toStored(item, formBit, { fmt: "react", cell: spec.cell }) : null;
      case "recall":
      case "instant":
        return spec.kind === "choose" ? toStored(item, formBit, { fmt: item.fmt, option: spec.option }) : null;
      case "bestworst":
        return spec.kind === "bestworst" ? toStored(item, formBit, { fmt: "bestworst", best: spec.best, worst: spec.worst }) : null;
      case "split":
        return spec.kind === "split" ? toStored(item, formBit, { fmt: "split", counts: [...spec.counts] as [number, number, number] }) : null;
    }
  })();
  if (stored === null) throw new Error(`${item.id} 에 맞지 않는 화면 답 ${spec.kind}`);
  return stored;
}

function familySpecs(family: Family): ViewSpec[] {
  const specs: ViewSpec[] = [];
  if (family === "pair") for (let cell = 0; cell < 6; cell += 1) specs.push({ kind: "pair", cell });
  if (family === "react") for (let cell = 0; cell < 5; cell += 1) specs.push({ kind: "react", cell });
  if (family === "choose") for (let option = 0; option < 4; option += 1) specs.push({ kind: "choose", option });
  if (family === "bestworst") for (let best = 0; best < 4; best += 1) for (let worst = 0; worst < 4; worst += 1) if (best !== worst) specs.push({ kind: "bestworst", best, worst });
  if (family === "split") for (const counts of [[6, 0, 0], [0, 6, 0], [0, 0, 6], [2, 2, 2]] as const) specs.push({ kind: "split", counts });
  return specs;
}

/** 한 주제, 한 묶음의 문항 값 합. spec 이 문항마다 다른 화면 답을 정할 수 있다. */
function familySum(axis: Axis, family: Family, formBit: FormBit, specFor: (item: ScoredItem, index: number) => ViewSpec): number {
  let sum = 0;
  bank.scoredByAxis[axis].forEach((item, index) => {
    if (familyOf(item) !== family) return;
    const stored = storedFor(item, formBit, specFor(item, index));
    sum += itemValue(item, stored) as number;
  });
  return sum;
}

describe("고정 화면 답 248가지: 형식별 축 합이 정확히 0 (폼 비트 0, 1)", () => {
  it("31가지 고정 화면 답 x 폼 비트 2 x 주제 4 = 248 경우가 모두 0", () => {
    let checked = 0;
    for (const formBit of [0, 1] as const) {
      for (const axis of V40_AXIS_KEYS) {
        for (const family of FAMILIES) {
          for (const spec of familySpecs(family)) {
            const sum = familySum(axis, family, formBit, () => spec);
            expect(sum, `폼 ${formBit} ${axis} ${family} ${JSON.stringify(spec)}`).toBe(0);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(248);
  });

  it("지난 일 떠올리기와 그때 나는을 따로 세도, 칸 나누기 28가지 전체로 늘려도 0", () => {
    for (const formBit of [0, 1] as const) {
      for (const axis of V40_AXIS_KEYS) {
        for (const fmt of ["recall", "instant"] as const) {
          for (let option = 0; option < 4; option += 1) {
            let sum = 0;
            for (const item of bank.scoredByAxis[axis]) {
              if (item.fmt !== fmt) continue;
              const stored = toStored(item, formBit, { fmt, option }) as string;
              sum += itemValue(item, stored) as number;
            }
            expect(sum, `폼 ${formBit} ${axis} ${fmt} ${option}`).toBe(0);
          }
        }
        for (let a = 0; a <= 6; a += 1) {
          for (let b = 0; a + b <= 6; b += 1) {
            const sum = familySum(axis, "split", formBit, () => ({ kind: "split", counts: [a, b, 6 - a - b] }));
            expect(sum, `폼 ${formBit} ${axis} split ${a}/${b}`).toBe(0);
          }
        }
      }
    }
  });

  it("구간 안 위치와 구간 홀짝, 또는 전체 질문 순서 mod 2, 4, 8, 16, 32 에만 좌우되는 응답도 형식별 합이 0 이다", () => {
    let seed = 31415926;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const pick = (n: number) => Math.floor(next() * n);
    const randomSpec = (family: Family): ViewSpec => {
      switch (family) {
        case "pair": return { kind: "pair", cell: pick(6) };
        case "react": return { kind: "react", cell: pick(5) };
        case "choose": return { kind: "choose", option: pick(4) };
        case "bestworst": { const best = pick(4); let worst = pick(3); if (worst >= best) worst += 1; return { kind: "bestworst", best, worst }; }
        default: { const counts: [number, number, number] = [0, 0, 0]; for (let t = 0; t < 6; t += 1) counts[pick(3)] += 1; return { kind: "split", counts }; }
      }
    };
    const scoredIndex = new Map(bank.scored.map((item, index) => [item.id, index]));
    const classes: Record<string, (item: ScoredItem) => string> = {
      "구간 안 위치 x 구간 홀짝": (item) => {
        const g = scoredIndex.get(item.id)!;
        return `${g % 16}:${Math.floor(g / 16) % 2}`;
      },
      "전체 질문 순서 mod 32": (item) => String(scoredIndex.get(item.id)! % 32),
      "전체 질문 순서 mod 16": (item) => String(scoredIndex.get(item.id)! % 16),
      "전체 질문 순서 mod 8": (item) => String(scoredIndex.get(item.id)! % 8),
      "전체 질문 순서 mod 4": (item) => String(scoredIndex.get(item.id)! % 4),
      "전체 질문 순서 mod 2": (item) => String(scoredIndex.get(item.id)! % 2),
    };
    let checked = 0;
    for (const [name, classOf] of Object.entries(classes)) {
      for (let trial = 0; trial < 60; trial += 1) {
        const formBit = (trial % 2) as FormBit;
        const table = new Map<string, ViewSpec>();
        const specFor = (item: ScoredItem): ViewSpec => {
          const key = `${familyOf(item)}:${classOf(item)}`;
          if (!table.has(key)) table.set(key, randomSpec(familyOf(item)));
          return table.get(key) as ViewSpec;
        };
        for (const axis of V40_AXIS_KEYS) {
          for (const family of FAMILIES) {
            // recall 과 instant 의 화면 답 종류는 같으므로 choose 스펙을 공유한다
            expect(familySum(axis, family, formBit, specFor), `${name} 시행 ${trial} ${axis} ${family}`).toBe(0);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(6 * 60 * 4 * 5);
  });

  it("거울 짝을 서로 다른 칸으로 누르면 합이 0 이 아니다(시험이 아무 응답에나 0 을 내는 것이 아님을 보인다)", () => {
    let nonZero = 0;
    for (const axis of V40_AXIS_KEYS) {
      // 구간 0 만 가장 센 칸(+6 쪽), 나머지는 위 카드 조금(+2 쪽): 거울 짝이 서로 다른 칸이라 4 x (구간 0 문항의 키)가 남는다
      const sum = familySum(axis, "pair", 0, (item) => ({ kind: "pair", cell: item.section === 0 ? 0 : 2 }));
      if (sum !== 0) nonZero += 1;
    }
    expect(nonZero).toBe(4);
  });
});

describe("계약 묶음", () => {
  it("scoreModule 은 scoreResponses 와 buildResult 와 selfLine 을 가진다", () => {
    expect(Object.keys(scoreModule).sort()).toEqual(["buildResult", "scoreResponses", "selfLine"]);
  });

  it("결과 타입에 필요한 필드가 있다", () => {
    const result: V40Result = buildResult(bank, 0, strong(FRONT4));
    expect(Object.keys(result).sort()).toEqual(["axes", "code", "formBit", "gate", "notes", "rhythm"]);
    expect(Object.keys(result.axes[0]).sort()).toEqual(
      ["answered", "axis", "band", "contrast", "countedFacets", "facets", "letter", "notApplicable", "provisional", "s", "shownBand", "side", "skipped", "sum", "tieLevel", "unusable", "weighted"].sort(),
    );
  });

  it("문항 배열 타입 사용(참조)", () => {
    const first: Item = bank.items[0];
    expect(first.id).toBeTruthy();
  });
});
