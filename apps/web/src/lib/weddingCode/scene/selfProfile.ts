import {
  WEDDING_CODE_V06_AXES,
  WEDDING_CODE_V06_QUESTIONS,
  type WeddingCodeV06Axis,
  type WeddingCodeV06AxisKey,
  type WeddingCodeV06OptionValue,
  type WeddingCodeV06Question,
} from "@/constants/weddingCodeV06";
import {
  WEDDING_CODE_ABSENCE,
  WEDDING_CODE_CHECK_PHRASE,
  WEDDING_CODE_COUNT_CHECK_NOTE,
  WEDDING_CODE_COUNT_CHECK_NOTE_AXES,
  WEDDING_CODE_RESPONSE_QUALIFIERS,
  WEDDING_CODE_SELF_READING,
  type WeddingCodeReadableConstructKey,
  type WeddingCodeSelfLean,
} from "@/constants/weddingCodeSelfReading";
import { WEDDING_CODE_LETTERS, describeWeddingCodeCount } from "@/lib/weddingCode/profile/letters";
import { WEDDING_CODE_V12_VERSION } from "@/constants/weddingCodeV12";
import type { WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";

/** 문항·공유 코드 버전과 독립적인 응답 요약 규칙 버전. */
export const WEDDING_CODE_SELF_PROFILE_VERSION = "wedding-code-response-summary-v2";

/**
 * 개인 결과 — **내가 고른 답의 집계**.
 *
 * ## 판정과 무엇이 다른가
 *
 * 심리검사는 응답에서 **보이지 않는 특성**을 추정한다(「당신은 신중한 사람입니다」).
 * 여기서는 추정하지 않는다. 계산하는 것은 세 가지뿐이다.
 *
 * 1. 같은 축에서 답한 장면 중 어느 쪽 답을 몇 번 골랐나 — **셈**
 * 2. 그 답의 실제 문장 — **인용**
 * 3. 한 번도 고르지 않은 쪽이 무엇인가 — **부재**
 *
 * 셋 다 사용자가 직접 남긴 응답에서 나오며, 화면에서 근거(장면과 문장)와 함께
 * 보여주므로 사용자가 직접 반증할 수 있다. 유형·점수·등급·궁합·관계 예측은 만들지 않는다.
 *
 * ## 왜 「부재」까지 세나
 *
 * `missingPhrases`는 이번 응답에서 한 번도 고르지 않은 확인 대상을 나타낸다.
 * 그 사실만으로 사용자가 실제 준비에서도 해당 확인을 생략했다고 해석하지 않는다.
 */

const READABLE_CONSTRUCTS = new Set<string>(Object.keys(WEDDING_CODE_CHECK_PHRASE));

export type WeddingCodeSelfQuote = Readonly<{ scene: string; label: string }>;

export type WeddingCodeSelfAxisReading = Readonly<{
  axis: WeddingCodeV06AxisKey;
  /** 축 이름은 주제 이름이지 유형 이름이 아니다. */
  axisLabel: string;
  lean: WeddingCodeSelfLean;
  title: string;
  /** 왼쪽 글자의 짧은 이름(범례와 같다). */
  leftLabel: string;
  rightLabel: string;
  /** 문항 판의 실제 선택 범위가 다를 때만 고른 글자의 설명을 좁힌다. */
  letterMeaning?: string;
  /** 새 판에서 짧은 이름이 달라질 때 배지와 셈에도 같은 이름을 전달한다. */
  letterLabels?: Readonly<{ left: string; right: string }>;
  /** 판에 맞는 후속 대화를 제공할 때만 전달하는 실제 문항 판. */
  questionVersion?: string;
  leftCount: number;
  rightCount: number;
  answered: number;
  /** 많이 고른 쪽을 먼저 두되, 양쪽 답이 있으면 각각 하나씩 인용한다. */
  evidence: readonly WeddingCodeSelfQuote[];
  /** 덜 고른 쪽에서 한 번도 고르지 않은 주제. 비어 있으면 양쪽 다 고른 것이다. */
  missingPhrases: readonly string[];
  /**
   * 실제로 고른 답에만 붙는 한정 안내(중복 제거). 표시 인용 두 개 밖의 답도 포함한다.
   * 예전에는 watchOut 앞에 이어 붙였는데, 그러면 「정할 때 챙길 것」 라벨 아래에 답의
   * 해석 주의가 섞여 읽혔다. 이제 화면이 인용 바로 아래에 따로 그린다.
   */
  qualifiers: readonly string[];
  tellPartner: string;
  /** 이 방향 카드 문구만. 한정 안내는 `qualifiers` 에 있다. */
  watchOut: string;
}>;

export type WeddingCodeRepeatedCheck = Readonly<{
  construct: WeddingCodeReadableConstructKey;
  phrase: string;
  count: number;
}>;

export type WeddingCodeSelfProfile = Readonly<{
  answered: number;
  total: number;
  complete: boolean;
  /** 답한 장면 전체에서 가장 자주 고른 확인. 동률이면 모두 담는다. 중요도 순위가 아니다. */
  repeated: readonly WeddingCodeRepeatedCheck[];
  axes: readonly WeddingCodeSelfAxisReading[];
}>;

export type WeddingCodeSelfProfileOptions = Readonly<{
  questions?: readonly WeddingCodeV06Question[];
  axes?: readonly WeddingCodeV06Axis[];
}>;

/**
 * 한 선택지가 대표하는 확인 대상.
 *
 * 선택지에는 가중치가 여러 개 붙을 수 있고(`decisionPaceRisk`처럼 사용자에게 노출하지
 * 않는 것도 있다), 대표값은 가장 무거운 **공개 가능한** 구성개념 하나다. 노출 금지
 * 구성개념은 여기서 조용히 걸러진다.
 */
function primaryConstruct(
  question: WeddingCodeV06Question,
  value: WeddingCodeV06OptionValue,
): WeddingCodeReadableConstructKey | null {
  const option = question.options.find((item) => item.value === value);
  if (!option) return null;
  const readable = option.weights
    .filter((weight) => READABLE_CONSTRUCTS.has(weight.construct))
    .sort((a, b) => b.value - a.value);
  return (readable[0]?.construct as WeddingCodeReadableConstructKey) ?? null;
}

function sideOf(
  question: WeddingCodeV06Question,
  value: WeddingCodeV06OptionValue,
  axis: WeddingCodeV06Axis,
): "left" | "right" | null {
  const option = question.options.find((item) => item.value === value);
  if (!option) return null;
  const left = axis.left.constructs as readonly string[];
  return option.weights.some((weight) => left.includes(weight.construct)) ? "left" : "right";
}

/** 그 축에서 그 편에 놓인 선택지들이 대표하는 확인 대상(중복 제거). */
function phrasesForSide(
  questions: readonly WeddingCodeV06Question[],
  axis: WeddingCodeV06Axis,
  side: "left" | "right",
): readonly string[] {
  const phrases: string[] = [];
  for (const question of questions) {
    if (question.axis !== axis.key) continue;
    for (const option of question.options) {
      if (sideOf(question, option.value, axis) !== side) continue;
      const construct = primaryConstruct(question, option.value);
      if (!construct) continue;
      const phrase = WEDDING_CODE_CHECK_PHRASE[construct];
      if (!phrases.includes(phrase)) phrases.push(phrase);
    }
  }
  return phrases;
}

/**
 * 응답 하나에서 개인 결과를 만든다.
 *
 * 답하지 않은 문항은 세지 않는다 — 안 고른 것을 고른 것처럼 집계하면 이 제품에서
 * 제일 나쁜 종류의 거짓말이 된다.
 */
export function buildWeddingCodeSelfProfile(
  answers: WeddingCodeV06Answers,
  options: WeddingCodeSelfProfileOptions = {},
): WeddingCodeSelfProfile {
  const questions = options.questions ?? WEDDING_CODE_V06_QUESTIONS;
  const axes = options.axes ?? WEDDING_CODE_V06_AXES;

  const counts = new Map<WeddingCodeReadableConstructKey, number>();
  let answeredTotal = 0;

  const axisReadings: WeddingCodeSelfAxisReading[] = [];

  for (const axis of axes) {
    const axisQuestions = questions.filter((question) => question.axis === axis.key);
    const leftQuotes: WeddingCodeSelfQuote[] = [];
    const rightQuotes: WeddingCodeSelfQuote[] = [];
    const chosenPhrases = new Set<string>();

    for (const question of axisQuestions) {
      const value = answers[question.key];
      if (!value) continue;
      const option = question.options.find((item) => item.value === value);
      const side = sideOf(question, value, axis);
      if (!option || !side) continue;

      answeredTotal += 1;
      const construct = primaryConstruct(question, value);
      if (construct) {
        counts.set(construct, (counts.get(construct) ?? 0) + 1);
        chosenPhrases.add(WEDDING_CODE_CHECK_PHRASE[construct]);
      }
      (side === "left" ? leftQuotes : rightQuotes).push({
        scene: question.scene,
        label: option.label,
      });
    }

    const leftCount = leftQuotes.length;
    const rightCount = rightQuotes.length;
    const answered = leftCount + rightCount;
    const lean: WeddingCodeSelfLean =
      leftCount === rightCount ? "mixed" : leftCount > rightCount ? "left" : "right";

    const dominant = lean === "right" ? rightQuotes : leftQuotes;
    const other = lean === "right" ? leftQuotes : rightQuotes;
    const evidence = other.length > 0
      ? [dominant[0], other[0]]
      : dominant.slice(0, 2);

    // 「한 번도 안 고른 것」은 고르지 않은 편 전체가 아니라, 그 편에서 실제로 한 번도
    // 대표되지 않은 확인 대상이다. 축 A는 한 편에 확인 대상이 둘이라 부분적으로 빌 수 있다.
    const unchosenSide = lean === "left" ? "right" : lean === "right" ? "left" : null;
    const missingPhrases = unchosenSide
      ? phrasesForSide(questions, axis, unchosenSide).filter(
        (phrase) => !chosenPhrases.has(phrase),
      )
      : [];

    const copy = WEDDING_CODE_SELF_READING[axis.key][lean];
    // 표시 인용에서 빠진 답도 확인한다. 겪은 일·바란 도움·상대에게 한 행동을 서로 바꾸지 않는다.
    const qualifiers = [...leftQuotes, ...rightQuotes].flatMap(quote => {
      const qualifier = WEDDING_CODE_RESPONSE_QUALIFIERS[quote.label];
      return qualifier ? [qualifier] : [];
    });
    const letters = WEDDING_CODE_LETTERS[axis.key];
    axisReadings.push({
      axis: axis.key,
      axisLabel: axis.labelKo,
      lean,
      title: copy.title,
      leftLabel: letters.left.short,
      rightLabel: letters.right.short,
      leftCount,
      rightCount,
      answered,
      evidence,
      missingPhrases,
      qualifiers: [...new Set(qualifiers)],
      tellPartner: copy.tellPartner,
      watchOut: copy.watchOut,
    });
  }

  const max = Math.max(0, ...counts.values());
  const repeated: WeddingCodeRepeatedCheck[] = max === 0
    ? []
    : [...counts.entries()]
      .filter(([, count]) => count === max)
      .map(([construct, count]) => ({
        construct,
        phrase: WEDDING_CODE_CHECK_PHRASE[construct],
        count,
      }))
      // 같은 응답이면 언제 열어도 같은 순서로 보여야 한다.
      .sort((a, b) => a.construct.localeCompare(b.construct));

  return {
    answered: answeredTotal,
    total: questions.length,
    complete: answeredTotal === questions.length,
    repeated,
    axes: axisReadings,
  };
}

/**
 * 「답한 5장면 중 4장면은 V(조건 먼저), …」처럼 셈을 그대로 읽어주는 사실 문장.
 *
 * 카피 상수가 아니라 실제 셈에서 만든다 — 숫자가 화면에 뜨는 문장은 반드시 실제 응답에서
 * 나와야 하고, 손으로 쓴 문장이 그 자리를 대신하면 안 되기 때문이다. 틀은 배지 범례와
 * 같은 `describeWeddingCodeCount` 를 쓴다(같은 셈을 두 문장으로 말하지 않는다).
 *
 * 준비 방식·힘들 때 두 축은 겪은 일(연락이 밀렸다)과 한 일이 한 편에 섞여 있어, 셈 뒤에
 * 실제 문장을 확인하라는 안내를 붙인다. 답이 없으면 확인할 문장도 없으므로 붙이지 않는다.
 */
export function describeSelfAxisReading(reading: WeddingCodeSelfAxisReading): string {
  const line = describeWeddingCodeCount(reading.axis, reading.leftCount, reading.rightCount);
  if (reading.leftCount + reading.rightCount === 0) return line;
  return WEDDING_CODE_COUNT_CHECK_NOTE_AXES.includes(reading.axis)
    ? `${line} ${WEDDING_CODE_COUNT_CHECK_NOTE}`
    : line;
}

/**
 * 받침에 맞는 조사를 고른다.
 *
 * 문항 문구가 바뀔 때마다 사람이 「을/를」을 다시 손보게 두면 언젠가 틀린 채로 나간다.
 * 인용부호로 끝나는 문장이 많아서, 따옴표·괄호를 걷어낸 **마지막 한글 글자**로 판단한다.
 */
export function withJosa(word: string, withBatchim: string, withoutBatchim: string): string {
  const stripped = word.replace(/[”"’'’」』)\]\s]+$/u, "");
  const last = stripped.charCodeAt(stripped.length - 1);
  if (Number.isNaN(last) || last < 0xac00 || last > 0xd7a3) return `${word}${withoutBatchim}`;
  return `${word}${(last - 0xac00) % 28 === 0 ? withoutBatchim : withBatchim}`;
}

/**
 * 한 번도 고르지 않은 쪽이 있으면 그것을 말한다. 없으면 조용히 비운다.
 *
 * 덜 고른 쪽 답이 0개면 그쪽 전체(짧은 이름)를, 몇 개 골랐는데 그쪽 주제 중 하나가
 * 빠졌으면(한 편에 주제가 둘인 decisionCriteria 에서만 생긴다) 그 주제를 말한다.
 */
export function describeSelfAxisAbsence(
  reading: WeddingCodeSelfAxisReading,
): string | null {
  if (reading.missingPhrases.length === 0 || reading.lean === "mixed") return null;
  const unchosen = reading.lean === "left" ? "right" : "left";
  const short = unchosen === "left" ? reading.leftLabel : reading.rightLabel;
  const unchosenCount = unchosen === "left" ? reading.leftCount : reading.rightCount;
  if (unchosenCount === 0) return WEDDING_CODE_ABSENCE.wholeSide(short);
  if (reading.questionVersion === WEDDING_CODE_V12_VERSION && reading.axis === "decisionCriteria") {
    return `“${short}” 쪽 답을 고르긴 했지만, 그중 ‘${reading.missingPhrases.join("’, ‘")}’에 관한 답은 없었어요.`;
  }
  return WEDDING_CODE_ABSENCE.partSide(short, reading.missingPhrases.join("’, ‘"));
}
