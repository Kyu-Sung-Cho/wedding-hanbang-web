/**
 * 웨딩코드 4.0 고정 표본 응답 12개(README 6절 고정 표본, types.ts 의 V40Fixture).
 *
 * 화면 빌더가 실제 채점 결과로 화면을 그리고 시험이 회귀를 잡는 데 쓴다. 표본마다 68개 문항이 모두 채워져 있다.
 * 문항 문구에 기대지 않고 **뜻(의도)** 으로 만든다: 「돈은 뒤쪽으로 기울어요」 「이 주제는 유효 답이 10개」처럼 적은 계획을
 * 은행의 극과 형식(문구가 아니라 배치 골격에서 오는 것)으로 저장 상태로 바꾼다. 그래서 문항 문구가 바뀌어도 표본은 그대로 유효하다.
 *
 * 계획의 말: 주제마다 측면 네 개(주제 안 순서)와 형식 묶음 네 개(두 가지 중 고르기, 이럴 때, 고르기, 무거운 형식)의 4 x 4 표에
 * 원하는 문항 값(양수는 앞극)을 적는다. 레이아웃이 측면마다 묶음별 문항을 정확히 하나씩 주므로 표 한 칸은 문항 한 개다.
 */
import { V40_STATE_COUNTS, axisInfo } from "@/constants/weddingCodeV40";
import type { Axis, Bank, FormBit, Item, ResponseValue, Responses, ScoredItem, Side, V40Fixture, ViewAnswer } from "./types";
import { WEDDING_CODE_V40_BANK } from "./bank";
import { toStored } from "./present";
import { stateChar } from "./states";
import { selfChoice, stateValue } from "./value";

// ---------------------------------------------------------------------------
// 계획의 말
// ---------------------------------------------------------------------------

/** 형식 묶음: 측면마다 이 넷이 하나씩 있다. choose 는 recall 과 instant, heavy 는 bestworst 와 split 이다. */
export type FixtureFamily = "pair" | "react" | "choose" | "heavy";

const FAMILY_COLUMN: Readonly<Record<FixtureFamily, 0 | 1 | 2 | 3>> = { pair: 0, react: 1, choose: 2, heavy: 3 };

/** 측면 하나의 원하는 값 [두 가지 중 고르기, 이럴 때, 고르기, 무거운 형식]. 양수는 앞극(V W U H)쪽, 음수는 뒤극쪽. */
export type FixtureRow = readonly [number, number, number, number];
/** 측면 네 개(주제 안 순서)의 원하는 값 표. */
export type FixtureRows = readonly [FixtureRow, FixtureRow, FixtureRow, FixtureRow];

/** 값 대신 빠진 값으로 두는 칸. */
export interface FixtureOmit {
  readonly facet: 0 | 1 | 2 | 3;
  readonly family: FixtureFamily;
  readonly as: "skip" | "na";
}

/** 자기 선택 계획: 고른 방향과 세기(1 조금, 2 꽤, 3 아주), 또는 건너뜀과 해당 없음. */
export type FixtureSelf = { readonly side: Side; readonly level: 1 | 2 | 3 } | "skip" | "na";

/** 한 주제의 계획: 원하는 값 표, 자기 선택, 빠진 값으로 둘 칸(선택). */
export interface FixtureAxisPlan {
  readonly rows: FixtureRows;
  readonly self: FixtureSelf;
  readonly omit?: readonly FixtureOmit[];
}

/** 화면 위치를 고정해 누르는 계획(위치 반복 표본). pair 는 칸 0에서 5, react 는 칸 0에서 4, choose 는 보기 0에서 3(화면 기준). */
export interface FixturePressed {
  readonly pair?: number;
  readonly react?: number;
  readonly choose?: number;
}

