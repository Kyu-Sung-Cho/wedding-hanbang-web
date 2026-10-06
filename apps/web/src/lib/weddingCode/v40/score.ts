/**
 * 웨딩코드 4.0 축 집계와 결과(ScoreModule, 설계 5절 채점).
 *
 * 축마다 채점 문항 16개의 정수 값으로 측면 합, 가중합 N, 글자, 동점 사슬, 세기를 낸다. 판정은 모두 정수 비교다:
 * 가중합 N = (세는 측면의 합 x 12 / 그 측면 유효 답 수)의 합(유효 답 2, 3, 4 이면 12 / n 이 6, 4, 3 이라 항상 정수),
 * 세기 경계는 |N| >= 36 x m(뚜렷해요), |N| >= 18 x m(기울어요). 화면과 시험용 참고값 s = N / (72 x m) 만 나눗셈을 쓴다.
 * 채점은 폼 비트와 무관하다. 폼 비트가 필요한 것은 위치 반복 검사(gates.ts)와 화면(present.ts)뿐이다.
 */
import {
  V40_AXIS_KEYS,
  V40_COUNTS,
  V40_UNSET_LETTER_MARK,
  axisInfo,
  demoteBand,
  letterOf,
} from "@/constants/weddingCodeV40";
import type {
  Axis,
  AxisResult,
  AxisScore,
  Bank,
  FacetTally,
  FormBit,
  GateInfo,
  QualityNotes,
  Responses,
  ScoreResult,
  SelfContrast,
  SelfLine,
  Side,
  StrengthBand,
  TieLevel,
  V40Result,
} from "./types";
import type { ScoreModule } from "./contract";
import { isSkipHintCount, rhythmReport, skippedCount } from "./gates";
import { responseAt } from "./states";
import { itemValue, selfChoice } from "./value";

/** 뚜렷해요 경계: |N| >= 36 x m. 설계 5절 세기(|S| >= 0.50 과 같다). */
const CLEAR_PER_FACET = 36;
/** 기울어요 경계: |N| >= 18 x m. 설계 5절 세기(|S| >= 0.25 와 같다). */
const LEAN_PER_FACET = 18;
/** 유효 답 n(2, 3, 4)인 측면의 가중치 12 / n. 답이 1개 이하인 측면은 세지 않아 가중치가 없다. */
const FACET_WEIGHT: Readonly<Record<number, number>> = { 2: 6, 3: 4, 4: 3 };

/** 부호가 양수이면 front, 음수이면 back, 0 이면 null. */
function signSide(value: number): Side | null {
  return value > 0 ? "front" : value < 0 ? "back" : null;
}

