import { describe, expect, it } from "vitest";

import { WEDDING_CODE_V06_AXES } from "@/constants/weddingCodeV06";
import type {
  WeddingCodeSelfAxisReading,
  WeddingCodeSelfProfile,
} from "@/lib/weddingCode/scene/selfProfile";
import {
  WEDDING_CODE_LETTERS,
  WEDDING_CODE_FIRMNESS_LABEL,
  WEDDING_CODE_MISSING_LETTER,
  buildWeddingCodeLetters,
  compareWeddingCodeLetters,
} from "../letters";

/** 굳기 판정만 보려고 응답 수를 직접 지정한 축 하나. */
function reading(
  axis: WeddingCodeSelfAxisReading["axis"],
  leftCount: number,
  rightCount: number,
): WeddingCodeSelfAxisReading {
  const definition = WEDDING_CODE_V06_AXES.find((item) => item.key === axis)!;
  return {
    axis,
    axisLabel: definition.labelKo,
    lean: leftCount === rightCount ? "mixed" : leftCount > rightCount ? "left" : "right",
    title: "제목",
    leftLabel: definition.left.labelKo,
    rightLabel: definition.right.labelKo,
    leftCount,
    rightCount,
    answered: leftCount + rightCount,
    evidence: [],
    missingPhrases: [],
    qualifiers: [],
    tellPartner: "문장",
    watchOut: "문장",
  };
}

function profileOf(
  counts: readonly (readonly [number, number])[],
): WeddingCodeSelfProfile {
  const axes = WEDDING_CODE_V06_AXES.map((axis, index) =>
    reading(axis.key, counts[index][0], counts[index][1]),
  );
  const answered = axes.reduce((sum, item) => sum + item.answered, 0);
  return { answered, total: 20, complete: answered === 20, repeated: [], axes };
}