/** 표본 하나의 계획: 이름, 설명, 폼 비트, 네 주제의 계획, 누른 위치를 고정할 형식(선택). pressed 가 있으면 그 형식의 값 표 열은 쓰지 않는다. */
export interface FixturePlan {
  readonly name: string;
  readonly description: string;
  readonly formBit: FormBit;
  readonly axes: Readonly<Record<Axis, FixtureAxisPlan>>;
  readonly pressed?: FixturePressed;
}

// ---------------------------------------------------------------------------
// 계획 -> 응답
// ---------------------------------------------------------------------------

function familyOf(item: ScoredItem): FixtureFamily {
  switch (item.fmt) {
    case "pair":
      return "pair";
    case "react":
      return "react";
    case "recall":
    case "instant":
      return "choose";
    default:
      return "heavy";
  }
}

/** 칸 나누기 상태의 중립 칸 수(다른 형식은 0). 같은 값을 내는 상태 가운데 중립이 적은 쪽을 먼저 쓴다. */
function neutralCount(item: ScoredItem, state: number): number {
  if (item.fmt !== "split") return 0;
  const counts = splitCounts(state);
  const index = item.entries.findIndex((entry) => entry.pole === "neutral");
  return index < 0 ? 0 : counts[index];
}

function splitCounts(state: number): readonly number[] {
  for (let a = 6; a >= 0; a -= 1) {
    const start = (a * (15 - a)) / 2;
    if (state >= start) return [a, state - start, 6 - a - (state - start)];
  }
  return [0, 0, 6];
}

/**
 * 원하는 값에 가장 가까운 값을 내는 저장 상태 색인. 같은 거리이면 절댓값이 큰 쪽, 같은 값을 내는 상태가 여럿이면 중립 칸이 적은 쪽,
 * 그래도 여럿이면 variant 로 돌려 가며 고른다(가장·아닌 것 카드가 늘 같은 자리로 몰리지 않게).
 */
function stateFor(item: ScoredItem, wanted: number, variant: number): number {
  const options: { readonly state: number; readonly value: number }[] = [];
  for (let state = 0; state < V40_STATE_COUNTS[item.fmt]; state += 1) options.push({ state, value: stateValue(item, state) });
  const distance = Math.min(...options.map((option) => Math.abs(option.value - wanted)));
  const near = options.filter((option) => Math.abs(option.value - wanted) === distance);
  const strongest = Math.max(...near.map((option) => Math.abs(option.value)));
  const value = near.find((option) => Math.abs(option.value) === strongest)?.value ?? 0;
  const same = near.filter((option) => option.value === value);
  const fewestNeutral = Math.min(...same.map((option) => neutralCount(item, option.state)));
  const pool = same.filter((option) => neutralCount(item, option.state) === fewestNeutral);
  return pool[variant % pool.length].state;
}

/** 자기 선택 문항에서 고른 방향과 세기를 내는 저장 상태 문자(위 카드가 어느 극인지는 문항의 카드에서 읽는다). */
function selfStateFor(item: Item, self: { readonly side: Side; readonly level: 1 | 2 | 3 }): ResponseValue {
  if (item.fmt !== "self") throw new Error(`자기 선택 문항이 아니다: ${item.id}`);
  for (let state = 0; state < V40_STATE_COUNTS.self; state += 1) {
    const char = stateChar(state);
    const choice = selfChoice(item, char);
    if (choice !== null && choice.side === self.side && choice.level === self.level) return char;
  }
  throw new Error(`자기 선택 상태를 찾지 못했다: ${item.id}`);
}

function pressedAnswer(item: ScoredItem, pressed: FixturePressed): ViewAnswer | null {
  switch (item.fmt) {
    case "pair":
      return pressed.pair === undefined ? null : { fmt: "pair", cell: pressed.pair };
    case "react":
      return pressed.react === undefined ? null : { fmt: "react", cell: pressed.react };
    case "recall":
    case "instant":
      return pressed.choose === undefined ? null : { fmt: item.fmt, option: pressed.choose };
    default:
      return null;
  }
}

