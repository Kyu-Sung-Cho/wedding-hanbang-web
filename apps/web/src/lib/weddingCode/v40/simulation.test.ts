// @vitest-environment node
/**
 * 웨딩코드 4.0 채점 모의 회귀 시험: 설계 검증 스크립트를 진짜 TypeScript 채점기 위로 옮긴 것.
 *
 * 옮긴 스크립트: design/workF/analyze.js (정적 균형, 상쇄되지 않는 리듬, 리듬 탐지기, 문항 신호), presets.js (세 가정의 띠 분포와 재검사 유지),
 * ties.js (동점 사슬), workA/sim2.js (사람 모형과 자기 선택). 설계 문서 spec.md 4절, 5절(세기, 동점, 주의 검사, 방향 균형), 10절, 부록 B 의 숫자를 확인한다.
 * 모든 모의는 가정 모형이며 실측이 아니다. 문항 문구는 읽지 않는다(형식, 축, 측면, 순서, 극만 쓴다).
 *
 * 시험 층
 * 1. 재현: 설계 스크립트와 같은 시드와 같은 난수 소비 순서로 돌려 설계가 출력한 숫자(부록 B)를 그대로 되찾는다. 배치와 키가 설계와 같고
 *    진짜 채점기가 설계 계산과 같은 값을 낸다는 증거다(analyze.js 는 하나의 난수열로 구역을 차례로 돌리므로 한 덩어리로 재현한다).
 * 2. 새 시드: 시드를 바꿔 다시 돌려도 설계가 밝힌 범위(띠 분포와 유지율 +-3퍼센트포인트 등) 안이다.
 * 3. 정확한 성질: 균형 키잉 때문에 정확히 0 이어야 하는 합은 시드와 무관하게 0 건 어긋남이다.
 * 표본 크기는 설계와 같거나 작고 전체가 몇 초 안에 돈다.
 *
 * 설계 숫자와 다르게 나온 것(기록용): 리듬 탐지기 1개 형식 표시율은 새 시드에서 0.6에서 0.9퍼센트(설계 한 번의 뽑기는 0.50퍼센트),
 * 건너뜀으로 리듬 검사를 피하는 길은 스펙 5절 「막는다」와 달리 15개 건너뜀(형식마다 5개)이면 열린다(아래 「알려진 한계」 시험).
 */
import { describe, expect, it } from "vitest";
import { V40_AXIS_KEYS, V40_COUNTS, V40_STATE_COUNTS } from "@/constants/weddingCodeV40";
import type { FormBit, ResponseValue, Responses, StrengthBand } from "./types";
import { rhythmReport, skippedCount } from "./gates";
import { toStored } from "./present";
import { buildResult, scoreResponses } from "./score";
import { stateChar } from "./states";
import { itemValue } from "./value";
import {
  CARELESS_RULES,
  FACTS,
  FAMILIES,
  ITEMS,
  PRESETS,
  PRESET_NAMES,
  SIM_BANK,
  classScreenAnswers,
  cronbachAlpha,
  driftTraits,
  extendedFixedChoices,
  familyOf,
  makeOffsets,
  makeSampler,
  newPerson,
  patternedAnswers,
  pearson,
  percent,
  pressStates,
  quantileOf,
  randomScreenAnswer,
  randomScreenAnswers,
  respondFromScreen,
  respondStates,
  selfResponses,
  specFixedChoices,
  storedFromStates,
  sumsByAxisAndFamily,
  sumsByAxisAndFormat,
  viewAnswerForState,
} from "./simulation.helpers";
import type { Family, ItemFacts, PresetName, Sampler, ScreenAnswer } from "./simulation.helpers";

// ---------------------------------------------------------------------------
// 시드와 표본 크기 (설계 스크립트와 같은 값)
// ---------------------------------------------------------------------------

/** analyze.js 의 시드. */
const ANALYZE_SEED = 20260929;
/** presets.js 의 시드(가정마다 새로 시작). */
const PRESETS_SEED = 777;
/** ties.js 의 시드(가정마다 새로 시작). */
const TIES_SEED = 99;
/** 새 시드 시험용(설계에 없는 시드). */
const FRESH_SEEDS = [4242, 9001] as const;

const BANDS: readonly StrengthBand[] = ["clear", "lean", "even"];
/** analyze.js 2절이 시험하는, 거울이 상쇄하지 못하는 주기. */
const PERIODS = [3, 5, 6, 7, 9, 10, 11, 13] as const;

/** 함수를 처음 부를 때 한 번만 계산해 두는 지연 값(무거운 모의를 여러 시험이 나눠 쓴다). */
function once<T>(compute: () => T): () => T {
  let cache: { readonly value: T } | undefined;
  return () => {
    if (cache === undefined) cache = { value: compute() };
    return cache.value;
  };
}

const drawFormBit = (sampler: Sampler): FormBit => (sampler.R() < 0.5 ? 1 : 0);

/** 실측 값이 기대 값에서 허용 오차 안인지 본다(어긋나면 메시지에 실측과 기대를 적는다). */
function expectNear(label: string, actual: number, expected: number, tolerance: number): void {
  expect(Math.abs(actual - expected), `${label}: 실측 ${actual.toFixed(3)}, 기대 ${expected} (허용 +-${tolerance})`).toBeLessThanOrEqual(tolerance);
}

// ---------------------------------------------------------------------------
// 응답 분류 함수 (analyze.js 1b): 문항 위치에만 좌우되는 응답
// ---------------------------------------------------------------------------

type ClassFunction = (facts: ItemFacts) => string | number;

const CLASS_FUNCTIONS: readonly (readonly [string, ClassFunction])[] = [
  ["구간 안 위치(16) x 구간 홀짝", (facts) => `${facts.index - facts.section * 16}:${facts.section % 2}`],
  ["전체 순서 mod 32", (facts) => facts.index % 32],
  ["전체 순서 mod 16", (facts) => facts.index % 16],
  ["전체 순서 mod 8", (facts) => facts.index % 8],
  ["전체 순서 mod 4", (facts) => facts.index % 4],
  ["전체 순서 mod 2", (facts) => facts.index % 2],
  ["서식 안 색인 mod 4", (facts) => facts.familyIndex % 4],
  ["서식 안 색인 mod 2", (facts) => facts.familyIndex % 2],
];

// ---------------------------------------------------------------------------
// 재사용 모의: 요약 통계
// ---------------------------------------------------------------------------

interface MagnitudeSummary {
  readonly axes: number;
  readonly nonzero: number;
  readonly ge25: number;
  readonly ge50: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

/** |S| = |축 합| / 96 (답이 완전할 때 진짜 s 와 같다) 목록의 요약. 0.25, 0.5 경계는 24, 48 이라 정확히 비교된다. */
function summarizeMagnitudes(values: number[]): MagnitudeSummary {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    axes: values.length,
    nonzero: values.filter((v) => v !== 0).length,
    ge25: values.filter((v) => v >= 0.25).length,
    ge50: values.filter((v) => v >= 0.5).length,
    p50: quantileOf(sorted, 0.5),
    p95: quantileOf(sorted, 0.95),
    p99: quantileOf(sorted, 0.99),
    max: sorted[sorted.length - 1],
  };
}

/** 응답열 만들기 함수로 trials 번 뽑아 진짜 채점기의 축 합 |sum| / 96 을 모은다. 응답을 먼저 뽑고 폼 비트를 뽑는다(analyze.js 순서). */
function magnitudesOf(sampler: Sampler, trials: number, makeAnswers: () => ScreenAnswer[]): number[] {
  const magnitudes: number[] = [];
  for (let trial = 0; trial < trials; trial += 1) {
    const answers = makeAnswers();
    const formBit = drawFormBit(sampler);
    for (const axis of scoreResponses(SIM_BANK, respondFromScreen(formBit, answers)).axes) magnitudes.push(Math.abs(axis.sum) / 96);
  }
  return magnitudes;
}

interface HonestRun {
  readonly n: number;
  /** 리듬 표시 형식 수 0에서 3 별 사람 수. */
  readonly flagged: number[];
  /** pair, react, choose 별 표시 사람 수. */
  readonly perFamily: number[];
  /** pair, react, choose 별 최적 주기 일치도(agree / considered) 목록. */
  readonly agreement: number[][];
  /** 힌트 적용 전 세기 별 축 관측 수. */
  readonly bands: Record<StrengthBand, number>;
  readonly gateClosed: number;
  readonly demoted: number;
}