/** 한 주제의 집계(설계 5절 축 점수, 글자, 동점, 세기). 채점 문항 16개를 질문 순서로 본다. */
function scoreAxis(bank: Bank, responses: Responses, axis: Axis): AxisScore {
  const info = axisInfo(axis);
  const tallies = info.facets.map((facet) => ({ facet, answered: 0, frontCount: 0, backCount: 0, neutralCount: 0, sum: 0, counted: false }));
  const facetSlot = new Map(info.facets.map((facet, index) => [facet, index]));
  let answered = 0;
  let frontCount = 0;
  let backCount = 0;
  let neutralCount = 0;
  let skipped = 0;
  let notApplicable = 0;
  let sum = 0;
  let chooseSum = 0;
  let reactSum = 0;
  for (const item of bank.scoredByAxis[axis]) {
    const raw = responseAt(responses, item.id);
    if (raw === "skip") skipped += 1;
    else if (raw === "na") notApplicable += 1;
    const value = itemValue(item, raw);
    if (value === null) continue;
    answered += 1;
    if (value > 0) frontCount += 1;
    else if (value < 0) backCount += 1;
    else neutralCount += 1;
    sum += value;
    const slot = facetSlot.get(item.facet);
    if (slot !== undefined) {
      tallies[slot].answered += 1;
      if (value > 0) tallies[slot].frontCount += 1;
      else if (value < 0) tallies[slot].backCount += 1;
      else tallies[slot].neutralCount += 1;
      tallies[slot].sum += value;
    }
    if (item.fmt === "recall" || item.fmt === "instant") chooseSum += value;
    if (item.fmt === "react") reactSum += value;
  }
  for (const tally of tallies) tally.counted = tally.answered >= 2;
  const facets = tallies.map((tally): FacetTally => ({ ...tally })) as [FacetTally, FacetTally, FacetTally, FacetTally];
  const counted = facets.filter((tally) => tally.counted);
  const countedFacets = counted.length;
  const unusable = countedFacets < V40_COUNTS.minCountedFacets || answered < V40_COUNTS.minValidAnswers;
  const base = { axis, answered, frontCount, backCount, neutralCount, skipped, notApplicable, facets, countedFacets, sum, unusable };
  if (unusable) {
    return { ...base, weighted: null, s: null, side: null, letter: null, tieLevel: null, provisional: false, band: null };
  }
  let weighted = 0;
  for (const tally of counted) weighted += tally.sum * (FACET_WEIGHT[tally.answered] ?? 0);
  let side: Side;
  let tieLevel: TieLevel = 0;
  if (weighted > 0) side = "front";
  else if (weighted < 0) side = "back";
  else {
    // 동점 사슬(설계 5절 동점): 1 고르기 합의 부호, 2 이럴 때 합의 부호, 3 측면 합 부호 다수결, 4 자기 선택, 5 앞 글자(임시).
    // 1과 2의 합(chooseSum, reactSum)은 세지 않는 측면(유효 답 1개)의 답도 포함하고, 3은 세는 측면만 본다. 참고값 코드(scripts/lib)도 같은 읽기다.
    let decided = signSide(chooseSum);
    tieLevel = 1;
    if (decided === null) {
      decided = signSide(reactSum);
      tieLevel = 2;
    }
    if (decided === null) {
      const positive = counted.filter((tally) => tally.sum > 0).length;
      const negative = counted.filter((tally) => tally.sum < 0).length;
      decided = positive > negative ? "front" : negative > positive ? "back" : null;
      tieLevel = 3;
    }
    if (decided === null) {
      const selfItem = bank.self.find((candidate) => candidate.axis === axis);
      const choice = selfItem ? selfChoice(selfItem, responseAt(responses, selfItem.id)) : null;
      decided = choice ? choice.side : null;
      tieLevel = 4;
    }
    if (decided === null) {
      decided = "front";
      tieLevel = 5;
    }
    side = decided;
  }
  const magnitude = Math.abs(weighted);
  let band: StrengthBand;
  // 동점(tieLevel > 0)이면 N = 0 이라 아래 경계에서도 even 이 된다. 설계 5절 문장을 코드에 남기려는 방어적 조건이다.
  if (tieLevel > 0) band = "even";
  else if (magnitude >= CLEAR_PER_FACET * countedFacets) band = "clear";
  else if (magnitude >= LEAN_PER_FACET * countedFacets) band = "lean";
  else band = "even";
  return {
    ...base,
    weighted,
    // 화면과 시험용 참고값이다. 판정에는 쓰지 않는다.
    s: weighted / (72 * countedFacets),
    side,
    letter: letterOf(axis, side),
    tieLevel,
    provisional: tieLevel === 5,
    band,
  };
}

/** 폼 비트와 무관한 축 집계(설계 5절). 주제 순서(돈, 준비, 정하는 사람, 지쳤을 때) 네 개. */
export function scoreResponses(bank: Bank, responses: Responses): ScoreResult {
  const axes = V40_AXIS_KEYS.map((axis) => scoreAxis(bank, responses, axis)) as [AxisScore, AxisScore, AxisScore, AxisScore];
  return { axes };
}

/**
 * 화면이 읽는 전체 결과(설계 5절 주의 검사, 관문, 직접 고른 쪽 대비). scoreResponses + 위치 반복 검사 + 건너뜀 힌트 + 관문 + 대비 + 품질 안내.
 * 위치 반복 형식이 2개 이상이거나 건너뜀이 16개를 넘으면 모든 자리의 세기를 한 단계만 낮춘다(둘 다여도 한 단계).
 * 세 형식 모두 위치 반복이거나 확정 글자(못 정한 주제도 임시 글자도 아닌 주제)가 하나도 없으면 관문이 닫혀 code 가 null.
 */
