import type { WeddingCodeV06AxisKey } from "@/constants/weddingCodeV06";
import type { WeddingCodeSelfAxisReading, WeddingCodeSelfProfile } from "@/lib/weddingCode/scene/selfProfile";

/**
 * 웨딩코드 4글자.
 *
 * ## 이게 왜 성격 판정이 아닌가
 *
 * MBTI는 두 가지를 한 번에 말한다. (1) 「당신의 답을 네 글자로 요약하면 INFP」와
 * (2) 「INFP는 이런 사람이고 이런 사람과 잘 맞는다」. (1)은 계산이고 (2)는 주장이다.
 * MBTI는 (2)를 근거 없이 팔면서 (1)의 불안정성을 숨긴다 — 5주 뒤 다시 풀면 절반이
 * 글자가 바뀐다.
 *
 * 웨딩코드는 **(1)만 한다.** 글자는 그 축 다섯 장면에서 어느 쪽을 더 많이 골랐는지를
 * 적은 것이고, 그건 사용자가 방금 남긴 사실이다. 대신 MBTI가 숨기는 것을 드러낸다 —
 * **글자마다 몇 대 몇이었는지**를 같이 보여주고, 3:2로 아슬한 글자는 소문자로 적어
 * 다음에 바뀔 수 있다고 먼저 말한다.
 *
 * ## 왜 축당 문항이 홀수인가
 *
 * 짝수면 2:2 동점이 생긴다(4문항일 때 26%). 동점에서는 글자를 정할 수 없으므로
 * 「장면마다 달랐어요」 같은 애매한 칸이 생기고, 코드가 안 나온다. 홀수면 동점이
 * 구조적으로 불가능해서 답을 다 한 사람은 항상 네 글자를 받는다.
 *
 * 다만 **건너뛴 문항이 있으면 짝수가 될 수 있다.** 그때는 글자를 지어내지 않고
 * `MISSING_LETTER`를 넣는다. 안 고른 답으로 정체성을 만들지 않는다.
 */

/** 답이 없거나 정확히 반반이라 글자를 정할 수 없는 자리. */
export const WEDDING_CODE_MISSING_LETTER = "·";

export type WeddingCodeLetterFirmness = "firm" | "clear" | "narrow" | "unset";

export type WeddingCodeLetterSlot = Readonly<{
  axis: WeddingCodeV06AxisKey;
  axisLabel: string;
  /** 확정된 글자. 미정이면 `·`. 아슬한 글자는 소문자로 나간다. */
  letter: string;
  /** 대문자 기준 글자. 미정이면 null. 비교·집계는 이걸 쓴다. */
  upper: string | null;
  firmness: WeddingCodeLetterFirmness;
  /** 이 글자가 뜻하는 것 한 줄. 성격 설명이 아니라 고른 답의 요약이다. */
  meaning: string;
  majority: number;
  minority: number;
  answered: number;
  /** 「다섯 장면 중 세 곳」처럼 그대로 읽어줄 사실 문장. */
  tally: string;
  /** 아슬한 글자에만. 바뀔 수 있다는 사실을 먼저 알린다. */
  caution: string | null;
}>;

export type WeddingCodeLetters = Readonly<{
  /** 표시용 코드. 예: `VTuH`, `VT·H`. */
  code: string;
  /** 미정 자리를 뺀 확정 코드. 전부 확정이면 code와 같다(대문자). */
  upperCode: string;
  complete: boolean;
  slots: readonly WeddingCodeLetterSlot[];
}>;

type LetterDefinition = Readonly<{
  letter: string;
  meaning: string;
}>;

/**
 * 축마다 좌·우 글자.
 *
 * 열여섯 조합(VTUH…MOFA)이 나온다. 뜻은 **고른 답의 요약**으로만 쓴다 —
 * 「V인 사람은 꼼꼼하다」처럼 사람을 설명하는 문장으로 바꾸면 안 된다.
 */
export const WEDDING_CODE_LETTERS: Readonly<
  Record<WeddingCodeV06AxisKey, { left: LetterDefinition; right: LetterDefinition }>
