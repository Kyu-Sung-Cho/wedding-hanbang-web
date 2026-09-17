import type { WeddingCodeV06AxisKey } from "@/constants/weddingCodeV06";
import type { WeddingCodeSelfAxisReading, WeddingCodeSelfProfile } from "@/lib/weddingCode/scene/selfProfile";

/**
 * 웨딩코드 4글자.
 *
 * 축별로 어느 쪽 답을 더 많이 골랐는지 요약한다. 응답 수와 양쪽 수를 함께
 * 표시하며, 그 분포를 사람의 확신이나 재응답 안정성으로 해석하지 않는다.
 * 동점·무응답은 글자를 정하지 않고, 일부 응답에서 글자가 나와도 완료로 보지 않는다.
 */

/** 답이 없거나 정확히 반반이라 글자를 정할 수 없는 자리. */
export const WEDDING_CODE_MISSING_LETTER = "·";

export type WeddingCodeLetterFirmness = "firm" | "clear" | "narrow" | "unset";

export type WeddingCodeSide = "left" | "right";

/**
 * 한 자리의 한쪽 끝. 범례가 **양쪽 글자와 이름을 모두** 그리려면 이긴 쪽만으로는 부족하다 —
 * MBTI 의 I 옆에 E 가 없으면 I 가 무엇의 반대인지 모른다(2026-09-17 팀원 피드백).
 */
export type WeddingCodePole = Readonly<{
  letter: string;
  /** 「조건 먼저」처럼 짧은 이름. 사람 설명이 아니라 답의 방향이다. */
  short: string;
  /** 이 쪽 답을 고른 장면 수. 답하지 않은 장면은 어느 쪽에도 세지 않는다. */
  count: number;
}>;

export type WeddingCodeLetterSlot = Readonly<{
  axis: WeddingCodeV06AxisKey;
  axisLabel: string;
  /** 응답 요약 글자. 미정이면 `·`. 양쪽 답이 있고 하나 차이면 소문자로 나간다. */
  letter: string;
  /** 대문자 기준 글자. 미정이면 null. 비교·집계는 이걸 쓴다. */
  upper: string | null;
  firmness: WeddingCodeLetterFirmness;
  /** 이 글자가 뜻하는 것 한 줄. 미정이면 왜 비웠는지. 성격 설명이 아니라 고른 답의 요약이다. */
  meaning: string;
  majority: number;
  minority: number;
  answered: number;
  left: WeddingCodePole;
  right: WeddingCodePole;
  /** 더 많이 고른 쪽. 답이 없거나 같은 수면 null. */
  chosen: WeddingCodeSide | null;
  /** 「답한 5장면 중 4장면은 V(조건 먼저), …」처럼 그대로 읽어줄 사실 문장. 왼쪽을 먼저 쓴다. */
  countLine: string;
  /** 하나 차이일 때 답 하나로 글자가 바뀐다는 사실. 아니면 null. */
  narrowCaution: string | null;
}>;

export type WeddingCodeLetters = Readonly<{
  /** 표시용 코드. 예: `VTuH`, `VT·H`. */
  code: string;
  /** 미정 자리를 뺀 확정 코드. 전부 확정이면 code와 같다(대문자). */
  upperCode: string;
  /** 모든 문항에 답했고 네 자리 모두 글자가 있는가. */
  complete: boolean;
  slots: readonly WeddingCodeLetterSlot[];
}>;

type LetterDefinition = Readonly<{
  letter: string;
  /** 범례·집계 문장·제목에 같이 쓰는 짧은 이름. */
  short: string;
  meaning: string;
}>;

/**
 * 축마다 좌·우 글자.
 *
 * 열여섯 조합(VTUH…MOFA)이 나온다. 뜻은 **고른 답의 요약**으로만 쓴다 —
 * 「V인 사람은 꼼꼼하다」처럼 사람을 설명하는 문장으로 바꾸면 안 된다.
 *
 * 2026-09-17: 팀원이 「VTFH 가 뭔지, 각 자리의 다른 글자가 뭔지 모르겠다」고 했다.
 * 그래서 글자마다 짧은 이름을 붙이고, 범례가 양쪽 끝을 함께 그린다. 이름과 뜻은
 * 모든 판(v0.6·v0.8·v0.9)이 같이 쓴다.
 */
export const WEDDING_CODE_LETTERS: Readonly<
  Record<WeddingCodeV06AxisKey, { left: LetterDefinition; right: LetterDefinition }>