/** 계획으로 응답을 만든다: 68개 문항이 모두 채워진다(값, 건너뜀, 해당 없음 중 하나). 고정 표본 12개의 재료다(README 6절 고정 표본). */
export function buildFixtureResponses(bank: Bank, plan: FixturePlan): Responses {
  const responses: Record<string, ResponseValue> = {};
  bank.items.forEach((item, codeIndex) => {
    const axisPlan = plan.axes[item.axis];
    if (item.fmt === "self") {
      const self = axisPlan.self;
      responses[item.id] = self === "skip" || self === "na" ? self : selfStateFor(item, self);
      return;
    }
    const family = familyOf(item);
    const facet = axisInfo(item.axis).facets.indexOf(item.facet);
    const omitted = axisPlan.omit?.find((entry) => entry.facet === facet && entry.family === family);
    if (omitted !== undefined) {
      responses[item.id] = omitted.as;
      return;
    }
    const view = plan.pressed ? pressedAnswer(item, plan.pressed) : null;
    if (view !== null) {
      const stored = toStored(item, plan.formBit, view);
      if (stored === null) throw new Error(`누른 위치가 저장 상태로 바뀌지 않는다: ${item.id}`);
      responses[item.id] = stored;
      return;
    }
    responses[item.id] = stateChar(stateFor(item, axisPlan.rows[facet][FAMILY_COLUMN[family]], codeIndex));
  });
  return responses;
}

// ---------------------------------------------------------------------------
// 값 표(의도): 뒤극쪽 표는 앞극쪽 표의 부호를 뒤집어 쓴다
// ---------------------------------------------------------------------------

const negate = (rows: FixtureRows): FixtureRows =>
  rows.map((row) => row.map((value) => (value === 0 ? 0 : -value))) as unknown as FixtureRows;

/** 뚜렷해요(앞극): 거의 모두 세게 앞쪽. */
const CLEAR_A: FixtureRows = [[6, 6, 6, 6], [4, 6, 6, 6], [6, 3, 6, 6], [6, 6, 2, 6]];
/** 뚜렷해요(앞극): 반대로 고른 답 하나가 섞여 있다. */
const CLEAR_B: FixtureRows = [[6, 3, 6, 4], [6, 6, 2, 6], [4, 6, 6, 6], [-4, 6, 6, 6]];
/** 기울어요(앞극): 반대로 고른 답이 몇 개 있다. */
const LEAN_A: FixtureRows = [[4, 3, 2, 6], [2, 0, 6, 2], [-4, 3, 2, 6], [2, 3, -2, 2]];
/** 기울어요(앞극) 다른 모양. */
const LEAN_B: FixtureRows = [[2, 3, 6, 2], [4, 3, -2, 2], [2, -3, 2, 6], [6, 3, 2, -2]];
/** 반반이에요(뒤극 쪽으로 조금): 두 쪽이 뒤섞여 있다. */
const EVEN_BACK: FixtureRows = [[2, -3, 2, -2], [-2, 3, -2, 2], [4, -3, 6, -6], [-4, -3, -2, 2]];
/** 반반이에요(앞극 쪽으로 조금). */
const EVEN_FRONT: FixtureRows = [[-2, 3, 2, -2], [2, -3, 2, 2], [-4, 3, -6, 6], [4, 3, 2, -2]];
/** 돈 주제 기울어요(뒤극): 설계 5절의 예(측면 합 -15, +10, -24, -15). 두 번째 측면의 무거운 형식이 칸 나누기라 값 1 이 나온다. */
const SWUA_MONEY: FixtureRows = [[-4, -3, -2, -6], [4, 3, 2, 1], [-6, -6, -6, -6], [-4, -3, -6, -2]];

/*
 * 동점 사슬 표 넷. 전체 합이 정확히 0 이라 N = 0 이고, 어느 단계에서 갈리는지는 표의 모양이 정한다(시험이 실제 채점기로 단계를 확인한다).
 * 1단계: 고르기 열의 합이 양수. 2단계: 고르기 열의 합이 0 이고 이럴 때 열의 합이 음수.
 * 3단계: 두 열의 합이 모두 0 이고 측면 합이 양수인 측면이 음수인 측면보다 많음. 4와 5단계: 두 열의 합이 0 이고 양수 측면과 음수 측면이 같은 수
 * (자기 선택이 있으면 4단계, 건너뛰었으면 5단계).
 */