/** 정상 응답자(사람 모형) n 명이 폼 비트 화면에서 누른 응답으로 buildResult 를 돌린다. */
function runHonest(sampler: Sampler, formStream: Sampler, preset: (typeof PRESETS)[PresetName], offsets: readonly number[], n: number, splitOrder: "bank" | "semantic"): HonestRun {
  const flagged = [0, 0, 0, 0];
  const perFamily = [0, 0, 0];
  const agreement: number[][] = [[], [], []];
  const bands: Record<StrengthBand, number> = { clear: 0, lean: 0, even: 0 };
  let gateClosed = 0;
  let demoted = 0;
  for (let i = 0; i < n; i += 1) {
    const person = newPerson(sampler, preset);
    const states = respondStates(sampler, preset, offsets, person, person.theta, person.u, { splitOrder });
    const formBit = drawFormBit(formStream);
    const result = buildResult(SIM_BANK, formBit, pressStates(formBit, states));
    flagged[result.rhythm.flaggedCount] += 1;
    result.rhythm.formats.forEach((format, index) => {
      if (format.flagged) perFamily[index] += 1;
      agreement[index].push(format.agree / format.considered);
    });
    for (const axis of result.axes) bands[axis.band!] += 1;
    if (result.gate.closed) gateClosed += 1;
    if (result.notes.demoted) demoted += 1;
  }
  return { n, flagged, perFamily, agreement, bands, gateClosed, demoted };
}

// ---------------------------------------------------------------------------
// analyze.js 한 덩어리 재현 (하나의 난수열로 구역을 차례로)
// ---------------------------------------------------------------------------

interface AnalyzeReplica {
  readonly fixed: { readonly tested: number; readonly nonzero: number };
  readonly classes: readonly { readonly name: string; readonly summary: MagnitudeSummary; readonly maxAbsSum: number }[];
  readonly periods: readonly { readonly period: number; readonly summary: MagnitudeSummary }[];
  readonly random: MagnitudeSummary;
  readonly honest: HonestRun;
  readonly randomFlagged: number[];
  readonly alpha: number[];
  readonly itemRest: Readonly<Record<Family, number>>;
}

const replicateAnalyze = once((): AnalyzeReplica => {
  const s = makeSampler(ANALYZE_SEED);
  // 정상, 무작위 응답자가 누르는 폼 비트는 설계에 없는 값이라 본 난수열을 흔들지 않게 따로 뽑는다(일치도는 폼 비트와 무관하다).
  const formStream = makeSampler(ANALYZE_SEED + 1);

  // 1a. 고정 응답 248가지 (폼 비트 2 x 고정 31 x 축 4), 다른 서식은 무작위로 채운다.
  let tested = 0;
  let fixedNonzero = 0;
  for (const formBit of [0, 1] as const) {
    for (const choice of specFixedChoices()) {
      const answers = FACTS.map((facts) => (facts.family === choice.family ? choice.answer : randomScreenAnswer(s, facts.item)));
      const sums = sumsByAxisAndFamily(respondFromScreen(formBit, answers));
      const column = FAMILIES.indexOf(choice.family);
      for (let axis = 0; axis < 4; axis += 1) {
        tested += 1;
        if (sums[axis][column] !== 0) fixedNonzero += 1;
      }
    }
  }

  // 1b. 위치와 홀짝에만 좌우되는 응답 여덟 종류 x 3,000번 x 축 4 = 각 12,000축
  const classes = CLASS_FUNCTIONS.map(([name, classOf]) => {
    const magnitudes = magnitudesOf(s, 3000, () => classScreenAnswers(s, classOf));
    return { name, summary: summarizeMagnitudes(magnitudes), maxAbsSum: Math.max(...magnitudes) * 96 };
  });

  // 2. 거울이 상쇄하지 못하는 주기와 무작위 응답
  const periods = PERIODS.map((period) => ({
    period,
    summary: summarizeMagnitudes(magnitudesOf(s, 4000, () => classScreenAnswers(s, (facts) => facts.index % period))),
  }));
  const random = summarizeMagnitudes(magnitudesOf(s, 8000, () => randomScreenAnswers(s)));

  // 3a. 리듬 탐지기: 정상 응답자(중간 가정) 8,000명, 무작위 응답 8,000명
  const preset = PRESETS.moderate;
  const offsets = makeOffsets(s);
  const honest = runHonest(s, formStream, preset, offsets, 8000, "bank");
  const randomFlagged = [0, 0, 0, 0];
  for (let i = 0; i < 8000; i += 1) {
    const formBit = drawFormBit(formStream);
    randomFlagged[rhythmReport(SIM_BANK, formBit, respondFromScreen(formBit, randomScreenAnswers(s))).flaggedCount] += 1;
  }

  // 4. 미니 모의: 정상 응답자 6,000명의 문항값(나누기 6)으로 축 알파와 문항-나머지 상관
  const columns: number[][] = ITEMS.map(() => []);
  for (let i = 0; i < 6000; i += 1) {
    const person = newPerson(s, preset);
    const stored = storedFromStates(respondStates(s, preset, offsets, person, person.theta, person.u, { splitOrder: "bank" }));
    for (const facts of FACTS) columns[facts.index].push((itemValue(facts.item, stored[facts.item.id]) ?? 0) / 6);
  }
  const alpha = V40_AXIS_KEYS.map((_, axis) => cronbachAlpha(FACTS.filter((facts) => facts.axis === axis).map((facts) => columns[facts.index])));
  const byFamily: Record<Family, number[]> = { pair: [], react: [], choose: [], bestworst: [], split: [] };
  for (const facts of FACTS) {
    const others = FACTS.filter((other) => other.axis === facts.axis && other.index !== facts.index);
    const rest = columns[facts.index].map((_, n) => others.reduce((sum, other) => sum + columns[other.index][n], 0));
    byFamily[facts.family].push(pearson(columns[facts.index], rest));
  }
  const itemRest = Object.fromEntries(FAMILIES.map((family) => [family, byFamily[family].reduce((sum, r) => sum + r, 0) / byFamily[family].length])) as Record<Family, number>;

  return {
    fixed: { tested, nonzero: fixedNonzero },
    classes,
    periods,
    random,
    honest,
    randomFlagged,
    alpha,
    itemRest,
  };
});

// ---------------------------------------------------------------------------
// presets.js 재현: 세 가정의 띠 분포와 재검사 글자 유지
// ---------------------------------------------------------------------------

interface PresetRun {
  readonly n: number;
  /** 반반이에요 축이 0에서 4개인 사람 수. */
  readonly evenCount: number[];
  /** 힌트 적용 전 세기별 축 관측 수(첫 응답). */
  readonly bandCount: Record<StrengthBand, number>;
  /** 세기별로 재검사 글자가 같았던 축 수(진짜 글자 비교). */
  readonly keep: Record<StrengthBand, number>;
  /** 설계 정의: 재검사 합의 부호가 같거나 첫 합이 0 인 축 수. */
  readonly keepBySign: Record<StrengthBand, number>;
  readonly all4: number;
  readonly all4BySign: number;
  /** 첫 응답이 관문에서 닫힌 사람 수. */
  readonly gateClosed: number;
  /** 주제별 재검사 축 점수(s = N / (72 x m)) 상관 r (주제 순서 4개). */
  readonly retestR: number[];
}

function runPreset(name: PresetName, seed: number, n: number): PresetRun {
  const preset = PRESETS[name];
  const s = makeSampler(seed);
  const formStream = makeSampler(seed + 1);
  const offsets = makeOffsets(s);
  const evenCount = [0, 0, 0, 0, 0];
  const bandCount: Record<StrengthBand, number> = { clear: 0, lean: 0, even: 0 };
  const keep: Record<StrengthBand, number> = { clear: 0, lean: 0, even: 0 };
  const keepBySign: Record<StrengthBand, number> = { clear: 0, lean: 0, even: 0 };
  let all4 = 0;
  let all4BySign = 0;
  let gateClosed = 0;
  const firstScores: number[][] = V40_AXIS_KEYS.map(() => []);
  const secondScores: number[][] = V40_AXIS_KEYS.map(() => []);
  for (let i = 0; i < n; i += 1) {
    const person = newPerson(s, preset);
    const drifted = driftTraits(s, preset, person);
    const first = storedFromStates(respondStates(s, preset, offsets, person, person.theta, person.u));
    const second = storedFromStates(respondStates(s, preset, offsets, person, drifted.theta, drifted.u));
    const a = scoreResponses(SIM_BANK, first).axes;
    const b = scoreResponses(SIM_BANK, second).axes;
    if (buildResult(SIM_BANK, drawFormBit(formStream), first).gate.closed) gateClosed += 1;
    let even = 0;
    let same = 0;
    let sameBySign = 0;
    a.forEach((axis, index) => {
      firstScores[index].push(axis.s!);
      secondScores[index].push(b[index].s!);
      const band = axis.band!;
      bandCount[band] += 1;
      if (band === "even") even += 1;
      if (axis.letter === b[index].letter) {
        same += 1;
        keep[band] += 1;
      }
      if (Math.sign(axis.weighted!) === Math.sign(b[index].weighted!) || axis.weighted === 0) {
        sameBySign += 1;
        keepBySign[band] += 1;
      }
    });
    evenCount[even] += 1;
    if (same === 4) all4 += 1;
    if (sameBySign === 4) all4BySign += 1;
  }
  const retestR = firstScores.map((scores, index) => pearson(scores, secondScores[index]));
  return { n, evenCount, bandCount, keep, keepBySign, all4, all4BySign, gateClosed, retestR };
}