> = {
  decisionCriteria: {
    left: {
      letter: "V",
      short: "조건 먼저",
      meaning: "얼마가 드는지, 적힌 내용이 사실인지부터 따지는 답을 더 많이 골랐어요",
    },
    right: {
      letter: "M",
      short: "분위기 먼저",
      meaning: "사진과 분위기, 결혼식 날에 거는 기대나 받은 인상부터 보는 답을 더 많이 골랐어요",
    },
  },
  preparationMode: {
    left: {
      letter: "T",
      short: "둘이 같이",
      meaning: "한 사람이 도맡지 않는 답을 더 많이 골랐어요",
    },
    right: {
      letter: "O",
      short: "맡아서 하기",
      meaning: "누군가 맡아서 혼자 정하거나 정리하는 답을 더 많이 골랐어요",
    },
  },
  coordinationScope: {
    left: {
      letter: "U",
      short: "우리 둘 먼저",
      meaning: "우리 둘 기준을 앞에 둔 답을 더 많이 골랐어요",
    },
    right: {
      letter: "F",
      short: "가족·하객까지",
      meaning: "가족과 하객 사정을 앞에 둔 답을 더 많이 골랐어요",
    },
  },
  supportOrder: {
    left: {
      letter: "H",
      short: "마음 먼저",
      meaning: "마음과 대화 쪽 답을 더 많이 골랐어요",
    },
    right: {
      letter: "A",
      short: "할 일 먼저",
      meaning: "할 일과 결정 쪽 답을 더 많이 골랐어요",
    },
  },
};

export const WEDDING_CODE_FIRMNESS_LABEL: Readonly<
  Record<WeddingCodeLetterFirmness, string>
> = {
  firm: "모두 같은 쪽",
  clear: "한쪽이 더 많음",
  narrow: "하나 차이",
  unset: "글자 없음",
};

/** 배지 범례의 고지. 소문자 규칙을 여기서 한 번에 설명한다. */
export const WEDDING_CODE_LEGEND = {
  title: "네 글자 읽는 법",
  note:
    "성격을 맞힌 게 아니라, 이번에 고른 답이 어느 쪽에 더 많았는지 적은 글자예요."
    + " 소문자는 양쪽 답이 하나 차이일 때 나와요. 답 하나만 바꿔도 반대쪽 글자가 돼요.",
} as const;

/**
 * 셈 문장.
 *
 * ## 왜 숫자와 글자 바로 뒤에 조사를 붙이지 않나
 *
 * 예전 문장은 `… ${majority} 대 ${minority}예요` 였다. 1 은 「일」로 읽으니 「1이에요」가
 * 맞는데 화면에는 「4 대 1예요」가 나갔고, `${letter}로` 는 M 에서 「M으로」여야 했다.
 * 숫자·영문 뒤 조사는 받침을 코드가 알 수 없다. 그래서 틀을 바꿔 **숫자 뒤에는 「장면」,
 * 글자 뒤에는 괄호만** 오게 했다. 조사는 「장면은」 「쪽이었어요」처럼 고정 낱말에만 붙는다.
 */
const COUNT_LINE = {
  none: "답한 장면이 없어요.",
  oneAnswered: (pole: WeddingCodePole) =>
    `답한 1장면은 ${pole.letter}(${pole.short}) 쪽이었어요.`,
  allOneSide: (answered: number, pole: WeddingCodePole) =>
    `답한 ${answered}장면 모두 ${pole.letter}(${pole.short}) 쪽이었어요.`,
  tie: (answered: number, left: WeddingCodePole, right: WeddingCodePole) =>
    `답한 ${answered}장면이 ${left.letter}(${left.short}) 쪽과 ${right.letter}(${right.short}) 쪽으로 반반 나뉘었어요.`,
  split: (answered: number, left: WeddingCodePole, right: WeddingCodePole) =>
    `답한 ${answered}장면 중 ${left.count}장면은 ${left.letter}(${left.short}), ${right.count}장면은 ${right.letter}(${right.short}) 쪽이었어요.`,
} as const;

const UNSET_LINE = {
  tie: "양쪽 답 수가 같아서 이 자리는 글자를 비워 뒀어요",
  skipped: "이 주제는 모두 건너뛰어서 글자가 없어요",
} as const;

/** `{upper}` 는 대문자로 채운다. 소문자(slot.letter)를 넣으면 「v 대신」처럼 읽혀 헷갈린다. */
function narrowCautionFor(upper: string, opposite: string): string {
  return `답 하나만 반대로 골라도 ${upper} 대신 ${opposite} 글자가 나와요.`;
}