export function buildResult(bank: Bank, formBit: FormBit, responses: Responses): V40Result {
  const scores = scoreResponses(bank, responses).axes;
  const rhythm = rhythmReport(bank, formBit, responses);
  const skipped = skippedCount(bank, responses);
  const hintRhythm = rhythm.flaggedCount >= 2;
  const hintSkip = isSkipHintCount(skipped);
  const demoted = hintRhythm || hintSkip;
  const axes = scores.map((score): AxisResult => {
    const shownBand = score.band === null ? null : demoted ? demoteBand(score.band) : score.band;
    let contrast: SelfContrast | null = null;
    if (score.letter !== null && score.side !== null && (shownBand === "clear" || shownBand === "lean")) {
      const selfItem = bank.self.find((candidate) => candidate.axis === score.axis);
      const choice = selfItem ? selfChoice(selfItem, responseAt(responses, selfItem.id)) : null;
      if (choice !== null && choice.side !== score.side && choice.level >= 2) {
        contrast = {
          axis: score.axis,
          selfSide: choice.side,
          selfLetter: letterOf(score.axis, choice.side),
          selfLevel: choice.level as 2 | 3,
          gatheredSide: score.side,
          gatheredLetter: score.letter,
          gatheredBand: shownBand,
        };
      }
    }
    return { ...score, shownBand, contrast };
  }) as [AxisResult, AxisResult, AxisResult, AxisResult];
  // 확정 글자(못 정한 주제도 임시 글자도 아닌 주제)가 하나도 없으면 닫힌다. 설계 5절 (3)의 「네 자리가 모두 동점 5단계」보다 넓고
  // 계약 문서 7.3절과 같은 읽기다. (unusable 의 세는 측면 3개 미만 조건은 유효 답 10개 이하를 뜻해 12개 미만 조건이 이미 참이지만 설계 문장대로 남겨 둔다.)
  const hasConfirmed = axes.some((axis) => axis.letter !== null && !axis.provisional);
  let gate: GateInfo = { closed: false, reason: null };
  if (rhythm.flaggedCount === 3) gate = { closed: true, reason: "rhythm" };
  else if (!hasConfirmed) gate = { closed: true, reason: "noInformation" };
  const code = gate.closed ? null : axes.map((axis) => axis.letter ?? V40_UNSET_LETTER_MARK).join("");
  let notApplicableCount = 0;
  let hasOmitted = false;
  for (const item of bank.scored) {
    const value = responseAt(responses, item.id);
    if (value === "skip" || value === "na") hasOmitted = true;
    if (value === "na") notApplicableCount += 1;
  }
  const notes: QualityNotes = {
    hintRhythm,
    hintSkip,
    demoted,
    hasOmitted,
    skippedCount: skipped,
    notApplicableCount,
    unusableAxes: axes.filter((axis) => axis.unusable).map((axis) => axis.axis),
    provisionalAxes: axes.filter((axis) => axis.provisional).map((axis) => axis.axis),
  };
  return { formBit, axes, code, gate, rhythm, notes };
}

/**
 * 마지막에 직접 고른 쪽 줄(웨딩코드 4.1 단계 1, 결과 화면 주제 블록의 사실 줄). 본인이 자기 선택 문항에서 고른 방향과 세기만 담는다.
 * 만드는 조건은 셋이다. (1) 그 주제에 글자가 있다(못 정한 주제는 아니다. 반반이에요는 있다). (2) 자기 선택에 답했다
 * (잘 모르겠어요, 제 상황과 안 맞아요, 빠진 답은 아니다. 임시 글자는 자기 선택이 동점을 못 가른 주제라 자기 선택이 비어 있어서 줄이 없다).
 * (3) 직접 고른 쪽 대비(axis.contrast)가 그 주제에 없다. 대비 문장이 같은 사실을 이미 말하므로 겹쳐 적지 않는다.
 * 모은 답의 방향이나 세기와 견주지 않으므로 글자, 세기, shownBand, 위치 반복 힌트, 건너뜀 힌트를 읽지 않는다. 결과의 어떤 필드도 바꾸지 않고
 * 링크 코드에도 영향이 없다(자기 선택 문항은 이미 코드에 있다). axis 는 buildResult 가 낸 AxisResult 여야 한다(contrast 를 읽는다).
 */
export function selfLine(bank: Bank, responses: Responses, axis: AxisResult): SelfLine | null {
  if (axis.letter === null || axis.contrast !== null) return null;
  const selfItem = bank.self.find((candidate) => candidate.axis === axis.axis);
  const choice = selfItem ? selfChoice(selfItem, responseAt(responses, selfItem.id)) : null;
  if (choice === null) return null;
  return { axis: axis.axis, side: choice.side, letter: letterOf(axis.axis, choice.side), level: choice.level };
}

/** 이 파일의 함수를 계약(ScoreModule)대로 묶은 객체. */
export const scoreModule = { scoreResponses, buildResult, selfLine } satisfies ScoreModule;