describe("웨딩코드 네 글자", () => {
  it("네 축에 한 답씩만 남겨도 전체 응답이 완료된 것으로 표시하지 않는다", () => {
    const letters = buildWeddingCodeLetters(profileOf([[1, 0], [1, 0], [1, 0], [1, 0]]));
    expect(letters.code).toBe("VTUH");
    expect(letters.complete).toBe(false);
    for (const slot of letters.slots) {
      // 한 장면만 답했으면 「1 대 0」이 아니라 그 한 장면이 어느 쪽이었는지만 말한다.
      expect(slot.countLine).toBe(
        `답한 1장면은 ${slot.left.letter}(${slot.left.short}) 쪽이었어요.`,
      );
      expect(slot.countLine).not.toMatch(/0장면|대 0/);
      expect(WEDDING_CODE_FIRMNESS_LABEL[slot.firmness]).not.toMatch(/굳음|확신|신뢰|안정/);
    }
  });

  it("셈 문장은 다섯 경우를 나눠 쓰고 왼쪽 글자를 먼저 쓴다", () => {
    const [split, allOne, tie, none] = buildWeddingCodeLetters(
      profileOf([[1, 4], [0, 3], [2, 2], [0, 0]]),
    ).slots;
    expect(split.countLine).toBe("답한 5장면 중 1장면은 V(조건 먼저), 4장면은 M(분위기 먼저) 쪽이었어요.");
    expect(allOne.countLine).toBe("답한 3장면 모두 O(맡아서 하기) 쪽이었어요.");
    expect(tie.countLine).toBe("답한 4장면이 U(우리 둘 먼저) 쪽과 F(가족·하객까지) 쪽 반반이었어요.");
    expect(none.countLine).toBe("이 주제는 아직 답하지 않았어요.");
  });

  /**
   * 범례는 이긴 쪽만이 아니라 **양쪽 끝**을 그린다. 슬롯이 양쪽 글자·이름·수를 모두
   * 들고 있어야 화면이 셈을 다시 하지 않는다.
   */
  it("자리마다 양쪽 글자·짧은 이름·답 수와 고른 쪽을 함께 넘긴다", () => {
    const letters = buildWeddingCodeLetters(profileOf([[4, 1], [1, 3], [2, 2], [0, 0]]));
    for (const slot of letters.slots) {
      const pair = WEDDING_CODE_LETTERS[slot.axis];
      expect(slot.left).toMatchObject({ letter: pair.left.letter, short: pair.left.short });
      expect(slot.right).toMatchObject({ letter: pair.right.letter, short: pair.right.short });
      expect(slot.left.count + slot.right.count).toBe(slot.answered);
      expect(slot.left.short.length).toBeGreaterThan(0);
      expect(slot.right.short).not.toBe(slot.left.short);
    }
    expect(letters.slots.map((slot) => slot.chosen)).toEqual(["left", "right", null, null]);
    expect(letters.slots[0]).toMatchObject({ left: { count: 4 }, right: { count: 1 } });
  });

  it("응답 분포의 이름을 검증된 확신 정도로 표현하지 않는다", () => {
    for (const label of Object.values(WEDDING_CODE_FIRMNESS_LABEL)) {
      expect(label).not.toMatch(/굳음|뚜렷|아슬|확신|신뢰|안정/);
    }
  });

  it("축 순서대로 네 자리를 만든다", () => {
    const letters = buildWeddingCodeLetters(
      profileOf([[5, 0], [5, 0], [5, 0], [5, 0]]),
    );
    expect(letters.code).toHaveLength(WEDDING_CODE_V06_AXES.length);
    expect(letters.code).toBe("VTUH");
    expect(letters.complete).toBe(true);

    const opposite = buildWeddingCodeLetters(
      profileOf([[0, 5], [0, 5], [0, 5], [0, 5]]),
    );
    expect(opposite.code).toBe("MOFA");
  });

  it("굳기에 따라 글자 모양이 달라진다", () => {
    const letters = buildWeddingCodeLetters(
      profileOf([[5, 0], [4, 1], [3, 2], [1, 4]]),
    );
    // 5:0 굳음, 4:1 뚜렷은 대문자. 3:2 아슬은 소문자.
    expect(letters.code).toBe("VTuA");
    expect(letters.slots.map((slot) => slot.firmness)).toEqual([
      "firm", "clear", "narrow", "clear",
    ]);
    // 비교·집계는 대문자 기준이라 아슬해도 자리를 잃지 않는다.
    expect(letters.upperCode).toBe("VTUA");
  });

  it("하나 차이인 글자는 답 하나로 바뀐다고 먼저 알린다", () => {
    const [slot] = buildWeddingCodeLetters(profileOf([[3, 2], [5, 0], [5, 0], [5, 0]])).slots;
    expect(slot.firmness).toBe("narrow");
    expect(slot.letter).toBe("v");
    // 소문자가 아니라 대문자로, 반대편 글자를 정확히 알려준다.
    expect(slot.narrowCaution).toBe(
      "양쪽 답이 하나 차이예요. 답 하나만 반대쪽으로 바꿔도 V 대신 M 글자가 나와요.",
    );
    expect(slot.countLine).toContain("3장면은 V(조건 먼저), 2장면은 M(분위기 먼저)");

    const [right] = buildWeddingCodeLetters(profileOf([[1, 2], [5, 0], [5, 0], [5, 0]])).slots;
    expect(right.letter).toBe("m");
    expect(right.narrowCaution).toContain("M 대신 V 글자가");

    const firm = buildWeddingCodeLetters(profileOf([[5, 0], [5, 0], [5, 0], [5, 0]])).slots[0];
    expect(firm.narrowCaution).toBeNull();
  });

  /**
   * 건너뛴 축에 글자를 지어 넣으면, 고르지도 않은 답으로 정체성을 만드는 것이 된다.
   */
  it("건너뛰었거나 정확히 반반이면 글자를 만들지 않는다", () => {
    const skipped = buildWeddingCodeLetters(profileOf([[0, 0], [5, 0], [5, 0], [5, 0]]));
    expect(skipped.code.startsWith(WEDDING_CODE_MISSING_LETTER)).toBe(true);
    expect(skipped.slots[0].upper).toBeNull();
    expect(skipped.slots[0].firmness).toBe("unset");
    expect(skipped.complete).toBe(false);
    expect(skipped.slots[0].meaning).toBe("이 주제 장면을 모두 건너뛰어서 글자가 없어요");
    expect(skipped.slots[0].chosen).toBeNull();

    // 건너뛴 문항 때문에 짝수가 되어 정확히 반반이 될 수 있다.
    const tied = buildWeddingCodeLetters(profileOf([[2, 2], [5, 0], [5, 0], [5, 0]]));
    expect(tied.slots[0].upper).toBeNull();
    expect(tied.slots[0].countLine).toContain("반반");
    expect(tied.slots[0].meaning).toBe("양쪽 답이 같은 수라서 이 자리는 글자를 비워 뒀어요");
    expect(tied.slots[0].narrowCaution).toBeNull();
    expect(tied.complete).toBe(false);
  });

  it("셈이 항상 글자와 함께 나간다", () => {
    for (const slot of buildWeddingCodeLetters(profileOf([[5, 0], [4, 1], [3, 2], [0, 0]])).slots) {
      expect(slot.countLine.length).toBeGreaterThan(0);
      expect(slot.meaning.length).toBeGreaterThan(0);
    }
  });

  it("성격을 설명하거나 점수를 매기지 않는다", () => {
    const letters = buildWeddingCodeLetters(profileOf([[5, 0], [4, 1], [3, 2], [2, 3]]));
    const text = letters.slots
      .map((slot) => `${slot.meaning} ${slot.countLine} ${slot.narrowCaution ?? ""} ${slot.left.short} ${slot.right.short}`)
      .join(" ");
    for (const banned of ["당신은", "성격", "유형", "궁합", "점수", "등급", "예측", "잘 맞"]) {
      expect(text, banned).not.toContain(banned);
    }
    // 뜻은 사람이 아니라 「고른 답」을 설명해야 한다.
    for (const slot of letters.slots) {
      expect(slot.meaning, slot.axis).toContain("골랐어요");
    }
  });

  it("열여섯 조합이 모두 서로 다른 코드가 된다", () => {
    const codes = new Set<string>();
    for (let mask = 0; mask < 16; mask += 1) {
      const counts = [0, 1, 2, 3].map((index) =>
        (mask >> index) & 1 ? ([0, 5] as const) : ([5, 0] as const),
      );
      codes.add(buildWeddingCodeLetters(profileOf(counts)).code);
    }
    expect(codes.size).toBe(16);
  });
});