/** 한 축의 양쪽 끝. 셈은 호출하는 쪽이 넘긴다 — 여기서 지어내지 않는다. */
export function weddingCodePoles(
  axis: WeddingCodeV06AxisKey,
  leftCount: number,
  rightCount: number,
): Readonly<{ left: WeddingCodePole; right: WeddingCodePole }> {
  const pair = WEDDING_CODE_LETTERS[axis];
  return {
    left: { letter: pair.left.letter, short: pair.left.short, count: leftCount },
    right: { letter: pair.right.letter, short: pair.right.short, count: rightCount },
  };
}

/**
 * 「답한 N장면 중 …」 사실 문장. 배지 범례·축 카드·커플 요약이 모두 이 함수를 쓴다.
 *
 * 고르는 규칙: 답 0 → none, 1 → oneAnswered, 한쪽이 0 → allOneSide, 같은 수 → tie,
 * 나머지 → split. 양쪽을 다 쓸 때는 항상 왼쪽 글자를 먼저 쓴다.
 */
export function describeWeddingCodeCount(
  axis: WeddingCodeV06AxisKey,
  leftCount: number,
  rightCount: number,
): string {
  const { left, right } = weddingCodePoles(axis, leftCount, rightCount);
  const answered = leftCount + rightCount;
  if (answered === 0) return COUNT_LINE.none;
  const only = rightCount === 0 ? left : leftCount === 0 ? right : null;
  if (answered === 1 && only) return COUNT_LINE.oneAnswered(only);
  if (only) return COUNT_LINE.allOneSide(answered, only);
  if (leftCount === rightCount) return COUNT_LINE.tie(answered, left, right);
  return COUNT_LINE.split(answered, left, right);
}

/**
 * 기존 표시용 enum을 유지하되, 실제 응답 분포만 구분한다.
 * 모두 같은 쪽이라는 사실은 문항 수나 확신을 대신하지 않는다.
 */
function firmnessOf(majority: number, minority: number): WeddingCodeLetterFirmness {
  if (majority === minority) return "unset";
  if (minority === 0) return "firm";
  return majority - minority === 1 ? "narrow" : "clear";
}

function slotFor(reading: WeddingCodeSelfAxisReading): WeddingCodeLetterSlot {
  const pair = WEDDING_CODE_LETTERS[reading.axis];
  const { left, right } = weddingCodePoles(reading.axis, reading.leftCount, reading.rightCount);
  const answered = reading.leftCount + reading.rightCount;
  const majority = Math.max(reading.leftCount, reading.rightCount);
  const minority = Math.min(reading.leftCount, reading.rightCount);
  const firmness = answered === 0 ? "unset" : firmnessOf(majority, minority);
  const countLine = describeWeddingCodeCount(reading.axis, reading.leftCount, reading.rightCount);
  const base = {
    axis: reading.axis,
    axisLabel: reading.axisLabel,
    firmness,
    majority,
    minority,
    answered,
    left,
    right,
    countLine,
  } as const;

  if (firmness === "unset") {
    return {
      ...base,
      letter: WEDDING_CODE_MISSING_LETTER,
      upper: null,
      chosen: null,
      meaning: answered === 0 ? UNSET_LINE.skipped : UNSET_LINE.tie,
      narrowCaution: null,
    };
  }

  const chosen: WeddingCodeSide = reading.leftCount > reading.rightCount ? "left" : "right";
  const side = pair[chosen];
  const other = pair[chosen === "left" ? "right" : "left"];
  return {
    ...base,
    // 기존 공유 코드의 대소문자 의미를 유지한다.
    letter: firmness === "narrow" ? side.letter.toLowerCase() : side.letter,
    upper: side.letter,
    chosen,
    meaning: side.meaning,
    narrowCaution: firmness === "narrow" ? narrowCautionFor(side.letter, other.letter) : null,
  };
}

/** 개인 결과에서 네 글자를 만든다. 축 순서는 항상 같다. */
export function buildWeddingCodeLetters(
  profile: WeddingCodeSelfProfile,
): WeddingCodeLetters {
  const slots = profile.axes.map(slotFor);
  return {
    code: slots.map((slot) => slot.letter).join(""),
    upperCode: slots.map((slot) => slot.upper ?? WEDDING_CODE_MISSING_LETTER).join(""),
    complete: profile.complete && slots.every((slot) => slot.upper !== null),
    slots,
  };
}

