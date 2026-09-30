/**
 * 웨딩코드 4.0 채점 모의 시험 도우미(simulation.test.ts 가 쓴다).
 *
 * 설계 검증 스크립트(design/workF/analyze.js, presets.js, ties.js, workA/sim2.js)의 사람 모형과 응답 전략을
 * 진짜 TypeScript 코드(bank, present.toStored, value, score, gates) 위로 옮긴 것이다. 가정 모형이며 실측이 아니다.
 * 문항 문구는 읽지 않는다. 쓰는 것은 배치(형식, 축, 측면, 순서)와 극(cards, options, entries, highPole)뿐이라
 * 은행 문구가 바뀌어도 이 도구는 그대로 돈다. 난수는 설계 스크립트와 같은 mulberry32 이고 시드는 시험이 고정한다.
 * 이 파일은 시험 도구라서 판정에 부동소수를 써도 되지만, 채점 결과는 언제나 진짜 scoreResponses 가 낸다.
 */
import { V40_AXIS_KEYS, axisInfo } from "@/constants/weddingCodeV40";
import type { Bank, FormBit, Responses, ResponseValue, ScoredItem, SelfItem, Side, ViewAnswer } from "./types";
import { WEDDING_CODE_V40_BANK } from "./bank";
import { toStored } from "./present";
import { bestWorstPairOf, bestWorstStateOf, splitCountsOf, splitStateOf, stateChar } from "./states";
import { itemValue } from "./value";

// ---------------------------------------------------------------------------
// 은행 사실(순서, 형식 묶음, 측면 색인)
// ---------------------------------------------------------------------------

export const SIM_BANK: Bank = WEDDING_CODE_V40_BANK;

/** 채점 문항 64개(질문 순서 = 화면 순서 = 설계 스크립트의 order). */
export const ITEMS: readonly ScoredItem[] = SIM_BANK.scored;

/** 설계 스크립트의 서식 묶음: recall 과 instant 는 choose 로 합친다(거울 짝이 서로 다른 하위 종류일 수 있다). */
export type Family = "pair" | "react" | "choose" | "bestworst" | "split";

export const FAMILIES: readonly Family[] = ["pair", "react", "choose", "bestworst", "split"];

/** 문항의 서식 묶음. */
export function familyOf(item: ScoredItem): Family {
  return item.fmt === "recall" || item.fmt === "instant" ? "choose" : item.fmt;
}

/** 문항별 정적 색인(질문 순서 i 로 읽는다). */
export interface ItemFacts {
  readonly item: ScoredItem;
  /** 질문 순서 색인(설계의 g). */
  readonly index: number;
  /** 주제 색인 0에서 3(돈, 준비, 정하는 사람, 지쳤을 때). */
  readonly axis: number;
  /** 주제 안 측면 색인 0에서 3. */
  readonly facet: number;
  readonly family: Family;
  /** 구간 0에서 3(설계의 c). */
  readonly section: number;
  /** 서식 묶음 안 순번(설계의 fi). */
  readonly familyIndex: number;
}

export const FACTS: readonly ItemFacts[] = (() => {
  const counters: Record<Family, number> = { pair: 0, react: 0, choose: 0, bestworst: 0, split: 0 };
  return ITEMS.map((item, index): ItemFacts => {
    const family = familyOf(item);
    const familyIndex = counters[family];
    counters[family] += 1;
    return {
      item,
      index,
      axis: V40_AXIS_KEYS.indexOf(item.axis),
      facet: axisInfo(item.axis).facets.indexOf(item.facet),
      family,
      section: item.section,
      familyIndex,
    };
  });
})();

// ---------------------------------------------------------------------------
// 난수
// ---------------------------------------------------------------------------

/** 0 이상 1 미만의 난수를 내는 함수. */
export type Rng = () => number;

/** 설계 스크립트(analyze.js 의 rngFactory)와 같은 mulberry32. 같은 시드는 같은 열을 낸다. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 난수 도구 묶음. */
export interface Sampler {
  readonly R: Rng;
  /** 표준정규분포(Box-Muller, 설계 스크립트와 같은 소비 순서). */
  randn(): number;
  /** a 이상 b 이하의 정수. */
  rint(a: number, b: number): number;
}