/** 첫 응답과 재검사의 글자가 같은 축의 퍼센트(진짜 글자 비교, 네 주제 합산). */
function letterAgreementPercent(run: PresetRun): number {
  return percent(run.keep.clear + run.keep.lean + run.keep.even, run.n * 4);
}

/** presets.js 가 출력한 숫자 (design/workF/results.txt, 퍼센트). */
const DESIGN_PRESETS: Readonly<Record<PresetName, { readonly evenCount: number[]; readonly share: number[]; readonly keepBySign: number[]; readonly all4: number }>> = {
  optimistic: { evenCount: [16.4, 37.2, 31.6, 12.8, 2.1], share: [31.3, 32, 36.7], keepBySign: [99.1, 90, 66.9], all4: 51 },
  moderate: { evenCount: [5.8, 23.4, 37.1, 26, 7.6], share: [14.2, 34.2, 51.6], keepBySign: [97.4, 86.4, 64.5], all4: 34.9 },
  pessimistic: { evenCount: [1.8, 13.3, 31.4, 37.1, 16.4], share: [6.2, 30.5, 63.3], keepBySign: [92.2, 80, 61], all4: 22.1 },
};

/** 스펙 5절 세기와 10절 모의가 적은 숫자 (퍼센트, 정수). share 와 keep 은 뚜렷, 기울어요, 반반 순서. */
const SPEC_PRESETS: Readonly<Record<PresetName, { readonly share: number[]; readonly keep: number[]; readonly evenTwoPlus: number; readonly allLean: number; readonly allFourKept: number }>> = {
  optimistic: { share: [31, 32, 37], keep: [99, 90, 67], evenTwoPlus: 46, allLean: 16, allFourKept: 51 },
  moderate: { share: [14, 34, 52], keep: [97, 86, 65], evenTwoPlus: 71, allLean: 6, allFourKept: 35 },
  pessimistic: { share: [6, 31, 63], keep: [92, 80, 61], evenTwoPlus: 85, allLean: 2, allFourKept: 22 },
};

const presetReplicas = once(() => Object.fromEntries(PRESET_NAMES.map((name) => [name, runPreset(name, PRESETS_SEED, 8000)])) as Record<PresetName, PresetRun>);
const presetFresh = once(() =>
  FRESH_SEEDS.map((seed) => Object.fromEntries(PRESET_NAMES.map((name) => [name, runPreset(name, seed, 8000)])) as Record<PresetName, PresetRun>),
);

/** 설계 스펙의 띠 분포와 유지율, 반반 축 수, 네 글자 유지가 허용 오차 안인지 본다. */
function expectPresetInSpec(name: PresetName, run: PresetRun, tolerance: number): void {
  const spec = SPEC_PRESETS[name];
  const axes = run.n * 4;
  BANDS.forEach((band, index) => {
    expectNear(`${name} 띠 분포 ${band}`, percent(run.bandCount[band], axes), spec.share[index], tolerance);
    expectNear(`${name} 재검사 글자 유지 ${band}`, percent(run.keep[band], run.bandCount[band]), spec.keep[index], tolerance);
  });
  expectNear(`${name} 반반 축 2개 이상인 사람`, percent(run.evenCount[2] + run.evenCount[3] + run.evenCount[4], run.n), spec.evenTwoPlus, tolerance);
  expectNear(`${name} 네 축 모두 기울어요 이상인 사람`, percent(run.evenCount[0], run.n), spec.allLean, tolerance);
  expectNear(`${name} 네 글자 모두 유지`, percent(run.all4, run.n), spec.allFourKept, tolerance);
}

// ---------------------------------------------------------------------------
// ties.js 재현: 정확한 동점과 사슬 도달 단계
// ---------------------------------------------------------------------------

interface TieRun {
  readonly n: number;
  readonly tieAxes: number;
  readonly tiePersons: number;
  /** 자기 선택 없이 채점했을 때 동점 축의 사슬 단계(색인 1에서 5) 별 축 수. */
  readonly levelsWithoutSelf: number[];
  /** 자기 선택에 답했을 때(꽤 세기) 같은 축의 사슬 단계 별 축 수. */
  readonly levelsWithSelf: number[];
  /** 동점 축이 있는 사람 중 자기 선택 없이 관문이 닫힌 사람 수. */
  readonly gateClosedWithoutSelf: number;
  /** 동점 축인데 세기가 반반이에요가 아니거나, 임시 글자 표시가 5단계와 어긋난 축 수(0 이어야 한다). */
  readonly inconsistentTieAxes: number;
}

function runTies(name: PresetName, seed: number, n: number): TieRun {
  const preset = PRESETS[name];
  const s = makeSampler(seed);
  // 자기 선택 응답의 난수는 본 난수열(ties.js 와 같은 소비 순서)을 흔들지 않게 따로 뽑는다.
  const selfStream = makeSampler(seed + 1);
  const offsets = makeOffsets(s);
  const levelsWithoutSelf = [0, 0, 0, 0, 0, 0];
  const levelsWithSelf = [0, 0, 0, 0, 0, 0];
  let tieAxes = 0;
  let tiePersons = 0;
  let gateClosedWithoutSelf = 0;
  let inconsistentTieAxes = 0;
  for (let i = 0; i < n; i += 1) {
    const person = newPerson(s, preset, { extFirst: true });
    const responses = storedFromStates(respondStates(s, preset, offsets, person, person.theta, person.u));
    const own = selfResponses(selfStream, preset, person.theta, 0);
    const without = scoreResponses(SIM_BANK, responses);
    if (!without.axes.some((axis) => axis.weighted === 0)) continue;
    const withSelf = scoreResponses(SIM_BANK, { ...responses, ...own });
    tiePersons += 1;
    without.axes.forEach((axis, index) => {
      if (axis.weighted !== 0) return;
      tieAxes += 1;
      levelsWithoutSelf[axis.tieLevel!] += 1;
      levelsWithSelf[withSelf.axes[index].tieLevel!] += 1;
      if (axis.band !== "even" || withSelf.axes[index].band !== "even" || axis.provisional !== (axis.tieLevel === 5) || withSelf.axes[index].provisional) inconsistentTieAxes += 1;
    });
    if (buildResult(SIM_BANK, 0, responses).gate.closed) gateClosedWithoutSelf += 1;
  }
  return { n, tieAxes, tiePersons, levelsWithoutSelf, levelsWithSelf, gateClosedWithoutSelf, inconsistentTieAxes };
}

/** ties.js 가 출력한 숫자 (표본 축 80,000개당 단계 1에서 5 축 수, 정확한 동점 축 퍼센트, 한 축 이상 동점인 사람 퍼센트). */
const DESIGN_TIES: Readonly<Record<PresetName, { readonly stages: number[]; readonly axisPercent: number; readonly personPercent: number }>> = {
  optimistic: { stages: [476, 116, 18, 27, 0], axisPercent: 0.8, personPercent: 3.16 },
  moderate: { stages: [710, 180, 22, 33, 0], axisPercent: 1.18, personPercent: 4.64 },
  pessimistic: { stages: [935, 212, 29, 36, 0], axisPercent: 1.52, personPercent: 5.88 },
};

const tieReplicas = once(() => Object.fromEntries(PRESET_NAMES.map((name) => [name, runTies(name, TIES_SEED, 20000)])) as Record<PresetName, TieRun>);
const tieFresh = once(() => Object.fromEntries(PRESET_NAMES.map((name) => [name, runTies(name, FRESH_SEEDS[0], 20000)])) as Record<PresetName, TieRun>);

// ===========================================================================
// 0. 모의 도구 점검: 도구가 진짜 코드와 같은 말을 하는가
// ===========================================================================