const TIE_LEVEL_1: FixtureRows = [[2, 0, 6, 2], [-4, 3, -2, -6], [6, -6, -6, 2], [6, -3, 6, -6]];
const TIE_LEVEL_2: FixtureRows = [[4, -3, 2, -2], [4, -6, 6, 6], [-2, -3, -6, -2], [6, 0, -2, -2]];
const TIE_LEVEL_3: FixtureRows = [[-6, 3, -2, 6], [6, -6, -6, -2], [-2, 3, 2, 2], [2, 0, 6, -6]];
const TIE_LEVEL_4_OR_5: FixtureRows = [[-6, 0, 2, 2], [6, -3, -6, 6], [-2, 3, -2, -2], [-6, 0, 6, 2]];

/** 누른 위치만 정하고 값 표의 그 열은 쓰지 않는다는 표시(표의 0). */
const X = 0;

// ---------------------------------------------------------------------------
// 표본 계획 열두 개
// ---------------------------------------------------------------------------

const PLANS: readonly FixturePlan[] = [
  {
    name: "swua-example",
    description: "문서 예시: 돈 S 기울어요, 준비 W 뚜렷해요, 정하는 사람 U 기울어요, 지쳤을 때 A 반반이에요",
    formBit: 0,
    axes: {
      money: { rows: SWUA_MONEY, self: { side: "back", level: 2 } },
      process: { rows: CLEAR_A, self: { side: "front", level: 3 } },
      scope: { rows: LEAN_A, self: { side: "front", level: 2 } },
      support: { rows: EVEN_BACK, self: { side: "back", level: 1 } },
    },
  },
  {
    name: "all-clear",
    description: "네 주제 모두 뚜렷해요",
    formBit: 1,
    axes: {
      money: { rows: CLEAR_A, self: { side: "front", level: 3 } },
      process: { rows: negate(CLEAR_B), self: { side: "back", level: 2 } },
      scope: { rows: negate(CLEAR_A), self: { side: "back", level: 3 } },
      support: { rows: CLEAR_B, self: { side: "front", level: 2 } },
    },
  },
  {
    name: "all-even",
    description: "네 주제 모두 반반이에요(확정 글자는 있음)",
    formBit: 0,
    axes: {
      money: { rows: EVEN_FRONT, self: { side: "front", level: 1 } },
      process: { rows: EVEN_BACK, self: "skip" },
      scope: { rows: EVEN_FRONT, self: { side: "back", level: 2 } },
      support: { rows: EVEN_BACK, self: "na" },
    },
  },
  {
    name: "mixed-bands",
    description: "뚜렷해요, 기울어요, 반반이에요가 모두 섞임",
    formBit: 1,
    axes: {
      money: { rows: CLEAR_A, self: { side: "front", level: 2 } },
      process: { rows: negate(LEAN_A), self: { side: "back", level: 2 } },
      scope: { rows: EVEN_BACK, self: { side: "back", level: 1 } },
      support: { rows: LEAN_B, self: { side: "front", level: 3 } },
    },
  },
  {
    name: "unusable-axis",
    description: "한 주제의 유효 답이 12개 미만이라 글자 자리가 가운뎃점",
    formBit: 0,
    axes: {
      money: { rows: negate(LEAN_A), self: { side: "back", level: 2 } },
      process: { rows: CLEAR_B, self: { side: "front", level: 2 } },
      scope: {
        rows: LEAN_B,
        self: "skip",
        omit: [
          { facet: 0, family: "pair", as: "skip" },
          { facet: 0, family: "react", as: "skip" },
          { facet: 1, family: "choose", as: "skip" },
          { facet: 1, family: "heavy", as: "skip" },
          { facet: 2, family: "pair", as: "na" },
          { facet: 3, family: "react", as: "na" },
        ],
      },
      support: { rows: negate(LEAN_B), self: { side: "back", level: 1 } },
    },
  },
  {
    name: "provisional-tie",
    description: "한 주제가 동점 사슬 끝까지 가서 앞 글자를 임시로 적음",
    formBit: 1,
    axes: {
      money: { rows: LEAN_A, self: { side: "front", level: 2 } },
      process: { rows: negate(EVEN_FRONT), self: { side: "back", level: 1 } },
      scope: { rows: negate(CLEAR_B), self: { side: "back", level: 3 } },
      support: { rows: TIE_LEVEL_4_OR_5, self: "skip" },
    },
  },
  {
    name: "tie-chain",
    description: "동점 사슬 1에서 4단계에서 갈리는 주제들",
    formBit: 0,
    axes: {
      money: { rows: TIE_LEVEL_1, self: { side: "front", level: 2 } },
      process: { rows: TIE_LEVEL_2, self: { side: "back", level: 1 } },
      scope: { rows: TIE_LEVEL_3, self: { side: "front", level: 3 } },
      support: { rows: TIE_LEVEL_4_OR_5, self: { side: "back", level: 2 } },
    },
  },
  {
    name: "rhythm-hint",
    description: "위치 반복 형식이 2개라 세기가 한 단계 낮춰짐",
    formBit: 0,
    // 두 가지 중 고르기는 늘 위 카드 아주, 이럴 때는 늘 오른쪽 끝을 눌렀다. 고르기와 무거운 형식만 값을 만든다.
    pressed: { pair: 0, react: 4 },
    axes: {
      money: { rows: [[X, X, 6, 6], [X, X, 6, 6], [X, X, 6, 6], [X, X, 6, 6]], self: { side: "front", level: 2 } },
      process: { rows: [[X, X, 2, 6], [X, X, 6, 2], [X, X, 2, 2], [X, X, 6, 2]], self: { side: "front", level: 2 } },
      scope: { rows: [[X, X, -6, -2], [X, X, -2, -6], [X, X, -6, -2], [X, X, -2, -2]], self: { side: "back", level: 2 } },
      support: { rows: [[X, X, 2, -2], [X, X, -2, 2], [X, X, 2, 2], [X, X, -2, -6]], self: { side: "back", level: 1 } },
    },
  },
  {
    name: "rhythm-gate",
    description: "위치 반복 형식이 3개라 코드가 없음",
    formBit: 1,
    // 두 가지 중 고르기는 늘 위 카드 아주, 이럴 때는 늘 왼쪽 끝, 고르기는 늘 첫 보기를 눌렀다.
    pressed: { pair: 0, react: 0, choose: 0 },
    axes: {
      money: { rows: [[X, X, X, 6], [X, X, X, 2], [X, X, X, 6], [X, X, X, -2]], self: { side: "front", level: 1 } },
      process: { rows: [[X, X, X, -6], [X, X, X, -2], [X, X, X, -6], [X, X, X, 2]], self: { side: "back", level: 1 } },
      scope: { rows: [[X, X, X, 2], [X, X, X, 2], [X, X, X, -2], [X, X, X, 2]], self: "skip" },
      support: { rows: [[X, X, X, 6], [X, X, X, 6], [X, X, X, -6], [X, X, X, 2]], self: "na" },
    },
  },
  {
    name: "skip-hint",
    description: "잘 모르겠어요가 17개 이상이라 세기가 낮춰짐",
    formBit: 0,
    axes: {
      money: {
        rows: CLEAR_A,
        self: { side: "front", level: 2 },
        omit: [
          { facet: 0, family: "pair", as: "skip" },
          { facet: 1, family: "react", as: "skip" },
          { facet: 2, family: "choose", as: "skip" },
          { facet: 3, family: "heavy", as: "skip" },
        ],
      },
      process: {
        rows: negate(LEAN_A),
        self: { side: "back", level: 2 },
        omit: [
          { facet: 0, family: "react", as: "skip" },
          { facet: 1, family: "choose", as: "skip" },
          { facet: 2, family: "heavy", as: "skip" },
          { facet: 3, family: "pair", as: "skip" },
        ],
      },
      scope: {
        rows: LEAN_B,
        self: "skip",
        omit: [
          { facet: 0, family: "pair", as: "skip" },
          { facet: 1, family: "react", as: "skip" },
          { facet: 2, family: "choose", as: "skip" },
          { facet: 3, family: "heavy", as: "skip" },
          { facet: 0, family: "choose", as: "skip" },
        ],
      },
      support: {
        rows: CLEAR_B,
        self: { side: "front", level: 2 },
        omit: [
          { facet: 0, family: "choose", as: "skip" },
          { facet: 1, family: "heavy", as: "skip" },
          { facet: 2, family: "pair", as: "skip" },
          { facet: 3, family: "react", as: "skip" },
        ],
      },
    },
  },
  {
    name: "self-contrast",
    description: "직접 고른 쪽 대비가 나오는 주제(자기 선택이 답 쪽과 다르고 꽤 이상)",
    formBit: 1,
    axes: {
      money: { rows: CLEAR_A, self: { side: "front", level: 3 } },
      process: { rows: LEAN_A, self: { side: "back", level: 3 } },
      scope: { rows: negate(CLEAR_B), self: { side: "front", level: 2 } },
      support: { rows: EVEN_BACK, self: { side: "front", level: 3 } },
    },
  },
  {
    name: "couple-partner",
    description: "swua-example 와 짝으로 두 사람 비교(다른 글자, 이야기해 볼 질문, 비슷한 질문)가 나오는 상대 표본",
    formBit: 1,
    axes: {
      money: { rows: negate(SWUA_MONEY), self: { side: "front", level: 2 } },
      process: { rows: [[6, 6, 4, 6], [6, 6, 6, 2], [4, 6, 6, 6], [6, 3, 6, 6]], self: { side: "front", level: 2 } },
      scope: { rows: negate(LEAN_A), self: { side: "back", level: 2 } },
      // 지친 날 주제: 반반이에요이지만 세 번째 측면은 swua-example 와 같은 쪽으로 세게 골랐다(비슷한 질문이 여러 주제에서 나오게).
      support: { rows: [[-2, 3, 2, -2], [2, -3, 2, 2], [4, -3, 6, -6], [4, 3, 2, -2]], self: { side: "front", level: 1 } },
    },
  },
];