export type WeddingCodeParsedLetter = Readonly<{
  axis: WeddingCodeV06AxisKey;
  axisLabel: string;
  letter: string;
  /** 소문자로 적혀 온 글자. 「그때 하나 차이였다」는 표시일 뿐 다시 계산하지는 않는다. */
  narrow: boolean;
  /** 결과 화면 범례와 같은 짧은 이름. */
  short: string;
  meaning: string;
  /** 반대편 글자. 「이 자리의 다른 쪽」을 설명할 때 쓴다. */
  opposite: string;
  oppositeShort: string;
  oppositeMeaning: string;
  /** 이 글자가 축의 왼쪽인가. 범례를 결과 화면과 같은 방향(왼쪽 먼저)으로 그릴 때 쓴다. */
  side: WeddingCodeSide;
}>;

/**
 * 코드 문자열을 뜻으로 푼다 — **응답 없이**.
 *
 * MBTI는 「나 INFP야」만 알아도 그게 무슨 뜻인지 찾아볼 수 있다. 웨딩코드도 스무 문항을
 * 다시 풀지 않고 글자만으로 뜻을 볼 수 있어야 이름값을 한다.
 *
 * 여기서 푸는 것은 **글자의 뜻**뿐이다. 누가 무엇을 골랐는지는 코드에 들어 있지 않으므로
 * 이 경로에는 개인 응답이 없다. 그래서 공유해도 되고 색인해도 된다.
 */
export function parseWeddingCodeString(
  value: string,
): readonly WeddingCodeParsedLetter[] | null {
  const raw = value.trim();
  const axes = Object.keys(WEDDING_CODE_LETTERS) as WeddingCodeV06AxisKey[];
  if (raw.length !== axes.length) return null;

  const parsed: WeddingCodeParsedLetter[] = [];
  for (const [index, axis] of axes.entries()) {
    const character = raw[index];
    const pair = WEDDING_CODE_LETTERS[axis];
    const upper = character.toUpperCase();
    const side =
      upper === pair.left.letter ? pair.left
        : upper === pair.right.letter ? pair.right
          : null;
    if (!side) return null;
    const other = side === pair.left ? pair.right : pair.left;
    parsed.push({
      axis,
      axisLabel: AXIS_LABELS[axis],
      letter: upper,
      // 대문자로만 온 코드는 굳기를 알 수 없다. 모른다고 지어내지 않는다.
      narrow: character === character.toLowerCase() && character !== upper,
      short: side.short,
      meaning: side.meaning,
      opposite: other.letter,
      oppositeShort: other.short,
      oppositeMeaning: other.meaning,
      side: side === pair.left ? "left" : "right",
    });
  }
  return parsed;
}

/** 축 이름은 코드만 있을 때도 필요하다. 응답이 없으므로 상수에서 가져온다. */
const AXIS_LABELS: Readonly<Record<WeddingCodeV06AxisKey, string>> = {
  decisionCriteria: "정할 때 뭘 먼저 보나",
  preparationMode: "준비를 어떻게 나누나",
  coordinationScope: "누구 의견까지 듣고 정하나",
  supportOrder: "힘들 때 뭐부터 하나",
};

export type WeddingCodeLetterComparison = Readonly<{
  axis: WeddingCodeV06AxisKey;
  axisLabel: string;
  first: WeddingCodeLetterSlot;
  second: WeddingCodeLetterSlot;
  /** 둘 다 글자가 있고 서로 다른가. 한쪽이라도 미정이면 `unknown`. */
  state: "same" | "different" | "unknown";
}>;

/**
 * 두 코드를 나란히 본다.
 *
 * **점수로 합치지 않는다.** 「네 자리 중 세 자리가 같으니 75점」은 근거 없이 관계를
 * 예측하는 것이다. 자리마다 같은지 다른지만 말하고, 다른 자리에서 무엇을 이야기할지는
 * 기존 차이 지도가 맡는다.
 */
export function compareWeddingCodeLetters(
  first: WeddingCodeLetters,
  second: WeddingCodeLetters,
): readonly WeddingCodeLetterComparison[] {
  return first.slots.map((slot, index) => {
    const other = second.slots[index];
    return {
      axis: slot.axis,
      axisLabel: slot.axisLabel,
      first: slot,
      second: other,
      state:
        slot.upper === null || other.upper === null
          ? "unknown"
          : slot.upper === other.upper
            ? "same"
            : "different",
    };
  });
}