> = {
  decisionCriteria: {
    left: { letter: "V", meaning: "금액과 조건을 먼저 확인한 답을 더 많이 골랐어요" },
    right: { letter: "M", meaning: "분위기와 의미를 먼저 본 답을 더 많이 골랐어요" },
  },
  preparationMode: {
    left: { letter: "T", meaning: "둘이 같이 보는 답을 더 많이 골랐어요" },
    right: { letter: "O", meaning: "한 사람이 맡아 정리하는 답을 더 많이 골랐어요" },
  },
  coordinationScope: {
    left: { letter: "U", meaning: "우리 둘의 기준을 먼저 둔 답을 더 많이 골랐어요" },
    right: { letter: "F", meaning: "가족과 하객 사정을 먼저 본 답을 더 많이 골랐어요" },
  },
  supportOrder: {
    left: { letter: "H", meaning: "먼저 마음을 듣는 답을 더 많이 골랐어요" },
    right: { letter: "A", meaning: "먼저 할 일을 정하는 답을 더 많이 골랐어요" },
  },
};

export const WEDDING_CODE_FIRMNESS_LABEL: Readonly<
  Record<WeddingCodeLetterFirmness, string>
> = {
  firm: "굳음",
  clear: "뚜렷",
  narrow: "아슬",
  unset: "미정",
};

/**
 * 굳기 판정.
 *
 * 소수 쪽이 하나 이하로 남았으면 뚜렷하고, 다수와 소수의 차이가 1이면 아슬하다.
 * 「몇 대 몇」을 항상 같이 내보내므로 사용자는 이 판정을 직접 반증할 수 있다.
 */
function firmnessOf(majority: number, minority: number): WeddingCodeLetterFirmness {
  if (majority === minority) return "unset";
  if (minority === 0) return "firm";
  return majority - minority === 1 ? "narrow" : "clear";
}

function slotFor(reading: WeddingCodeSelfAxisReading): WeddingCodeLetterSlot {
  const pair = WEDDING_CODE_LETTERS[reading.axis];
  const majority = Math.max(reading.leftCount, reading.rightCount);
  const minority = Math.min(reading.leftCount, reading.rightCount);
  const firmness = reading.answered === 0 ? "unset" : firmnessOf(majority, minority);
  const side = reading.leftCount >= reading.rightCount ? pair.left : pair.right;

  if (firmness === "unset") {
    return {
      axis: reading.axis,
      axisLabel: reading.axisLabel,
      letter: WEDDING_CODE_MISSING_LETTER,
      upper: null,
      firmness,
      meaning:
        reading.answered === 0
          ? "이 주제는 건너뛰어서 글자가 없어요"
          : "고른 답이 정확히 반반이라 글자를 정하지 않았어요",
      majority,
      minority,
      answered: reading.answered,
      tally:
        reading.answered === 0
          ? "답한 장면이 없어요."
          : `답한 ${reading.answered}장면이 ${majority} 대 ${minority}로 반반이었어요.`,
      caution: null,
    };
  }

  return {
    axis: reading.axis,
    axisLabel: reading.axisLabel,
    // 아슬한 글자를 대문자로 적으면 굳은 글자와 구별되지 않는다.
    letter: firmness === "narrow" ? side.letter.toLowerCase() : side.letter,
    upper: side.letter,
    firmness,
    meaning: side.meaning,
    majority,
    minority,
    answered: reading.answered,
    tally: `답한 ${reading.answered}장면 중 ${majority}곳이 이쪽이었어요.`,
    caution:
      firmness === "narrow"
        ? `${majority} 대 ${minority}로 아슬해서, 다시 답하면 ${
          side.letter === pair.left.letter ? pair.right.letter : pair.left.letter
        }로 바뀔 수 있어요.`
        : null,
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
    complete: slots.every((slot) => slot.upper !== null),
    slots,
  };
}

export type WeddingCodeParsedLetter = Readonly<{
  axis: WeddingCodeV06AxisKey;
  axisLabel: string;
  letter: string;
  /** 소문자로 적혀 온 글자. 「그때 아슬했다」는 표시일 뿐 다시 계산하지는 않는다. */
  narrow: boolean;
  meaning: string;
  /** 반대편 글자. 「이 자리의 다른 쪽」을 설명할 때 쓴다. */
  opposite: string;
  oppositeMeaning: string;
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
      meaning: side.meaning,
      opposite: other.letter,
      oppositeMeaning: other.meaning,
    });
  }
  return parsed;
}

/** 축 이름은 코드만 있을 때도 필요하다. 응답이 없으므로 상수에서 가져온다. */
const AXIS_LABELS: Readonly<Record<WeddingCodeV06AxisKey, string>> = {
  decisionCriteria: "정할 때 뭘 먼저 보나",
  preparationMode: "준비를 어떻게 나누나",
  coordinationScope: "누구까지 넣고 정하나",
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
