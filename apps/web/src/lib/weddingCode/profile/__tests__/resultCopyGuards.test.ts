import { describe, expect, it } from "vitest";

import { WEDDING_CODE_V06_AXES, type WeddingCodeV06AxisKey } from "@/constants/weddingCodeV06";
import {
  WEDDING_CODE_CHECK_PHRASE,
  WEDDING_CODE_SELF_READING,
  type WeddingCodeSelfLean,
} from "@/constants/weddingCodeSelfReading";
import {
  describeSelfAxisAbsence,
  describeSelfAxisReading,
  type WeddingCodeSelfAxisReading,
  type WeddingCodeSelfProfile,
} from "@/lib/weddingCode/scene/selfProfile";
import {
  WEDDING_CODE_LETTERS,
  buildWeddingCodeLetters,
  parseWeddingCodeString,
} from "../letters";

/**
 * 결과 화면 문장의 기계 가드 (2026-09-17).
 *
 * ## 왜 생성해서 보나
 *
 * 팀원이 라이브에서 「답한 5장면에서 이쪽과 반대쪽 답은 4 대 1예요」를 봤다. 1 은 「일」로
 * 읽으니 「1이에요」가 맞다. 같은 코드의 「M로」도 「M으로」여야 했다. 둘 다 **특정 숫자·
 * 글자에서만** 틀리므로, 손으로 고른 예시 몇 개로는 못 잡는다(그 테스트는 4 대 1 을
 * 고르지 않았다). 그래서 0..5 × 0..5 모든 셈과 여덟 글자 모두로 문장을 만들어 본다.
 *
 * 규칙: 숫자 바로 뒤에는 「장면」만, 영문 글자 바로 뒤에는 한글이 오지 않는다.
 * 숫자·영문 뒤 조사는 받침을 코드가 알 수 없으므로, 틀 자체가 그런 자리를 만들지 않는다.
 */
const GLUED_PARTICLE = /\d(?!장면)[가-힣]|[A-Za-z][가-힣]/;

type Side = "left" | "right";
const COUNTS = [0, 1, 2, 3, 4, 5] as const;

function leanOf(left: number, right: number): WeddingCodeSelfLean {
  return left === right ? "mixed" : left > right ? "left" : "right";
}

/** 그 축 한쪽 편의 주제 문구. 실제 축 정의에서 가져온다. */
function phrasesOf(axis: WeddingCodeV06AxisKey, side: Side): string[] {
  const definition = WEDDING_CODE_V06_AXES.find((item) => item.key === axis)!;
  return (definition[side].constructs as readonly string[])
    .filter((construct): construct is keyof typeof WEDDING_CODE_CHECK_PHRASE => construct in WEDDING_CODE_CHECK_PHRASE)
    .map((construct) => WEDDING_CODE_CHECK_PHRASE[construct]);
}

function readingFor(
  axis: WeddingCodeV06AxisKey,
  leftCount: number,
  rightCount: number,
  missing: "none" | "whole" | "part",
): WeddingCodeSelfAxisReading {
  const definition = WEDDING_CODE_V06_AXES.find((item) => item.key === axis)!;
  const lean = leanOf(leftCount, rightCount);
  const unchosen = lean === "left" ? "right" : lean === "right" ? "left" : null;
  const unchosenPhrases = unchosen ? phrasesOf(axis, unchosen) : [];
  return {
    axis,
    axisLabel: definition.labelKo,
    lean,
    title: WEDDING_CODE_SELF_READING[axis][lean].title,
    leftLabel: WEDDING_CODE_LETTERS[axis].left.short,
    rightLabel: WEDDING_CODE_LETTERS[axis].right.short,
    leftCount,
    rightCount,
    answered: leftCount + rightCount,
    evidence: [],
    missingPhrases: missing === "none" ? [] : missing === "whole" ? unchosenPhrases : unchosenPhrases.slice(0, 1),
    qualifiers: [],
    tellPartner: WEDDING_CODE_SELF_READING[axis][lean].tellPartner,
    watchOut: WEDDING_CODE_SELF_READING[axis][lean].watchOut,
  };
}

function profileWith(axis: WeddingCodeV06AxisKey, leftCount: number, rightCount: number): WeddingCodeSelfProfile {
  const axes = WEDDING_CODE_V06_AXES.map((definition) =>
    definition.key === axis
      ? readingFor(axis, leftCount, rightCount, "none")
      : readingFor(definition.key, 0, 0, "none"),
  );
  const answered = leftCount + rightCount;
  return { answered, total: 20, complete: false, repeated: [], axes };
}

/** 한 축의 모든 셈(0..5 × 0..5)에서 화면에 나갈 수 있는 사실 문장을 전부 만든다. */
function generatedSentences(): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  for (const { key: axis } of WEDDING_CODE_V06_AXES) {
    for (const left of COUNTS) {
      for (const right of COUNTS) {
        const label = `${axis} ${left}:${right}`;
        const slot = buildWeddingCodeLetters(profileWith(axis, left, right)).slots.find((item) => item.axis === axis)!;
        out.push({ label: `${label} countLine`, text: slot.countLine });
        out.push({ label: `${label} meaning`, text: slot.meaning });
        if (slot.narrowCaution) out.push({ label: `${label} narrowCaution`, text: slot.narrowCaution });
        for (const missing of ["none", "whole", "part"] as const) {
          const reading = readingFor(axis, left, right, missing);
          out.push({ label: `${label} reading`, text: describeSelfAxisReading(reading) });
          const absence = describeSelfAxisAbsence(reading);
          if (absence) out.push({ label: `${label} absence/${missing}`, text: absence });
        }
      }
    }
  }
  return out;
}