describe("모의 도구 점검", () => {
  it("배치가 설계 스크립트와 같다: 채점 문항 64개, 축마다 pair 4 / react 4 / recall 2 / instant 2 / bestworst 2 / split 2, 형식별 키 합 0", () => {
    expect(ITEMS).toHaveLength(V40_COUNTS.scored);
    expect(SIM_BANK.self).toHaveLength(V40_COUNTS.self);
    for (const axis of V40_AXIS_KEYS) {
      const counts: Record<string, number> = {};
      const keySums: Record<string, number> = {};
      for (const item of ITEMS.filter((candidate) => candidate.axis === axis)) {
        counts[item.fmt] = (counts[item.fmt] ?? 0) + 1;
        keySums[item.fmt] = (keySums[item.fmt] ?? 0) + item.key;
      }
      expect(counts, axis).toEqual({ pair: 4, react: 4, recall: 2, instant: 2, bestworst: 2, split: 2 });
      expect(Object.values(keySums).every((sum) => sum === 0), `${axis} 형식별 키 합 ${JSON.stringify(keySums)}`).toBe(true);
    }
  });

  it("구간 0과 2, 1과 3은 (주제, 화면 위치)가 같은 거울이고 대응 문항의 키가 반대이며 서식 묶음이 같다", () => {
    let checked = 0;
    for (const item of ITEMS.filter((candidate) => candidate.section < 2)) {
      const slot = SIM_BANK.screens[item.screen].indexOf(item.id);
      const partner = SIM_BANK.screens[item.screen + 20].map((id) => SIM_BANK.byId.get(id)!).find((candidate, index) => candidate.axis === item.axis && index === slot);
      expect(partner, `${item.id} 의 거울 짝`).toBeDefined();
      expect(partner!.key, `${item.id} 의 짝 ${partner!.id} 키`).toBe(-item.key);
      expect(familyOf(partner as (typeof ITEMS)[number])).toBe(familyOf(item));
      checked += 1;
    }
    expect(checked).toBe(32);
  });

  it("저장 상태 -> 화면 답 -> 진짜 toStored 가 모든 문항, 모든 상태, 두 폼 비트에서 원래 상태 문자로 돌아온다", () => {
    const mismatches: string[] = [];
    let checked = 0;
    for (const item of [...ITEMS, ...SIM_BANK.self]) {
      for (const formBit of [0, 1] as const) {
        for (let state = 0; state < V40_STATE_COUNTS[item.fmt]; state += 1) {
          checked += 1;
          if (toStored(item, formBit, viewAnswerForState(item, formBit, state)) !== stateChar(state)) mismatches.push(`${item.id}/${formBit}/${state}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(checked).toBeGreaterThan(1000);
  });

  it("사람 모형이 앞극 쪽으로 기운 사람(theta 양수)에게 모든 서식에서 양수 합을 낸다(키가 반대인 문항에서도 방향이 맞다)", () => {
    const preset = PRESETS.optimistic;
    const s = makeSampler(31337);
    const offsets = makeOffsets(s);
    const thetas: number[][] = [];
    const familySums: number[][][] = V40_AXIS_KEYS.map(() => FAMILIES.map(() => []));
    const totals: number[][] = V40_AXIS_KEYS.map(() => []);
    for (let i = 0; i < 2000; i += 1) {
      const person = newPerson(s, preset);
      thetas.push([...person.theta]);
      const stored = storedFromStates(respondStates(s, preset, offsets, person, person.theta, person.u));
      const sums = sumsByAxisAndFamily(stored);
      sums.forEach((row, axis) => {
        row.forEach((value, family) => familySums[axis][family].push(value));
        totals[axis].push(row.reduce((sum, value) => sum + value, 0));
      });
    }
    V40_AXIS_KEYS.forEach((axis, index) => {
      const theta = thetas.map((row) => row[index]);
      expect(pearson(theta, totals[index]), `${axis} 성향과 축 합의 상관`).toBeGreaterThan(0.7);
      FAMILIES.forEach((family, column) => {
        expect(pearson(theta, familySums[index][column]), `${axis} ${family} 성향과 합의 상관`).toBeGreaterThan(0.3);
      });
    });
  });
});

// ===========================================================================
// 1. 정적 균형 (analyze.js 1절, 스펙 4절과 5절 방향 균형)
// ===========================================================================

describe("정적 균형: 균형 키잉과 거울 구조가 만드는 정확한 0", () => {
  it("[재현] 고정 응답 248가지(폼 비트 2 x 고정 31 x 축 4)에서 서식별 합이 0 이 아닌 경우가 0건이다", () => {
    const { fixed } = replicateAnalyze();
    expect(fixed.tested).toBe(248);
    expect(fixed.nonzero).toBe(0);
  });

  it("고정 응답을 다른 서식 무작위 채우기 20번씩으로 바꿔도 서식 묶음별 합과 하위 형식별 합이 모두 0 이다(확장: 칸 나누기 28가지 전부 포함)", () => {
    const s = makeSampler(555);
    const choices = extendedFixedChoices();
    expect(specFixedChoices()).toHaveLength(31);
    expect(choices).toHaveLength(55);
    let checked = 0;
    const bad: string[] = [];
    for (let repeat = 0; repeat < 20; repeat += 1) {
      for (const formBit of [0, 1] as const) {
        for (const choice of choices) {
          const answers = FACTS.map((facts) => (facts.family === choice.family ? choice.answer : randomScreenAnswer(s, facts.item)));
          const responses = respondFromScreen(formBit, answers);
          const byFamily = sumsByAxisAndFamily(responses);
          const byFormat = sumsByAxisAndFormat(responses);
          const column = FAMILIES.indexOf(choice.family);
          for (let axis = 0; axis < 4; axis += 1) {
            checked += 1;
            if (byFamily[axis][column] !== 0) bad.push(`family ${choice.family} axis ${axis}`);
            const formats = choice.family === "choose" ? (["recall", "instant"] as const) : ([choice.family] as const);
            for (const format of formats) if ((byFormat[axis].get(format) ?? 0) !== 0) bad.push(`format ${format} axis ${axis}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
    expect(checked).toBe(20 * 2 * 55 * 4);
  });

  it("모든 서식을 동시에 고정한 5,760가지 x 폼 비트 2 는 네 축 모두 N 이 0 이고 반반이에요이며, 세 위치 검사가 모두 표시해 관문이 닫힌다", () => {
    const pair = specFixedChoices().filter((choice) => choice.family === "pair");
    const react = specFixedChoices().filter((choice) => choice.family === "react");
    const choose = specFixedChoices().filter((choice) => choice.family === "choose");
    const bestworst = specFixedChoices().filter((choice) => choice.family === "bestworst");
    const split = specFixedChoices().filter((choice) => choice.family === "split");
    expect(pair.length * react.length * choose.length * bestworst.length * split.length).toBe(5760);
    let count = 0;
    let notZero = 0;
    let notEven = 0;
    let notClosed = 0;
    for (const formBit of [0, 1] as const) {
      for (const a of pair) {
        for (const b of react) {
          for (const c of choose) {
            for (const d of bestworst) {
              for (const e of split) {
                const byFamily: Record<Family, ScreenAnswer> = { pair: a.answer, react: b.answer, choose: c.answer, bestworst: d.answer, split: e.answer };
                const result = buildResult(SIM_BANK, formBit, respondFromScreen(formBit, FACTS.map((facts) => byFamily[facts.family])));
                count += 1;
                if (result.axes.some((axis) => axis.weighted !== 0)) notZero += 1;
                if (result.axes.some((axis) => axis.band !== "even")) notEven += 1;
                if (!(result.gate.closed && result.gate.reason === "rhythm" && result.code === null)) notClosed += 1;
              }
            }
          }
        }
      }
    }
    expect(count).toBe(11520);
    expect({ notZero, notEven, notClosed }).toEqual({ notZero: 0, notEven: 0, notClosed: 0 });
  });

  it("[재현] 구간 안 위치 x 구간 홀짝, 전체 순서 mod 32/16/8/4/2, 서식 안 색인 mod 4/2 에만 좌우되는 무작위 응답은 각 12,000축에서 합이 0 이 아닌 경우가 0건이다", () => {
    const { classes } = replicateAnalyze();
    expect(classes.map((entry) => entry.name)).toEqual(CLASS_FUNCTIONS.map(([name]) => name));
    for (const entry of classes) {
      expect(entry.summary.axes, entry.name).toBe(12000);
      expect(entry.summary.nonzero, entry.name).toBe(0);
      expect(entry.maxAbsSum, entry.name).toBe(0);
    }
  });

  it("새 시드에서도 위 여덟 종류 응답은 각 12,000축 모두 합이 정확히 0 이다", () => {
    const s = makeSampler(FRESH_SEEDS[0]);
    for (const [name, classOf] of CLASS_FUNCTIONS) {
      const summary = summarizeMagnitudes(magnitudesOf(s, 3000, () => classScreenAnswers(s, classOf)));
      expect({ name, axes: summary.axes, nonzero: summary.nonzero }).toEqual({ name, axes: 12000, nonzero: 0 });
    }
  });

  it("음성 대조: 전체 순서 mod 3 처럼 거울이 상쇄하지 못하는 응답은 합이 대부분 0 이 아니다(0 시험이 헛돌지 않는다)", () => {
    const s = makeSampler(FRESH_SEEDS[1]);
    const summary = summarizeMagnitudes(magnitudesOf(s, 3000, () => classScreenAnswers(s, (facts) => facts.index % 3)));
    expect(summary.axes).toBe(12000);
    expect(percent(summary.nonzero, summary.axes)).toBeGreaterThan(90);
    // 서로 독립인 무작위 응답도 마찬가지다.
    const independent = summarizeMagnitudes(magnitudesOf(s, 3000, () => randomScreenAnswers(s)));
    expect(percent(independent.nonzero, independent.axes)).toBeGreaterThan(90);
    // 짝을 무너뜨린 응답: 거울 짝을 다르게 눌렀을 때(구간 0의 문항만 고정, 구간 2는 무작위) 합이 0 이 아니다.
    const broken = summarizeMagnitudes(
      magnitudesOf(s, 3000, () => {
        const shared = classScreenAnswers(s, (facts) => `${facts.index - facts.section * 16}:${facts.section % 2}`);
        return shared.map((answer, index) => (FACTS[index].section === 2 ? randomScreenAnswer(s, FACTS[index].item) : answer));
      }),
    );
    expect(percent(broken.nonzero, broken.axes)).toBeGreaterThan(80);
  });
});

// ===========================================================================
// 2. 상쇄되지 않는 리듬과 무작위 응답의 |S| (analyze.js 2절, 스펙 4절과 5절 세기 근거)
// ===========================================================================

describe("거울이 상쇄하지 못하는 리듬과 무작위 응답의 |S| 분포", () => {
  /** analyze.js 가 출력한 값 (design/workF/results.txt): 축 |S| 0.25 이상 퍼센트, 0.50 이상 퍼센트, 95분위, 최댓값. */
  const DESIGN_PERIODS: Readonly<Record<number, readonly [string, string, string, string]>> = {
    3: ["19.3", "1.22", "0.375", "0.719"],
    5: ["18.0", "0.86", "0.354", "0.708"],
    6: ["18.3", "0.75", "0.365", "0.719"],
    7: ["14.2", "0.37", "0.323", "0.698"],
    9: ["17.0", "0.49", "0.354", "0.656"],
    10: ["17.3", "0.47", "0.344", "0.771"],
    11: ["16.4", "0.39", "0.344", "0.635"],
    13: ["14.4", "0.30", "0.323", "0.750"],
  };

  it("[재현] 주기 3, 5, 6, 7, 9, 10, 11, 13 의 리듬과 무작위 응답이 설계가 출력한 |S| 분포와 자리까지 같다", () => {
    const { periods, random } = replicateAnalyze();
    for (const { period, summary } of periods) {
      const want = DESIGN_PERIODS[period];
      const got = [percent(summary.ge25, summary.axes).toFixed(1), percent(summary.ge50, summary.axes).toFixed(2), summary.p95.toFixed(3), summary.max.toFixed(3)];
      expect(got, `주기 ${period}`).toEqual([...want]);
    }
    expect([percent(random.ge25, random.axes).toFixed(1), percent(random.ge50, random.axes).toFixed(2), random.p50.toFixed(3), random.p95.toFixed(3), random.p99.toFixed(3)]).toEqual([
      "16.6",
      "0.38",
      "0.115",
      "0.344",
      "0.448",
    ]);
  });

  it("[스펙 4절] 상쇄되지 않는 주기의 리듬에서 축 |S| 0.25 이상은 14에서 19퍼센트로 무작위 응답(16.6퍼센트)과 같은 수준이고 0.50 이상은 1.5퍼센트 안팎 이하이다(새 시드, +-3퍼센트포인트)", () => {
    const s = makeSampler(FRESH_SEEDS[0]);
    const random = summarizeMagnitudes(magnitudesOf(s, 8000, () => randomScreenAnswers(s)));
    const randomGe25 = percent(random.ge25, random.axes);
    expectNear("무작위 응답 |S|>=.25", randomGe25, 16.6, 3);
    expectNear("무작위 응답 |S|>=.50", percent(random.ge50, random.axes), 0.38, 1);
    expectNear("무작위 응답 |S| 중앙값", random.p50, 0.115, 0.02);
    expectNear("무작위 응답 |S| 95분위", random.p95, 0.344, 0.03);
    expectNear("무작위 응답 |S| 99분위", random.p99, 0.448, 0.04);
    for (const period of PERIODS) {
      const summary = summarizeMagnitudes(magnitudesOf(s, 4000, () => classScreenAnswers(s, (facts) => facts.index % period)));
      const ge25 = percent(summary.ge25, summary.axes);
      expect(ge25, `주기 ${period} |S|>=.25`).toBeGreaterThanOrEqual(14.2 - 3);
      expect(ge25, `주기 ${period} |S|>=.25`).toBeLessThanOrEqual(19.3 + 3);
      expectNear(`주기 ${period} 와 무작위 응답의 |S|>=.25 차이`, ge25, randomGe25, 5);
      expect(percent(summary.ge50, summary.axes), `주기 ${period} |S|>=.50`).toBeLessThanOrEqual(1.22 + 1);
      // 설계 출력의 95분위는 0.323에서 0.375. 꼬리 한 점(최댓값)은 표본마다 크게 흔들려 보지 않는다.
      expect(summary.p95, `주기 ${period} |S| 95분위`).toBeGreaterThanOrEqual(0.323 - 0.03);
      expect(summary.p95, `주기 ${period} |S| 95분위`).toBeLessThanOrEqual(0.375 + 0.03);
      // 거울이 상쇄하지 못하는 주기이므로 합은 대부분 0 이 아니다(음성 대조).
      expect(percent(summary.nonzero, summary.axes), `주기 ${period} 0 이 아닌 합`).toBeGreaterThan(80);
    }
  });

  it("[스펙 5절 세기 근거] 무작위 응답은 뚜렷해요가 0.4퍼센트, 기울어요가 16퍼센트 안팎, 나머지 83퍼센트 안팎이 반반이에요이다(진짜 band, 새 시드)", () => {
    const s = makeSampler(FRESH_SEEDS[1]);
    const counts: Record<StrengthBand, number> = { clear: 0, lean: 0, even: 0 };
    for (let n = 0; n < 8000; n += 1) {
      const formBit = drawFormBit(s);
      for (const axis of scoreResponses(SIM_BANK, respondFromScreen(formBit, randomScreenAnswers(s))).axes) counts[axis.band!] += 1;
    }
    const total = 8000 * 4;
    expectNear("무작위 응답 뚜렷해요", percent(counts.clear, total), 0.4, 1);
    expectNear("무작위 응답 기울어요", percent(counts.lean, total), 16.1, 3);
    expectNear("무작위 응답 반반이에요", percent(counts.even, total), 83.5, 3);
  });
});

// ===========================================================================
// 3. 리듬 탐지기 (analyze.js 3절, 스펙 5절 주의 검사 1)
// ===========================================================================

describe("위치 반복(리듬) 탐지기", () => {
  it("[재현] 정상 응답자(중간 가정) 8,000명: 표시 형식 수 분포, 형식별 표시율, 세기 띠, 최적 주기 일치도 분위가 설계가 출력한 값과 같다", () => {
    const { honest } = replicateAnalyze();
    expect(honest.n).toBe(8000);
    expect(honest.flagged.map((count) => percent(count, honest.n).toFixed(2))).toEqual(["99.50", "0.50", "0.00", "0.00"]);
    expect(honest.perFamily.map((count) => percent(count, honest.n).toFixed(2))).toEqual(["0.47", "0.03", "0.00"]);
    expect(BANDS.map((band) => percent(honest.bands[band], honest.n * 4).toFixed(1))).toEqual(["14.6", "34.0", "51.4"]);
    const want = [
      ["0.69", "0.81", "0.875", "1.000"],
      ["0.50", "0.69", "0.750", "0.875"],
      ["0.56", "0.69", "0.750", "0.813"],
    ];
    honest.agreement.forEach((values, index) => {
      const sorted = [...values].sort((a, b) => a - b);
      expect([quantileOf(sorted, 0.5).toFixed(2), quantileOf(sorted, 0.95).toFixed(2), quantileOf(sorted, 0.99).toFixed(3), sorted[sorted.length - 1].toFixed(3)], `묶음 ${index}`).toEqual(want[index]);
    });
  });

  it("[재현] 무작위 응답 8,000명의 표시 형식 수 분포가 설계와 같다(99.51 / 0.49 / 0.00 / 0.00)", () => {
    const { randomFlagged } = replicateAnalyze();
    expect(randomFlagged.map((count) => percent(count, 8000).toFixed(2))).toEqual(["99.51", "0.49", "0.00", "0.00"]);
  });

  it("[스펙 5절] 정상 응답자와 무작위 응답에서 두 형식 이상 표시(힌트)는 0퍼센트 안팎이고 세 형식 표시(관문)는 0건이다(설계 뽑기 8,000명 안에서는 0건)", () => {
    const { honest, randomFlagged } = replicateAnalyze();
    expect(honest.flagged[2] + honest.flagged[3]).toBe(0);
    expect(randomFlagged[2] + randomFlagged[3]).toBe(0);
    expect(honest.demoted).toBe(0);
    expect(honest.gateClosed).toBe(0);
  });

  it("새 시드의 정상 응답자 6,000명: 세 형식 표시 0건, 두 형식 이상 표시는 6,000명 중 2명 이하, 한 형식 이상 표시는 1.5퍼센트 이하이다", () => {
    const s = makeSampler(FRESH_SEEDS[0]);
    const formStream = makeSampler(FRESH_SEEDS[0] + 1);
    const fresh = runHonest(s, formStream, PRESETS.moderate, makeOffsets(s), 6000, "semantic");
    expect(fresh.flagged[3]).toBe(0);
    expect(fresh.flagged[2]).toBeLessThanOrEqual(2);
    expect(percent(fresh.flagged[1] + fresh.flagged[2] + fresh.flagged[3], fresh.n)).toBeLessThanOrEqual(1.5);
    expect(fresh.demoted).toBeLessThanOrEqual(2);
    // 형식별 표시는 pair 가 주로 낸다(위/아래 두 칸뿐이라 우연히 한쪽으로 몰릴 여지가 가장 크다).
    expect(fresh.perFamily[0]).toBeGreaterThanOrEqual(fresh.perFamily[1]);
  });

  it("무작위 응답에서도 새 시드 6,000명 중 두 형식 이상 표시는 없다", () => {
    const s = makeSampler(FRESH_SEEDS[1]);
    const flagged = [0, 0, 0, 0];
    for (let n = 0; n < 6000; n += 1) {
      const formBit = drawFormBit(s);
      flagged[rhythmReport(SIM_BANK, formBit, respondFromScreen(formBit, randomScreenAnswers(s))).flaggedCount] += 1;
    }
    expect(flagged[2] + flagged[3]).toBeLessThanOrEqual(2);
    expect(flagged[3]).toBe(0);
  });

  // 표시 형식 수(세 묶음 중 flagged), 축 |S| 0.25 이상인 축 수(폼 비트 2 x 축 4 = 8중), 가장 큰 축 합. analyze.js 3b 출력.
  const DESIGN_CARELESS: Readonly<Record<string, { readonly flaggedAll: number; readonly ge25: number; readonly maxSum: number }>> = {
    "전부 첫 칸": { flaggedAll: 3, ge25: 0, maxSum: 0 },
    "전부 높은 칸": { flaggedAll: 3, ge25: 0, maxSum: 0 },
    "좌우 번갈아": { flaggedAll: 3, ge25: 0, maxSum: 0 },
    "1-2-3-4(-5) 돌려": { flaggedAll: 2, ge25: 2, maxSum: 30 },
    "세 번 주기": { flaggedAll: 3, ge25: 0, maxSum: 23 },
    "다섯 번 주기": { flaggedAll: 0, ge25: 0, maxSum: 6 },
  };

  it("부주의 응답 여섯 종류(analyze.js 3b): 표시 형식 수와 축 |S| 가 설계 출력과 같다(두 폼 비트, 최대 축 합 0.313 x 96 = 30 등)", () => {
    expect(Object.keys(CARELESS_RULES)).toEqual(Object.keys(DESIGN_CARELESS));
    for (const [name, rule] of Object.entries(CARELESS_RULES)) {
      const want = DESIGN_CARELESS[name];
      let ge25 = 0;
      let maxSum = 0;
      for (const formBit of [0, 1] as const) {
        const responses = respondFromScreen(formBit, patternedAnswers(rule));
        expect(rhythmReport(SIM_BANK, formBit, responses).flaggedCount, `${name} 폼 비트 ${formBit}`).toBe(want.flaggedAll);
        for (const axis of scoreResponses(SIM_BANK, responses).axes) {
          if (Math.abs(axis.sum) / 96 >= 0.25) ge25 += 1;
          maxSum = Math.max(maxSum, Math.abs(axis.sum));
        }
      }
      expect({ name, ge25, maxSum }).toEqual({ name, ge25: want.ge25, maxSum: want.maxSum });
    }
  });

  it("스펙 5절: 세 형식이 모두 표시되는 부주의 응답은 관문이 닫혀 코드가 없고, 두 형식 표시(1-2-3-4 돌려)는 힌트로 모든 세기를 한 단계 낮추며, 다섯 번 주기는 세기로 새지 않는다", () => {
    for (const [name, rule] of Object.entries(CARELESS_RULES)) {
      for (const formBit of [0, 1] as const) {
        const result = buildResult(SIM_BANK, formBit, respondFromScreen(formBit, patternedAnswers(rule)));
        if (DESIGN_CARELESS[name].flaggedAll === 3) {
          expect(result.gate, `${name} ${formBit}`).toEqual({ closed: true, reason: "rhythm" });
          expect(result.code, `${name} ${formBit}`).toBeNull();
        } else {
          expect(result.gate.closed, `${name} ${formBit}`).toBe(false);
          expect(result.code, `${name} ${formBit}`).toMatch(/^[VS][WD][UF][HA]$/);
        }
        expect(result.notes.hintRhythm, `${name} ${formBit}`).toBe(result.rhythm.flaggedCount >= 2);
        // 어느 규칙적 응답도 세기로 새지 않는다: 힌트를 거친 뒤 뚜렷해요와 기울어요가 하나도 없다.
        for (const axis of result.axes) expect(axis.shownBand, `${name} ${formBit} ${axis.axis}`).toBe("even");
      }
    }
  });

  it("규칙적 응답의 방향은 폼 비트가 정한다: 같은 화면 누르기(1-2-3-4 돌려)가 폼 비트 0 과 1 에서 축 합의 부호만 뒤집힌 같은 크기의 합을 낸다", () => {
    const rule = CARELESS_RULES["1-2-3-4(-5) 돌려"];
    const zero = scoreResponses(SIM_BANK, respondFromScreen(0, patternedAnswers(rule))).axes.map((axis) => axis.sum);
    const one = scoreResponses(SIM_BANK, respondFromScreen(1, patternedAnswers(rule))).axes.map((axis) => axis.sum);
    expect(one).toEqual(zero.map((value) => (value === 0 ? 0 : -value)));
    expect(zero).toEqual([-30, -19, -3, -6]);
  });
});

// ===========================================================================
// 4. 세 가정의 띠 분포와 재검사 글자 유지 (presets.js, 스펙 5절 세기와 10절)
// ===========================================================================

describe("세 가정(낙관, 중간, 비관)의 세기 띠 분포와 재검사 글자 유지", () => {
  it("[재현] 설계 시드(777)와 표본(8,000명)에서 presets.js 가 출력한 반반 축 수 분포, 띠 분포, 띠별 유지, 네 글자 유지가 같다", () => {
    const replicas = presetReplicas();
    for (const name of PRESET_NAMES) {
      const run = replicas[name];
      const want = DESIGN_PRESETS[name];
      expect(run.n).toBe(8000);
      run.evenCount.forEach((count, index) => expectNear(`${name} 반반 축 ${index}개인 사람`, percent(count, run.n), want.evenCount[index], 0.05));
      BANDS.forEach((band, index) => {
        expectNear(`${name} 띠 분포 ${band}`, percent(run.bandCount[band], run.n * 4), want.share[index], 0.05);
        expectNear(`${name} 띠별 유지(설계 정의) ${band}`, percent(run.keepBySign[band], run.bandCount[band]), want.keepBySign[index], 0.05);
      });
      expectNear(`${name} 네 글자 모두 유지(설계 정의)`, percent(run.all4BySign, run.n), want.all4, 0.05);
    }
  });

  it("[스펙 5절, 10절] 설계 시드: 띠 분포, 띠별 재검사 글자 유지, 반반 축 2개 이상, 네 축 모두 기울어요 이상, 네 글자 유지가 스펙이 적은 범위 +-3퍼센트포인트 안이다(진짜 글자 비교)", () => {
    const replicas = presetReplicas();
    for (const name of PRESET_NAMES) expectPresetInSpec(name, replicas[name], 3);
  });

  it("[스펙 5절, 10절] 새 시드 두 개에서도 같은 범위 +-3퍼센트포인트 안이다", () => {
    for (const replicas of presetFresh()) for (const name of PRESET_NAMES) expectPresetInSpec(name, replicas[name], 3);
  });

  it("글자를 진짜 글자로 비교해도(동점 사슬 글자 포함) 설계 정의(부호)와 띠별 유지율이 1퍼센트포인트 안으로 같다", () => {
    const replicas = presetReplicas();
    for (const name of PRESET_NAMES) {
      const run = replicas[name];
      for (const band of BANDS) {
        expectNear(`${name} ${band} 글자 비교와 부호 비교의 차`, percent(run.keep[band], run.bandCount[band]), percent(run.keepBySign[band], run.bandCount[band]), 1);
      }
    }
  });

  it("스펙 10절 파일럿 통과선 40퍼센트: 축 관측의 기울어요 이상 비율이 낙관 63, 중간 48로 통과하고 비관 37은 통과하지 못한다", () => {
    const replicas = presetReplicas();
    const settled = (name: PresetName) => percent(replicas[name].bandCount.clear + replicas[name].bandCount.lean, replicas[name].n * 4);
    expectNear("낙관 기울어요 이상", settled("optimistic"), 63, 3);
    expectNear("중간 기울어요 이상", settled("moderate"), 48, 3);
    expectNear("비관 기울어요 이상", settled("pessimistic"), 37, 3);
    expect(settled("optimistic")).toBeGreaterThanOrEqual(40);
    expect(settled("moderate")).toBeGreaterThanOrEqual(40);
    expect(settled("pessimistic")).toBeLessThan(40);
  });

  it("[스펙 10절 재검사 통과선] 중간 가정의 축 점수 재검사 r 은 0.73 안팎, 글자 일치는 76에서 77퍼센트 안팎으로 통과선(r 0.75, 글자 77퍼센트) 바로 아래이고 낙관은 위, 비관은 아래이다", () => {
    const replicas = presetReplicas();
    const meanR = (name: PresetName) => replicas[name].retestR.reduce((sum, r) => sum + r, 0) / 4;
    expectNear("중간 재검사 r", meanR("moderate"), 0.73, 0.03);
    expectNear("중간 글자 일치", letterAgreementPercent(replicas.moderate), 76.5, 1.5);
    expect(meanR("optimistic")).toBeGreaterThanOrEqual(0.75);
    expect(letterAgreementPercent(replicas.optimistic)).toBeGreaterThanOrEqual(77);
    expect(meanR("pessimistic")).toBeLessThan(0.75);
    expect(letterAgreementPercent(replicas.pessimistic)).toBeLessThan(77);
    expect(meanR("moderate")).toBeLessThan(0.75);
    expect(letterAgreementPercent(replicas.moderate)).toBeLessThan(77);
    // 스펙 10절: 글자 일치는 1 - arccos(r) / pi 에 가깝다(r 0.75 가 일치 77퍼센트에 대응).
    for (const name of PRESET_NAMES) {
      const implied = (1 - Math.acos(meanR(name)) / Math.PI) * 100;
      expectNear(`${name} 글자 일치와 1 - arccos(r) / pi 의 차`, letterAgreementPercent(replicas[name]), implied, 4);
    }
  });

  it("[스펙 10절 커플] 중간 가정에서 두 사람 모두 기울어요 이상인 주제는 축의 약 23퍼센트(독립 가정)이고 커플의 약 34퍼센트는 그런 주제가 하나도 없다", () => {
    const run = presetReplicas().moderate;
    const settled = percent(run.bandCount.clear + run.bandCount.lean, run.n * 4) / 100;
    expectNear("두 사람 모두 기울어요 이상인 주제", settled * settled * 100, 23, 3);
    expectNear("확정 주제가 하나도 없는 커플", (1 - settled * settled) ** 4 * 100, 34, 3);
  });

  it("세 가정의 순서가 유지된다: 신호가 약할수록 반반 축이 늘고 네 글자 유지가 줄며, 띠가 뚜렷할수록 재검사 유지가 높다", () => {
    const replicas = presetReplicas();
    const share = (name: PresetName, band: StrengthBand) => percent(replicas[name].bandCount[band], replicas[name].n * 4);
    expect(share("optimistic", "even")).toBeLessThan(share("moderate", "even"));
    expect(share("moderate", "even")).toBeLessThan(share("pessimistic", "even"));
    expect(percent(replicas.optimistic.all4, 8000)).toBeGreaterThan(percent(replicas.moderate.all4, 8000));
    expect(percent(replicas.moderate.all4, 8000)).toBeGreaterThan(percent(replicas.pessimistic.all4, 8000));
    for (const name of PRESET_NAMES) {
      const keep = (band: StrengthBand) => percent(replicas[name].keep[band], replicas[name].bandCount[band]);
      expect(keep("clear")).toBeGreaterThan(keep("lean"));
      expect(keep("lean")).toBeGreaterThan(keep("even"));
      // 스펙 5절: 세 띠가 재검사 유지를 15퍼센트포인트 이상 가르지 못하면 세기 문구를 뺀다. 세 가정 모두 가른다.
      expect(keep("clear") - keep("even"), `${name} 뚜렷과 반반의 유지 차`).toBeGreaterThanOrEqual(15);
    }
  });
});

// ===========================================================================
// 5. 동점 사슬 (ties.js, 스펙 5절 동점)
// ===========================================================================

describe("동점 사슬 도달 단계", () => {
  it("[재현] 설계 시드(99)와 표본(사람 20,000명, 축 80,000개)에서 ties.js 가 출력한 정확한 동점 비율과 단계별 축 수가 같다", () => {
    const replicas = tieReplicas();
    for (const name of PRESET_NAMES) {
      const run = replicas[name];
      const want = DESIGN_TIES[name];
      expect(run.levelsWithoutSelf[0], name).toBe(0);
      expect(run.levelsWithoutSelf.slice(1, 4), `${name} 1에서 3단계`).toEqual(want.stages.slice(0, 3));
      // ties.js 의 「4단계」는 사슬이 자기 선택 단계까지 온 축이다. 자기 선택 없이 채점하면 그 축이 5단계(임시 글자)가 된다.
      expect(run.levelsWithoutSelf[4], `${name} 자기 선택 없이는 4단계에서 끝나는 축이 없다`).toBe(0);
      expect(run.levelsWithoutSelf[5], `${name} 자기 선택 단계까지 온 축`).toBe(want.stages[3]);
      // ties.js 는 소수 둘째 자리로 반올림해 출력했다(예: 1212 / 80000 = 1.515 는 1.52).
      expectNear(`${name} 정확한 동점 축 퍼센트`, percent(run.tieAxes, run.n * 4), want.axisPercent, 0.01);
      expectNear(`${name} 한 축 이상 동점인 사람 퍼센트`, percent(run.tiePersons, run.n), want.personPercent, 0.01);
    }
  });

  it("[스펙 5절] 자기 선택에 답한 사람에게는 5단계(임시 글자)가 0건이고 자기 선택 단계에서 갈리는 축이 0.04퍼센트 안팎이다", () => {
    for (const replicas of [tieReplicas(), tieFresh()]) {
      for (const name of PRESET_NAMES) {
        const run = replicas[name];
        expect(run.levelsWithSelf[5], `${name} 5단계`).toBe(0);
        const selfDecided = percent(run.levelsWithSelf[4], run.n * 4);
        expect(selfDecided, `${name} 자기 선택 단계`).toBeGreaterThanOrEqual(0.01);
        expect(selfDecided, `${name} 자기 선택 단계`).toBeLessThanOrEqual(0.1);
        // 자기 선택이 있고 없고는 4단계 이하 축의 단계를 바꾸지 않는다.
        expect(run.levelsWithSelf.slice(1, 4)).toEqual(run.levelsWithoutSelf.slice(1, 4));
        expect(run.levelsWithSelf[4]).toBe(run.levelsWithoutSelf[5]);
        expect(run.gateClosedWithoutSelf, `${name} 자기 선택 없이도 동점이 있는 사람의 관문`).toBe(0);
        // 동점 사슬로 정한 글자는 언제나 반반이에요이고, 임시 표시는 5단계에서만 붙는다.
        expect(run.inconsistentTieAxes, `${name} 동점 축의 세기와 임시 표시`).toBe(0);
      }
    }
  });

  it("[스펙 5절] 새 시드: 정확한 동점은 축의 0.8에서 1.5퍼센트, 사람의 3.2에서 5.9퍼센트가 한 축 이상이고, 단계 1과 2가 대부분이며 3단계는 0.1퍼센트 이하이다", () => {
    const replicas = tieFresh();
    for (const name of PRESET_NAMES) {
      const run = replicas[name];
      const want = DESIGN_TIES[name];
      expectNear(`${name} 정확한 동점 축 퍼센트`, percent(run.tieAxes, run.n * 4), want.axisPercent, 0.3);
      expectNear(`${name} 한 축 이상 동점인 사람 퍼센트`, percent(run.tiePersons, run.n), want.personPercent, 0.7);
      expectNear(`${name} 1단계 축 퍼센트`, percent(run.levelsWithSelf[1], run.n * 4), percent(want.stages[0], 80000), 0.15);
      expectNear(`${name} 2단계 축 퍼센트`, percent(run.levelsWithSelf[2], run.n * 4), percent(want.stages[1], 80000), 0.1);
      expect(percent(run.levelsWithSelf[3], run.n * 4), `${name} 3단계`).toBeLessThanOrEqual(0.1);
      expect(run.levelsWithSelf[1], `${name} 1단계가 가장 많다`).toBeGreaterThan(run.levelsWithSelf[2]);
    }
  });

  it("동점이 더 흔한 가정일수록(비관) 동점 축이 더 많다", () => {
    const replicas = tieReplicas();
    expect(replicas.optimistic.tieAxes).toBeLessThan(replicas.moderate.tieAxes);
    expect(replicas.moderate.tieAxes).toBeLessThan(replicas.pessimistic.tieAxes);
  });
});

// ===========================================================================
// 6. 관문 오탐 (스펙 5절 주의 검사 1과 3, 스펙 10절 「리듬 관문 3퍼센트 이하」)
// ===========================================================================

describe("관문 오탐", () => {
  it("정상 응답자 6,000명(중간 가정, 새 시드)에서 관문이 닫히는 사람이 0명이고 코드가 모두 만들어진다", () => {
    const s = makeSampler(FRESH_SEEDS[1] + 100);
    const formStream = makeSampler(FRESH_SEEDS[1] + 101);
    const preset = PRESETS.moderate;
    const offsets = makeOffsets(s);
    let closed = 0;
    let codes = 0;
    for (let n = 0; n < 6000; n += 1) {
      const person = newPerson(s, preset);
      const formBit = drawFormBit(formStream);
      const result = buildResult(SIM_BANK, formBit, pressStates(formBit, respondStates(s, preset, offsets, person, person.theta, person.u)));
      if (result.gate.closed) closed += 1;
      if (result.code !== null && /^[VS][WD][UF][HA]$/.test(result.code)) codes += 1;
    }
    expect(closed).toBe(0);
    expect(codes).toBe(6000);
  });

  it("세 가정의 첫 응답 24,000명(설계 시드)과 정상 응답자 8,000명(설계 뽑기) 모두 관문이 닫히지 않는다", () => {
    const replicas = presetReplicas();
    for (const name of PRESET_NAMES) expect(replicas[name].gateClosed, name).toBe(0);
    expect(replicateAnalyze().honest.gateClosed).toBe(0);
  });
});

// ===========================================================================
// 7. 문항 신호 (analyze.js 4절: 미니 모의의 축 알파와 문항-나머지 상관)
// ===========================================================================

describe("미니 모의의 축 알파와 문항-나머지 상관 (정상 응답자 6,000명, 중간 가정)", () => {
  it("[재현] 축 알파 0.75 0.74 0.75 0.75, 형식별 평균 문항-나머지 상관이 설계와 같다", () => {
    const { alpha, itemRest } = replicateAnalyze();
    expect(alpha.map((value) => value.toFixed(2))).toEqual(["0.75", "0.74", "0.75", "0.75"]);
    const want: Record<Family, string> = { react: "0.30", pair: "0.38", split: "0.37", bestworst: "0.30", choose: "0.35" };
    for (const family of FAMILIES) expect(itemRest[family].toFixed(2), family).toBe(want[family]);
  });

  it("[스펙 10절 파일럿 통과선] 모의에서 축 알파가 0.70 이상이고 문항-나머지 상관이 형식마다 0.20 이상이다", () => {
    const { alpha, itemRest } = replicateAnalyze();
    for (const value of alpha) expect(value).toBeGreaterThanOrEqual(0.7);
    for (const family of FAMILIES) expect(itemRest[family], family).toBeGreaterThanOrEqual(0.2);
  });
});

// ===========================================================================
// 8. 건너뜀과 리듬 검사 (스펙 5절 주의 검사 2)
// ===========================================================================

describe("건너뜀으로 위치 반복 검사를 피하는 길", () => {
  /** 늘 같은 칸(전부 첫 칸 계열)으로 누르고, 서식 묶음(pair, react, choose)마다 perFamily 개씩 건너뛴다. 축마다 건너뜀은 4개 이하로 둔다. */
  function skippedConstantResponses(perFamily: number, formBit: FormBit): Responses {
    const answers = patternedAnswers((family) =>
      family === "pair" ? { kind: "pair", pos: 1, m: 2 }
      : family === "react" ? { kind: "react", col: 1 }
      : family === "choose" ? { kind: "choose", col: 1 }
      : family === "bestworst" ? { kind: "bestworst", best: 0, worst: 3 }
      : { kind: "split", counts: [6, 0, 0] },
    );
    const record: Record<string, ResponseValue> = { ...respondFromScreen(formBit, answers) };
    const taken: Record<string, number> = { pair: 0, react: 0, choose: 0 };
    const perAxis = [0, 0, 0, 0];
    for (const facts of FACTS) {
      if (facts.family !== "pair" && facts.family !== "react" && facts.family !== "choose") continue;
      if (taken[facts.family] >= perFamily || perAxis[facts.axis] >= 4) continue;
      record[facts.item.id] = "skip";
      taken[facts.family] += 1;
      perAxis[facts.axis] += 1;
    }
    return record;
  }

  it("서식 묶음마다 4개까지 건너뛰어도(유효 답 12개 이상이 남아) 늘 같은 칸 응답은 세 검사가 모두 표시하고 관문이 닫힌다", () => {
    for (const formBit of [0, 1] as const) {
      const responses = skippedConstantResponses(4, formBit);
      expect(skippedCount(SIM_BANK, responses)).toBe(12);
      const result = buildResult(SIM_BANK, formBit, responses);
      expect(result.rhythm.formats.map((format) => format.considered)).toEqual([12, 12, 12]);
      expect(result.rhythm.flaggedCount).toBe(3);
      expect(result.gate).toEqual({ closed: true, reason: "rhythm" });
    }
  });

  it("알려진 한계(스펙 5절 「이 힌트와 유효 답 12개 조건이 막는다」와 다름): 형식마다 5개, 모두 15개를 건너뛰면 검사를 피하고 힌트(16개 초과)도 걸리지 않는다. 결과는 반반이에요뿐이다", () => {
    for (const formBit of [0, 1] as const) {
      const responses = skippedConstantResponses(5, formBit);
      expect(skippedCount(SIM_BANK, responses)).toBe(15);
      expect(V40_COUNTS.skipHintOver).toBe(16);
      const result = buildResult(SIM_BANK, formBit, responses);
      expect(result.rhythm.formats.map((format) => format.considered)).toEqual([11, 11, 11]);
      expect(result.rhythm.flaggedCount).toBe(0);
      expect(result.notes.hintSkip).toBe(false);
      expect(result.notes.demoted).toBe(false);
      expect(result.gate.closed).toBe(false);
      // 축마다 유효 답이 12개 이상 남아 글자는 만들어진다.
      expect(result.axes.every((axis) => !axis.unusable && axis.answered >= 12)).toBe(true);
      // 늘 같은 칸 응답은 건너뛴 문항이 거울 짝을 무너뜨려도 합이 작다(이 건너뜀 방법에서는 모든 축이 반반이에요).
      for (const axis of result.axes) expect(axis.shownBand, axis.axis).toBe("even");
    }
  });

  it("알려진 한계의 상한: 한 축에서 건너뛸 문항 4개를 고르면(배치를 아는 사람) 늘 같은 칸 응답으로도 그 축을 뚜렷해요까지 올릴 수 있다", () => {
    // 위 「알려진 한계」 시험이 기록한 회피 경로에서 건너뜀을 한 축에 몰아 고른 최악의 경우. 돈 축의 4개 건너뜀 조합을 모두 시험한다(최대 4개: 유효 답 12개 유지).
    const answers = patternedAnswers((family) =>
      family === "pair" ? { kind: "pair", pos: 1, m: 3 }
      : family === "react" ? { kind: "react", col: 5 }
      : family === "choose" ? { kind: "choose", col: 2 }
      : family === "bestworst" ? { kind: "bestworst", best: 0, worst: 3 }
      : { kind: "split", counts: [6, 0, 0] },
    );
    const base = respondFromScreen(0, answers);
    const moneyItems = FACTS.filter((facts) => facts.axis === 0);
    let bestAbs = 0;
    let bestBand: StrengthBand | null = null;
    let bestChosen: number[] = [];
    const pick = (start: number, chosen: number[]): void => {
      const record: Record<string, ResponseValue> = { ...base };
      for (const index of chosen) record[moneyItems[index].item.id] = "skip";
      const axis = scoreResponses(SIM_BANK, record).axes[0];
      if (axis.weighted !== null && Math.abs(axis.weighted) > bestAbs) {
        bestAbs = Math.abs(axis.weighted);
        bestBand = axis.band;
        bestChosen = chosen;
      }
      if (chosen.length === 4) return;
      for (let next = start; next < moneyItems.length; next += 1) pick(next + 1, [...chosen, next]);
    };
    pick(0, []);
    expect({ bestAbs, bestBand }).toEqual({ bestAbs: 144, bestBand: "clear" });

    // 같은 응답자가 나머지 세 축에서 건너뜀을 채워 서식 묶음마다 모두 5개 이상을 건너뛰면 세 검사를 모두 피한다.
    // 축마다 4개 이하라 총 16개이고, 힌트는 16개를 넘어야 걸리므로(V40_COUNTS.skipHintOver = 16) 힌트도 없다.
    const record: Record<string, ResponseValue> = { ...base };
    const taken: Record<string, number> = { pair: 0, react: 0, choose: 0 };
    const perAxis = [0, 0, 0, 0];
    for (const index of bestChosen) {
      const facts = moneyItems[index];
      record[facts.item.id] = "skip";
      perAxis[0] += 1;
      if (facts.family in taken) taken[facts.family] += 1;
    }
    for (const facts of FACTS) {
      if (facts.axis === 0 || !(facts.family in taken)) continue;
      if (taken[facts.family] >= 5 || perAxis[facts.axis] >= 4) continue;
      record[facts.item.id] = "skip";
      taken[facts.family] += 1;
      perAxis[facts.axis] += 1;
    }
    const result = buildResult(SIM_BANK, 0, record);
    expect(skippedCount(SIM_BANK, record)).toBeLessThanOrEqual(V40_COUNTS.skipHintOver);
    expect(result.rhythm.flaggedCount).toBe(0);
    expect(result.notes.hintSkip).toBe(false);
    expect(result.notes.demoted).toBe(false);
    expect(result.gate.closed).toBe(false);
    expect(result.axes[0].shownBand).toBe("clear");
  });
});