describe("두 코드 비교", () => {
  it("자리마다 같은지 다른지만 말하고 점수로 합치지 않는다", () => {
    const mine = buildWeddingCodeLetters(profileOf([[5, 0], [5, 0], [0, 5], [3, 2]]));
    const theirs = buildWeddingCodeLetters(profileOf([[5, 0], [0, 5], [0, 5], [2, 3]]));
    const comparison = compareWeddingCodeLetters(mine, theirs);

    expect(comparison.map((item) => item.state)).toEqual([
      "same", "different", "same", "different",
    ]);
    // 어떤 필드도 점수·백분율이 아니다.
    for (const item of comparison) {
      expect(Object.keys(item)).toEqual(["axis", "axisLabel", "first", "second", "state"]);
    }
  });

  it("아슬한 글자도 대문자 기준으로 비교해 자리를 잃지 않는다", () => {
    const mine = buildWeddingCodeLetters(profileOf([[3, 2], [5, 0], [5, 0], [5, 0]]));
    const theirs = buildWeddingCodeLetters(profileOf([[5, 0], [5, 0], [5, 0], [5, 0]]));
    expect(mine.slots[0].letter).toBe("v");
    expect(compareWeddingCodeLetters(mine, theirs)[0].state).toBe("same");
  });

  it("한쪽이 건너뛴 자리는 같다고도 다르다고도 하지 않는다", () => {
    const mine = buildWeddingCodeLetters(profileOf([[0, 0], [5, 0], [5, 0], [5, 0]]));
    const theirs = buildWeddingCodeLetters(profileOf([[5, 0], [5, 0], [5, 0], [5, 0]]));
    expect(compareWeddingCodeLetters(mine, theirs)[0].state).toBe("unknown");
  });
});