/** 고정 표본 이름 열두 개(README 6절 고정 표본 표 순서). */
export const V40_FIXTURE_NAMES: readonly string[] = PLANS.map((plan) => plan.name);

/**
 * 이 은행으로 고정 표본 12개를 만든다(README 6절 고정 표본). 은행의 문구가 아니라 배치 골격(극, 형식, 측면)만 쓰므로
 * 문구가 바뀌거나 다른 문구의 은행이어도 같은 뜻의 표본이 나온다.
 */
export function buildFixtures(bank: Bank): readonly V40Fixture[] {
  return Object.freeze(
    PLANS.map((plan) =>
      Object.freeze({
        name: plan.name,
        description: plan.description,
        formBit: plan.formBit,
        responses: Object.freeze(buildFixtureResponses(bank, plan)),
      }),
    ),
  );
}

/** 출하 은행으로 만든 고정 표본 12개(README 6절 고정 표본). 화면 빌더가 이것을 실제 채점기에 넣어 화면을 그린다. */
export const V40_FIXTURES: readonly V40Fixture[] = buildFixtures(WEDDING_CODE_V40_BANK);

/** 이름으로 출하 표본 하나를 찾는다(README 6절 고정 표본). 없으면 undefined. */
export function fixtureByName(name: string): V40Fixture | undefined {
  return V40_FIXTURES.find((fixture) => fixture.name === name);
}
