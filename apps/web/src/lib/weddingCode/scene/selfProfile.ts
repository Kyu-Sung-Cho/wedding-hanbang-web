import {
  WEDDING_CODE_V06_AXES,
  WEDDING_CODE_V06_QUESTIONS,
  type WeddingCodeV06Axis,
  type WeddingCodeV06AxisKey,
  type WeddingCodeV06OptionValue,
  type WeddingCodeV06Question,
} from "@/constants/weddingCodeV06";
import {
  WEDDING_CODE_CHECK_PHRASE,
  WEDDING_CODE_RESPONSE_QUALIFIERS,
  WEDDING_CODE_SELF_READING,
  type WeddingCodeReadableConstructKey,
  type WeddingCodeSelfLean,
} from "@/constants/weddingCodeSelfReading";
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
  leftLabel: string;
  rightLabel: string;
  leftCount: number;
  rightCount: number;
  answered: number;
  /** 많이 고른 쪽을 먼저 두되, 양쪽 답이 있으면 각각 하나씩 인용한다. */
  evidence: readonly WeddingCodeSelfQuote[];
  /** 한 번도 고르지 않은 쪽 문장. 비어 있으면 양쪽 다 고른 것이다. */
  missingPhrases: readonly string[];
  tellPartner: string;
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
    axisReadings.push({
      axis: axis.key,
      axisLabel: axis.labelKo,
      lean,
      title: copy.title,
      leftLabel: axis.key === "supportOrder" ? "마음·대화" : axis.left.labelKo,
      rightLabel: axis.key === "supportOrder" ? "할 일·결정"
        : axis.key === "decisionCriteria" ? "사진·분위기와 기대·인상" : axis.right.labelKo,
      leftCount,
      rightCount,
      answered,
      evidence,
      missingPhrases,
      tellPartner: copy.tellPartner,
      watchOut: [...new Set(qualifiers), copy.watchOut].join(" "),
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
 * 「네 장면 중 세 곳에서」처럼 셈을 그대로 읽어주는 사실 문장.
 *
 * 카피 상수가 아니라 여기서 만든다 — 숫자가 화면에 뜨는 문장은 반드시 실제 응답에서
 * 나와야 하고, 손으로 쓴 문장이 그 자리를 대신하면 안 되기 때문이다.
 */
export function describeSelfAxisReading(reading: WeddingCodeSelfAxisReading): string {
  const { leftCount, rightCount, answered, leftLabel, rightLabel } = reading;
  if (answered === 0) return "이 주제는 아직 답하지 않았어요.";
  // 연락이 늦어진 답도 포함되므로 두 쪽의 셈을 실제 공동 검토 행동으로 바꾸지 않는다.
  if (reading.axis === "preparationMode") {
    return `답한 ${answered}장면 중 함께 확인하는 과정과 연락 경험 쪽이 ${leftCount}곳, 한 사람이 맡아 정리하는 방식 쪽이 ${rightCount}곳이었어요. 실제 고른 문장을 함께 확인해 주세요.`;
  }
  if (reading.axis === "supportOrder") {
    return `답한 ${answered}장면 중 마음·대화에 관한 답이 ${leftCount}곳, 할 일·결정에 관한 답이 ${rightCount}곳이었어요. 실제 고른 문장을 함께 확인해 주세요.`;
  }
  if (reading.lean === "mixed") {
    return `답한 ${answered}장면 중 ${leftLabel} 쪽이 ${leftCount}곳, ${rightLabel} 쪽이 ${rightCount}곳이었어요.`;
  }
  const count = Math.max(leftCount, rightCount);
  const label = leftCount > rightCount ? leftLabel : rightLabel;
  return `답한 ${answered}장면 중 ${count}곳에서 ${label} 쪽 문장을 골랐어요.`;
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

/** 한 번도 고르지 않은 확인이 있으면 그것을 말한다. 없으면 조용히 비운다. */
export function describeSelfAxisAbsence(
  reading: WeddingCodeSelfAxisReading,
): string | null {
  if (reading.missingPhrases.length === 0) return null;
  const quoted = reading.missingPhrases.map((phrase) => `“${phrase}”`);
  const joined = quoted
    .slice(0, -1)
    .map((phrase) => withJosa(phrase, "과", "와"))
    .concat(quoted[quoted.length - 1])
    .join(" ");
  return `${joined} 쪽 문장은 한 번도 고르지 않았어요. 실제 준비에서도 그랬다는 뜻은 아니에요.`;
}
