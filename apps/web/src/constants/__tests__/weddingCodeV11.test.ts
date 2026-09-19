import { describe, expect, it } from "vitest";

import {
  WEDDING_CODE_V11_AXES,
  WEDDING_CODE_V11_NEXT_STEPS,
  WEDDING_CODE_V11_QUESTIONS,
  WEDDING_CODE_V11_VERSION,
} from "../weddingCodeV11";
import { WEDDING_CODE_V10_VERSION } from "../weddingCodeV10";
import { decodeWeddingCodeV06, encodeWeddingCodeV06 } from "@/lib/weddingCode/v06/code";

describe("웨딩코드 v1.1 문항과 공유 계약", () => {
  it("뜻이 바뀐 문항에는 새 판을 붙이고 공유 코드의 스무 자리 순서를 고정한다", () => {
    expect(WEDDING_CODE_V11_VERSION).toBe("v1.1-code");
    expect(WEDDING_CODE_V11_VERSION).not.toBe(WEDDING_CODE_V10_VERSION);
    const keys = WEDDING_CODE_V11_QUESTIONS.map(question => question.key);
    expect(keys).toHaveLength(20);
    expect(new Set(keys).size).toBe(20);
    // 문자열의 각 자리가 가리키는 질문이 바뀌면 이미 공유한 답도 바뀌므로 순서까지 검사한다.
    expect(keys).toEqual(["A", "B", "C", "D"].flatMap(prefix =>
      [1, 2, 3, 4, 5].map(index => `${prefix}${index}`)));
  });

  it("네 축마다 다섯 문항이고 문항마다 A·B·C·D 보기가 하나씩 있다", () => {
    const axisKeys = WEDDING_CODE_V11_AXES.map(axis => axis.key);
    expect(axisKeys).toEqual([
      "decisionCriteria", "preparationMode", "coordinationScope", "supportOrder",
    ]);
    for (const axis of WEDDING_CODE_V11_AXES) {
      expect(WEDDING_CODE_V11_QUESTIONS.filter(question => question.axis === axis.key), axis.key)
        .toHaveLength(5);
    }
    for (const question of WEDDING_CODE_V11_QUESTIONS) {
      expect(axisKeys, question.key).toContain(question.axis);
      expect(question.options.map(option => option.value), question.key).toEqual(["A", "B", "C", "D"]);
      expect(new Set(question.options.map(option => option.label.trim())).size, question.key).toBe(4);
    }
  });

  it("각 보기는 자기 축의 한쪽에만 같은 무게로 실리고 좌우 두 보기씩이다", () => {
    for (const question of WEDDING_CODE_V11_QUESTIONS) {
      const axis = WEDDING_CODE_V11_AXES.find(item => item.key === question.axis)!;
      const left = new Set<string>(axis.left.constructs);
      const right = new Set<string>(axis.right.constructs);
      const sides: string[] = [];
      for (const option of question.options) {
        const label = `${question.key}-${option.value}`;
        expect(option.weights, label).toHaveLength(1);
        const weight = option.weights[0];
        expect(weight.value, label).toBe(2);
        const belongsLeft = left.has(weight.construct);
        const belongsRight = right.has(weight.construct);
        expect(Number(belongsLeft) + Number(belongsRight), label).toBe(1);
        sides.push(belongsLeft ? "left" : "right");
      }
      expect(sides.filter(side => side === "left"), question.key).toHaveLength(2);
      expect(sides.filter(side => side === "right"), question.key).toHaveLength(2);
    }
  });

  it("모든 문항에 해당 장면의 다음 대화 문구가 있고 없는 문항의 문구는 없다", () => {
    expect(Object.keys(WEDDING_CODE_V11_NEXT_STEPS).sort())
      .toEqual(WEDDING_CODE_V11_QUESTIONS.map(question => question.key).sort());
    for (const question of WEDDING_CODE_V11_QUESTIONS) {
      const nextStep = WEDDING_CODE_V11_NEXT_STEPS[question.key];
      expect(typeof nextStep, question.key).toBe("string");
      expect(nextStep.trim().length, question.key).toBeGreaterThan(0);
    }
  });

  it("화면에 쓰는 한글 문구가 비어 있거나 알려진 문자 손상으로 저장되지 않는다", () => {
    const texts = [
      ...WEDDING_CODE_V11_AXES.flatMap(axis => [axis.labelKo, axis.left.labelKo, axis.right.labelKo]),
      ...WEDDING_CODE_V11_QUESTIONS.flatMap(question => [
        question.scene, question.question, ...question.options.map(option => option.label),
      ]),
      ...Object.values(WEDDING_CODE_V11_NEXT_STEPS),
    ];
    for (const text of texts) {
      expect(text, text).toMatch(/[가-힣]/u);
      expect(text, text).toBe(text.normalize("NFC"));
      // 인코딩 대체 문자·비문자와 과거 문항에 섞였던 잘못된 글자를 막는다.
      for (const damaged of ["\uFFFD", "\uFFFE", "\uFFFF", "쭀"]) {
        expect(text, text).not.toContain(damaged);
      }
    }
  });

  it("축 경계의 부분 응답과 건너뛴 자리를 공유 코드에서 그대로 복원한다", () => {
    const answers = { A1: "A", A5: "B", B1: "C", B5: "D", C1: "B", C5: "A", D1: "D", D5: "C" } as const;
    const expected = ["A---B", "C---D", "B---A", "D---C"].join("");
    expect(encodeWeddingCodeV06(answers, WEDDING_CODE_V11_QUESTIONS)).toBe(expected);
    expect(decodeWeddingCodeV06(expected, WEDDING_CODE_V11_QUESTIONS)).toEqual(answers);
  });

  it.each([
    "A".repeat(16), "A".repeat(19), "A".repeat(21), "-".repeat(20), `Z${"A".repeat(19)}`,
  ])("길이·답 기호가 틀리거나 모두 비어 있는 코드를 현재 판의 답으로 채우지 않는다 (%#)", code => {
    expect(decodeWeddingCodeV06(code, WEDDING_CODE_V11_QUESTIONS)).toBeNull();
  });
});