describe("결과 화면 사실 문장 — 숫자·영문 뒤 조사", () => {
  it("측정기가 살아 있다", () => {
    // 옛 문장과 팀원이 본 오류를 실제로 잡는지 먼저 본다. 이게 초록이면 아래 초록은 공짜다.
    for (const broken of ["4 대 1예요", "답을 바꾸면 M로 바뀔 수 있어요", "V를 골랐어요", "3곳에서", "O와 T"]) {
      expect(broken, broken).toMatch(GLUED_PARTICLE);
    }
    for (const fine of ["답한 5장면 중 4장면은 V(조건 먼저), 1장면은 M(분위기 먼저) 쪽이었어요.", "V 대신 M 글자가"]) {
      expect(fine, fine).not.toMatch(GLUED_PARTICLE);
    }
    const sentences = generatedSentences();
    // 4축 × 36셈 × (countLine + meaning + reading×3) 이상. 생성이 비면 「위반 0」이 공짜가 된다.
    expect(sentences.length).toBeGreaterThanOrEqual(4 * 36 * 5);
    expect(sentences.some((item) => item.label.endsWith("narrowCaution"))).toBe(true);
    expect(sentences.some((item) => item.label.endsWith("absence/part"))).toBe(true);
  });

  it("모든 셈·모든 글자에서 숫자나 영문 바로 뒤에 조사가 붙지 않는다", () => {
    const glued = generatedSentences().filter((item) => GLUED_PARTICLE.test(item.text));
    expect(glued.map((item) => `${item.label}: ${item.text}`)).toEqual([]);
  });

  it("셈 문장은 0장면·「대 0」을 말하지 않고, 양쪽을 쓸 때 왼쪽 글자를 먼저 쓴다", () => {
    for (const { key: axis } of WEDDING_CODE_V06_AXES) {
      const pair = WEDDING_CODE_LETTERS[axis];
      for (const left of COUNTS) {
        for (const right of COUNTS) {
          const line = buildWeddingCodeLetters(profileWith(axis, left, right)).slots.find((item) => item.axis === axis)!.countLine;
          const label = `${axis} ${left}:${right} ${line}`;
          expect(line, label).not.toMatch(/(?<!\d)0장면|대 0|\d+\s*%/);
          if (left > 0 && right > 0) {
            expect(line.indexOf(`${pair.left.letter}(`), label).toBeGreaterThan(-1);
            expect(line.indexOf(`${pair.left.letter}(`), label).toBeLessThan(line.indexOf(`${pair.right.letter}(`));
            if (left !== right) {
              expect(line, label).toContain(`${left}장면은 ${pair.left.letter}(${pair.left.short})`);
              expect(line, label).toContain(`${right}장면은 ${pair.right.letter}(${pair.right.short})`);
            }
          }
          if (left + right > 0) expect(line, label).toContain(`답한 ${left + right}장면`);
        }
      }
    }
  });

  it("하나 차이 안내는 대문자 두 글자를 정확히 쓴다", () => {
    for (const { key: axis } of WEDDING_CODE_V06_AXES) {
      const pair = WEDDING_CODE_LETTERS[axis];
      for (const [left, right] of [[3, 2], [2, 3], [2, 1], [1, 2]] as const) {
        const slot = buildWeddingCodeLetters(profileWith(axis, left, right)).slots.find((item) => item.axis === axis)!;
        const [own, other] = left > right ? [pair.left, pair.right] : [pair.right, pair.left];
        expect(slot.narrowCaution, `${axis} ${left}:${right}`).toContain(`${own.letter} 대신 ${other.letter} 글자가`);
      }
    }
  });

  it("코드만으로 푼 뜻에도 양쪽 짧은 이름이 들어 있다", () => {
    for (let mask = 0; mask < 16; mask += 1) {
      const code = WEDDING_CODE_V06_AXES.map(({ key }, index) =>
        (mask >> index) & 1 ? WEDDING_CODE_LETTERS[key].right.letter : WEDDING_CODE_LETTERS[key].left.letter,
      ).join("");
      for (const variant of [code, code.toLowerCase()]) {
        const parsed = parseWeddingCodeString(variant)!;
        for (const letter of parsed) {
          const pair = WEDDING_CODE_LETTERS[letter.axis];
          const own = pair[letter.side];
          const other = pair[letter.side === "left" ? "right" : "left"];
          expect(letter, `${variant} ${letter.axis}`).toMatchObject({
            letter: own.letter, short: own.short, opposite: other.letter, oppositeShort: other.short,
          });
        }
      }
    }
  });
});

describe("축 카드 팁 — 판정 언어 없이 바로 물어볼 수 있는 말", () => {
  const BANNED = /유형|궁합|점수|등급|성격|당신은|예측|잘 맞|%/;
  const entries = WEDDING_CODE_V06_AXES.flatMap(({ key }) =>
    (["left", "right", "mixed"] as const).map((lean) => ({ key, lean, copy: WEDDING_CODE_SELF_READING[key][lean] })),
  );

  it("열두 개 문구를 모두 본다", () => {
    expect(entries).toHaveLength(12);
    expect("우리 궁합 보자").toMatch(BANNED);
    expect("추가 금액이 20% 넘는지").toMatch(BANNED);
  });

  it.each(entries)("$key $lean — tellPartner·watchOut 에 판정 언어가 없다", ({ copy }) => {
    expect(copy.tellPartner).not.toMatch(BANNED);
    expect(copy.watchOut).not.toMatch(BANNED);
    expect(copy.title).not.toMatch(BANNED);
  });

  it.each(entries)("$key $lean — tellPartner 는 상대에게 묻는 말이다", ({ copy }) => {
    expect(copy.tellPartner).toContain("?");
    // 제목은 사람이 아니라 고른 답을 설명한다.
    expect(copy.title).toContain("답");
  });
});