/** 시드로 난수 도구를 만든다. */
export function makeSampler(seed: number): Sampler {
  const R = makeRng(seed);
  return {
    R,
    randn: () => {
      let u = 0;
      let v = 0;
      while (u === 0) u = R();
      while (v === 0) v = R();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    rint: (a, b) => a + Math.floor(R() * (b - a + 1)),
  };
}

// ---------------------------------------------------------------------------
// 화면 기준 응답(설계 스크립트의 r 표현)을 화면 답으로, 다시 저장값으로
// ---------------------------------------------------------------------------

/**
 * 설계 스크립트의 응답 표현(화면 기준). pair: pos 1 은 위 카드, -1 은 아래 카드, m 은 세기 1에서 3.
 * react: 왼쪽에서 오른쪽 칸 1에서 5. choose: 화면 보기 1에서 4. bestworst: 화면 카드 색인. split: 화면 순서 칸 수.
 */
export type ScreenAnswer =
  | { readonly kind: "pair"; readonly pos: 1 | -1; readonly m: 1 | 2 | 3 }
  | { readonly kind: "react"; readonly col: number }
  | { readonly kind: "choose"; readonly col: number }
  | { readonly kind: "bestworst"; readonly best: number; readonly worst: number }
  | { readonly kind: "split"; readonly counts: readonly [number, number, number] };

/** 화면 기준 응답을 진짜 화면 답(ViewAnswer)으로 바꾼다. 문항 형식과 맞지 않으면 던진다(시험 자료 오류). */
export function viewAnswerOf(item: ScoredItem, answer: ScreenAnswer): ViewAnswer {
  switch (answer.kind) {
    case "pair":
      if (item.fmt !== "pair") break;
      return { fmt: "pair", cell: answer.pos === 1 ? 3 - answer.m : 2 + answer.m };
    case "react":
      if (item.fmt !== "react") break;
      return { fmt: "react", cell: answer.col - 1 };
    case "choose":
      if (item.fmt !== "recall" && item.fmt !== "instant") break;
      return { fmt: item.fmt, option: answer.col - 1 };
    case "bestworst":
      if (item.fmt !== "bestworst") break;
      return { fmt: "bestworst", best: answer.best, worst: answer.worst };
    case "split":
      if (item.fmt !== "split") break;
      return { fmt: "split", counts: answer.counts };
  }
  throw new Error(`응답 종류 ${answer.kind} 가 문항 ${item.id}(${item.fmt}) 와 맞지 않는다`);
}

/** 화면 기준 응답 64개를 폼 비트로 누른 것으로 보고 진짜 toStored 를 거쳐 저장값 64개(채점 문항만)를 만든다. */
export function respondFromScreen(formBit: FormBit, answers: readonly ScreenAnswer[]): Responses {
  const record: Record<string, ResponseValue> = {};
  for (let i = 0; i < ITEMS.length; i += 1) {
    const item = ITEMS[i];
    const stored = toStored(item, formBit, viewAnswerOf(item, answers[i]));
    if (stored === null) throw new Error(`저장값으로 바꿀 수 없는 화면 응답: ${item.id}`);
    record[item.id] = stored;
  }
  return record;
}

/** 무작위 화면 기준 응답 하나(설계 스크립트의 randomResp 와 같은 소비 순서). */
export function randomScreenAnswer(sampler: Sampler, item: ScoredItem): ScreenAnswer {
  switch (familyOf(item)) {
    case "pair": {
      const pos = sampler.R() < 0.5 ? 1 : -1;
      const m = sampler.rint(1, 3) as 1 | 2 | 3;
      return { kind: "pair", pos, m };
    }
    case "react":
      return { kind: "react", col: sampler.rint(1, 5) };
    case "choose":
      return { kind: "choose", col: sampler.rint(1, 4) };
    case "bestworst": {
      const best = sampler.rint(0, 3);
      let worst = sampler.rint(0, 2);
      if (worst >= best) worst += 1;
      return { kind: "bestworst", best, worst };
    }
    case "split": {
      const counts: [number, number, number] = [0, 0, 0];
      for (let t = 0; t < 6; t += 1) counts[sampler.rint(0, 2)] += 1;
      return { kind: "split", counts };
    }
  }
}

/** 문항 64개 모두 무작위 화면 기준 응답. */
export function randomScreenAnswers(sampler: Sampler): ScreenAnswer[] {
  return ITEMS.map((item) => randomScreenAnswer(sampler, item));
}

/**
 * 서식 묶음과 분류 값이 같은 문항이 같은 무작위 응답을 공유하는 응답열(설계 스크립트의 classResp / 주기 응답).
 * 분류 함수가 문항 위치에만 좌우되는 응답을 만든다. 서식이 다르면 응답도 따로 뽑는다.
 */
export function classScreenAnswers(sampler: Sampler, classOf: (facts: ItemFacts) => string | number): ScreenAnswer[] {
  const table = new Map<string, ScreenAnswer>();
  return FACTS.map((facts) => {
    const key = `${facts.family}:${classOf(facts)}`;
    let answer = table.get(key);
    if (answer === undefined) {
      answer = randomScreenAnswer(sampler, facts.item);
      table.set(key, answer);
    }
    return answer;
  });
}

// ---------------------------------------------------------------------------
// 고정 응답 목록(설계 1a): 형식마다 하나의 칸만 계속 누른다
// ---------------------------------------------------------------------------

export interface FixedChoice {
  readonly family: Family;
  readonly answer: ScreenAnswer;
}

/** 설계 스크립트의 고정 응답 31가지: pair 6, react 5, choose 4, bestworst 12, split 4(한 칸에 몰기 3 + 2:2:2). */
export function specFixedChoices(): FixedChoice[] {
  const list: FixedChoice[] = [];
  for (const pos of [1, -1] as const) for (const m of [1, 2, 3] as const) list.push({ family: "pair", answer: { kind: "pair", pos, m } });
  for (let col = 1; col <= 5; col += 1) list.push({ family: "react", answer: { kind: "react", col } });
  for (let col = 1; col <= 4; col += 1) list.push({ family: "choose", answer: { kind: "choose", col } });
  for (let best = 0; best < 4; best += 1) {
    for (let worst = 0; worst < 4; worst += 1) if (best !== worst) list.push({ family: "bestworst", answer: { kind: "bestworst", best, worst } });
  }
  list.push({ family: "split", answer: { kind: "split", counts: [6, 0, 0] } });
  list.push({ family: "split", answer: { kind: "split", counts: [0, 6, 0] } });
  list.push({ family: "split", answer: { kind: "split", counts: [0, 0, 6] } });
  list.push({ family: "split", answer: { kind: "split", counts: [2, 2, 2] } });
  return list;
}

/** 칸 나누기 28가지 전부를 한 칸으로 고정하는 확장 목록(설계보다 넓다): pair 6, react 5, choose 4, bestworst 12, split 28. */
export function extendedFixedChoices(): FixedChoice[] {
  const list = specFixedChoices().filter((choice) => choice.family !== "split");
  for (let a = 0; a <= 6; a += 1) {
    for (let b = 0; a + b <= 6; b += 1) list.push({ family: "split", answer: { kind: "split", counts: [a, b, 6 - a - b] } });
  }
  return list;
}

// ---------------------------------------------------------------------------
// 부주의 응답 전략(설계 3b): 서식 묶음 안 순번 idx 로 누르는 칸이 정해진다
// ---------------------------------------------------------------------------

export type CarelessRule = (family: Family, idx: number) => ScreenAnswer;

const oneHot = (index: number): [number, number, number] => {
  const counts: [number, number, number] = [0, 0, 0];
  counts[index] = 6;
  return counts;
};

/** 설계 스크립트 analyze.js 의 careless 여섯 가지(이름도 그대로). */
export const CARELESS_RULES: Readonly<Record<string, CarelessRule>> = {
  "전부 첫 칸": (family) =>
    family === "pair" ? { kind: "pair", pos: 1, m: 2 }
    : family === "react" ? { kind: "react", col: 1 }
    : family === "choose" ? { kind: "choose", col: 1 }
    : family === "bestworst" ? { kind: "bestworst", best: 0, worst: 3 }
    : { kind: "split", counts: [6, 0, 0] },
  "전부 높은 칸": (family) =>
    family === "pair" ? { kind: "pair", pos: -1, m: 3 }
    : family === "react" ? { kind: "react", col: 5 }
    : family === "choose" ? { kind: "choose", col: 4 }
    : family === "bestworst" ? { kind: "bestworst", best: 3, worst: 0 }
    : { kind: "split", counts: [0, 6, 0] },
  "좌우 번갈아": (family, idx) =>
    family === "pair" ? { kind: "pair", pos: idx % 2 ? -1 : 1, m: 2 }
    : family === "react" ? { kind: "react", col: idx % 2 ? 4 : 2 }
    : family === "choose" ? { kind: "choose", col: idx % 2 ? 3 : 1 }
    : family === "bestworst" ? { kind: "bestworst", best: idx % 2 ? 3 : 0, worst: idx % 2 ? 0 : 3 }
    : { kind: "split", counts: idx % 2 ? [0, 6, 0] : [6, 0, 0] },
  "1-2-3-4(-5) 돌려": (family, idx) =>
    family === "pair" ? { kind: "pair", pos: idx % 4 < 2 ? 1 : -1, m: (1 + (idx % 3)) as 1 | 2 | 3 }
    : family === "react" ? { kind: "react", col: 1 + (idx % 5) }
    : family === "choose" ? { kind: "choose", col: 1 + (idx % 4) }
    : family === "bestworst" ? { kind: "bestworst", best: idx % 4, worst: (idx + 2) % 4 }
    : { kind: "split", counts: oneHot(idx % 3) },
  "세 번 주기": (family, idx) =>
    family === "pair" ? { kind: "pair", pos: ([1, 1, -1] as const)[idx % 3], m: 2 }
    : family === "react" ? { kind: "react", col: [2, 4, 3][idx % 3] }
    : family === "choose" ? { kind: "choose", col: [1, 3, 4][idx % 3] }
    : family === "bestworst" ? { kind: "bestworst", best: idx % 3, worst: 3 }
    : { kind: "split", counts: oneHot(idx % 3) },
  "다섯 번 주기": (family, idx) =>
    family === "pair" ? { kind: "pair", pos: ([1, -1, -1, 1, -1] as const)[idx % 5], m: (1 + (idx % 3)) as 1 | 2 | 3 }
    : family === "react" ? { kind: "react", col: [1, 3, 5, 2, 4][idx % 5] }
    : family === "choose" ? { kind: "choose", col: [1, 2, 4, 3, 1][idx % 5] }
    : family === "bestworst" ? { kind: "bestworst", best: idx % 4, worst: (idx + 1) % 4 }
    : { kind: "split", counts: oneHot((idx * 2) % 3) },
};

/** 서식 묶음 안 순번으로 응답을 정하는 규칙을 문항 64개에 적용한다. */
export function patternedAnswers(rule: CarelessRule): ScreenAnswer[] {
  return FACTS.map((facts) => rule(facts.family, facts.familyIndex));
}

// ---------------------------------------------------------------------------
// 진짜 코드로 잰 합
// ---------------------------------------------------------------------------

/** 주제 x 서식 묶음 합(진짜 itemValue). 답이 없는 문항은 빠진 값이라 더하지 않는다. */
export function sumsByAxisAndFamily(responses: Responses): number[][] {
  const sums = V40_AXIS_KEYS.map(() => FAMILIES.map(() => 0));
  for (const facts of FACTS) {
    const value = itemValue(facts.item, responses[facts.item.id]);
    if (value !== null) sums[facts.axis][FAMILIES.indexOf(facts.family)] += value;
  }
  return sums;
}

/** 주제 x 하위 형식(recall 과 instant 를 나눈 여섯 형식) 합. */
export function sumsByAxisAndFormat(responses: Responses): Map<string, number>[] {
  const sums = V40_AXIS_KEYS.map(() => new Map<string, number>());
  for (const facts of FACTS) {
    const value = itemValue(facts.item, responses[facts.item.id]);
    if (value !== null) sums[facts.axis].set(facts.item.fmt, (sums[facts.axis].get(facts.item.fmt) ?? 0) + value);
  }
  return sums;
}

// ---------------------------------------------------------------------------
// 사람 모형(설계 presets.js / ties.js / sim2.js): 잠재 성향 + 측면 편차 + 문항 잡음
// ---------------------------------------------------------------------------

export interface Preset {
  readonly lambda: number;
  readonly facetSd: number;
  readonly noise: number;
  readonly drift: number;
  readonly facetDrift: number;
}

/** 세 가정(낙관, 중간, 비관). 설계 스크립트의 PRESETS 그대로. */
export const PRESETS = {
  optimistic: { lambda: 1.0, facetSd: 0.5, noise: 1.0, drift: 0.25, facetDrift: 0.2 },
  moderate: { lambda: 0.65, facetSd: 0.7, noise: 1.15, drift: 0.35, facetDrift: 0.3 },
  pessimistic: { lambda: 0.45, facetSd: 0.9, noise: 1.3, drift: 0.5, facetDrift: 0.4 },
} as const satisfies Record<string, Preset>;

export type PresetName = keyof typeof PRESETS;

export const PRESET_NAMES: readonly PresetName[] = ["optimistic", "moderate", "pessimistic"];

/** 서식별 신호 세기 기본값(설계 스크립트의 BASE). */
const BASE_LAMBDA: Readonly<Record<ScoredItem["fmt"], number>> = {
  pair: 1.0,
  react: 0.8,
  recall: 0.9,
  instant: 0.9,
  bestworst: 0.9,
  split: 1.0,
};

/** 한 사람의 잠재 성향과 응답 습관. */
export interface Person {
  /** 주제별 성향(양수는 앞극 쪽). */
  readonly theta: readonly number[];
  /** 주제 x 측면 편차. */
  readonly u: readonly (readonly number[])[];
  /** 동의 치우침(이럴 때 칸을 위로 미는 정도). */
  readonly acq: number;
  /** 극단 선호 배율. */
  readonly ext: number;
  /** 첫 카드 쪽 위치 치우침. */
  readonly posB: number;
}

/**
 * 새 사람 한 명(설계 스크립트와 같은 소비 순서: 공통 성향, 주제 성향 4, 측면 편차 16, 그다음 습관 셋).
 * ties.js 는 습관을 ext, acq, posB 순으로 뽑고 나머지는 acq, ext, posB 순이라 옵션으로 고른다.
 */
export function newPerson(sampler: Sampler, preset: Preset, options: { readonly extFirst?: boolean } = {}): Person {
  const shared = sampler.randn();
  const theta = V40_AXIS_KEYS.map(() => Math.sqrt(0.1) * shared + Math.sqrt(0.9) * sampler.randn());
  const u = V40_AXIS_KEYS.map(() => [0, 1, 2, 3].map(() => sampler.randn() * preset.facetSd));
  let acq: number;
  let ext: number;
  if (options.extFirst) {
    ext = Math.exp(sampler.randn() * 0.25);
    acq = sampler.randn() * 0.5;
  } else {
    acq = sampler.randn() * 0.5;
    ext = Math.exp(sampler.randn() * 0.25);
  }
  const posB = sampler.randn() * 0.25;
  return { theta, u, acq, ext, posB };
}

/** 재검사 때의 성향 이동(주제 성향 4개, 측면 편차 16개를 이 순서로 뽑는다). */
export function driftTraits(sampler: Sampler, preset: Preset, person: Person): { readonly theta: number[]; readonly u: number[][] } {
  const theta = person.theta.map((t) => t + sampler.randn() * preset.drift);
  const u = person.u.map((row) => row.map((v) => v + sampler.randn() * preset.facetDrift));
  return { theta, u };
}

/** 문항마다 고정된 작은 치우침(설계의 OFFSET). 시험 한 번에 한 벌을 뽑아 모든 응답자가 공유한다. */
export function makeOffsets(sampler: Sampler): number[] {
  return ITEMS.map(() => sampler.randn() * 0.3);
}

/** respondStates 옵션. splitOrder: 칸 나누기 효용을 뽑는 항목 순서(semantic = presets.js, ties.js 의 앞·뒤·중립, bank = analyze.js 의 은행 순서). */
export interface RespondOptions {
  readonly splitOrder?: "semantic" | "bank";
}

/** 형식별 저장 상태 색인을 모형의 잠재 반응 x 에서 뽑는다(설계 스크립트의 resp 와 같은 소비 순서). */
function stateFromModel(item: ScoredItem, x: number, person: Person, sampler: Sampler, bankSplit: boolean): number {
  switch (item.fmt) {
    case "pair": {
      // 첫 카드에 대한 효용. 첫 카드가 앞극이면 x, 뒤극이면 -x 에 위치 치우침을 더한다.
      const toward = (item.cards[0].pole === "front" ? x : -x) + person.posB;
      const magnitude = Math.abs(toward * person.ext);
      const level = magnitude < 0.6 ? 1 : magnitude < 1.4 ? 2 : 3;
      return toward > 0 ? 3 - level : 2 + level;
    }
    case "react": {
      const k = item.highPole === "front" ? 1 : -1;
      const column = Math.max(1, Math.min(5, Math.round(3 + k * x * person.ext + person.acq + sampler.randn() * 0.3)));
      return column - 1;
    }
    case "recall":
    case "instant": {
      const z = x + sampler.randn() * 0.3;
      const t = 1 / person.ext;
      const wanted = z > t ? 6 : z > 0 ? 2 : z > -t ? -2 : -6;
      const index = item.options.findIndex((option) => (option.pole === "front" ? 1 : -1) * (option.strength === "strong" ? 6 : 2) === wanted);
      if (index < 0) throw new Error(`${item.id}: 값 ${wanted} 를 내는 보기가 없다`);
      return index;
    }
    case "bestworst": {
      const appeal = item.cards.map((card) => (card.pole === "front" ? 1 : -1) * x * 0.9 + sampler.randn());
      let best = 0;
      let worst = 0;
      appeal.forEach((value, j) => {
        if (value > appeal[best]) best = j;
        if (value < appeal[worst]) worst = j;
      });
      if (best === worst) worst = (best + 1) % 4;
      return bestWorstStateOf(best, worst);
    }
    case "split": {
      // semantic: 항목 효용을 (앞, 뒤, 중립) 순서로 뽑고(presets.js, ties.js) 나온 칸 수를 은행 순서로 옮긴다.
      // bank: 효용을 은행 순서(첫 항목이 앞극이면 x, 뒤극이면 -x)로 뽑는다(analyze.js). 어느 쪽이든 분포는 같고 난수 소비 개수도 같다.
      const frontFirst = item.entries[0].pole === "front";
      const utility = bankSplit ? [frontFirst ? x : -x, frontFirst ? -x : x, sampler.randn() * 0.4] : [x, -x, sampler.randn() * 0.4];
      const top = Math.max(...utility);
      const weights = utility.map((v) => Math.exp((v - top) / 0.6));
      const total = weights.reduce((sum, v) => sum + v, 0);
      const semantic = [0, 0, 0];
      for (let t = 0; t < 6; t += 1) {
        let r = sampler.R() * total;
        let j = 0;
        while (j < 2 && r > weights[j]) {
          r -= weights[j];
          j += 1;
        }
        semantic[j] += 1;
      }
      if (bankSplit) return splitStateOf(semantic[0], semantic[1]);
      return splitStateOf(frontFirst ? semantic[0] : semantic[1], frontFirst ? semantic[1] : semantic[0]);
    }
  }
}

/**
 * 한 사람의 채점 문항 64개 저장 상태 색인(폼 비트와 무관한 은행 기준). th, u 는 그 응답 때의 성향(재검사는 이동한 값).
 * 폼 비트로 누르는 것은 pressStates 가 맡는다.
 */
export function respondStates(
  sampler: Sampler,
  preset: Preset,
  offsets: readonly number[],
  person: Person,
  theta: readonly number[],
  u: readonly (readonly number[])[],
  options: RespondOptions = {},
): number[] {
  const bankSplit = options.splitOrder === "bank";
  return FACTS.map((facts) => {
    const x = BASE_LAMBDA[facts.item.fmt] * preset.lambda * (theta[facts.axis] + u[facts.axis][facts.facet]) + offsets[facts.index] + sampler.randn() * preset.noise;
    return stateFromModel(facts.item, x, person, sampler, bankSplit);
  });
}

/** 저장 상태 색인 -> 저장 문자(폼 비트를 거치지 않는 지름길. 형식 밖 색인이면 던진다). */
export function storedFromStates(states: readonly number[]): Responses {
  const record: Record<string, ResponseValue> = {};
  for (let i = 0; i < ITEMS.length; i += 1) record[ITEMS[i].id] = stateChar(states[i]);
  return record;
}

/**
 * 저장 상태 색인에 대응하는 화면 답: 폼 비트 1 이면 위아래, 좌우, 보기, 카드, 앞 두 항목 순서가 뒤집힌 화면에서 누른 것.
 * present.toStored 의 역 규칙을 이 도구가 따로 적은 것이라 pressStates 가 저장 문자를 되찾는지로 두 쪽이 서로 검산된다.
 */
export function viewAnswerForState(item: ScoredItem | SelfItem, formBit: FormBit, state: number): ViewAnswer {
  const flip = formBit === 1;
  switch (item.fmt) {
    case "pair":
    case "self":
      return { fmt: item.fmt, cell: flip ? 5 - state : state };
    case "react":
      return { fmt: "react", cell: flip ? 4 - state : state };
    case "recall":
    case "instant":
      return { fmt: item.fmt, option: flip ? 3 - state : state };
    case "bestworst": {
      const { best, worst } = bestWorstPairOf(state);
      return { fmt: "bestworst", best: flip ? 3 - best : best, worst: flip ? 3 - worst : worst };
    }
    case "split": {
      const [a, b, c] = splitCountsOf(state);
      return { fmt: "split", counts: flip ? [b, a, c] : [a, b, c] };
    }
  }
}

/** 저장 상태 색인 64개를 그 폼 비트 화면에서 누른 것으로 보고 진짜 toStored 를 거쳐 저장값을 만든다. */
export function pressStates(formBit: FormBit, states: readonly number[]): Responses {
  const record: Record<string, ResponseValue> = {};
  for (let i = 0; i < ITEMS.length; i += 1) {
    const item = ITEMS[i];
    const stored = toStored(item, formBit, viewAnswerForState(item, formBit, states[i]));
    if (stored === null) throw new Error(`저장값으로 바꿀 수 없는 상태: ${item.id} ${states[i]}`);
    record[item.id] = stored;
  }
  return record;
}

/** 자기 선택 상태 색인: 카드 0 이 그 방향이면 위 카드 세기 level(3 - level), 아니면 아래 카드(2 + level). */
export function selfStateOf(item: SelfItem, side: Side, level: 1 | 2 | 3): number {
  return item.cards[0].pole === side ? 3 - level : 2 + level;
}

/**
 * 자기 선택 답 4개(주제 순서). sim2.js 의 selfResp 와 같은 모형으로 성향에 잡음을 얹어 방향을 고르고 세기는 꽤(2)다.
 * 본 응답의 난수열을 흔들지 않도록 따로 만든 난수 도구를 받는다.
 */
export function selfResponses(sampler: Sampler, preset: Preset, theta: readonly number[], formBit: FormBit): Responses {
  const record: Record<string, ResponseValue> = {};
  for (const item of SIM_BANK.self) {
    const x = theta[V40_AXIS_KEYS.indexOf(item.axis)] * preset.lambda + sampler.randn() * 0.8;
    const state = selfStateOf(item, x > 0 ? "front" : "back", 2);
    const stored = toStored(item, formBit, viewAnswerForState(item, formBit, state));
    if (stored === null) throw new Error(`자기 선택을 저장값으로 바꿀 수 없다: ${item.id}`);
    record[item.id] = stored;
  }
  return record;
}

// ---------------------------------------------------------------------------
// 통계 도구
// ---------------------------------------------------------------------------

/** 오름차순 정렬된 배열의 q 분위(설계 스크립트와 같은 floor(n x q) 색인). */
export function quantileOf(sortedAscending: readonly number[], q: number): number {
  return sortedAscending[Math.min(sortedAscending.length - 1, Math.floor(sortedAscending.length * q))];
}

/** 백분율(소수 둘째 자리 반올림 없이 그대로). */
export function percent(count: number, total: number): number {
  return (count / total) * 100;
}

/** 피어슨 상관(분산이 0 이면 0). */
export function pearson(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i += 1) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

/** 표본 분산(n - 1). */
export function sampleVariance(values: readonly number[]): number {
  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
}

/** 크론바흐 알파: columns[j][n] 은 문항 j 의 응답자 n 의 값. */
export function cronbachAlpha(columns: readonly (readonly number[])[]): number {
  const k = columns.length;
  const totals = columns[0].map((_, n) => columns.reduce((sum, column) => sum + column[n], 0));
  const itemVariance = columns.reduce((sum, column) => sum + sampleVariance(column), 0);
  return (k / (k - 1)) * (1 - itemVariance / sampleVariance(totals));
}
