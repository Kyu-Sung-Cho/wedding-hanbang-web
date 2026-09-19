import { describe, expect, it } from "vitest";

import type { WeddingCodeV06Question } from "../weddingCodeV06";
import {
  WEDDING_CODE_V11_QUESTIONS,
  WEDDING_CODE_V11_VERSION,
} from "../weddingCodeV11";
import {
  WEDDING_CODE_V12_AXES,
  WEDDING_CODE_V12_NEXT_STEPS,
  WEDDING_CODE_V12_QUESTIONS,
  WEDDING_CODE_V12_VERSION,
} from "../weddingCodeV12";
import {
  resolveWeddingCodeSceneConfig,
  WEDDING_CODE_V12_SCENE_CONFIG,
} from "@/lib/weddingCode/scene/config";
import { buildWeddingCodeResultProfile } from "@/lib/weddingCode/scene/resultProfile";
import {
  buildWeddingCodeShareUrl,
  decodeWeddingCodeShareHash,
} from "@/lib/weddingCode/scene/link";
import {
  decodeWeddingCodeV06,
  encodeWeddingCodeV06,
  isCompleteWeddingCodeV06,
} from "@/lib/weddingCode/v06/code";
import {
  buildWeddingCodeV06GapMap,
  type WeddingCodeV06Answers,
} from "@/lib/weddingCode/v06/gap";

const QUESTIONS: readonly WeddingCodeV06Question[] = WEDDING_CODE_V12_QUESTIONS;
const OPTION_VALUES = ["A", "B", "C", "D"] as const;
const AXIS_KEYS = [
  "decisionCriteria", "preparationMode", "coordinationScope", "supportOrder",
] as const;
const PUBLIC_CONSTRUCTS = new Set([
  "costRisk", "evidenceDecision", "experienceMeaning", "aestheticMood",
  "coPreparation", "roleOwnership", "coupleAutonomy", "familyIntegration",
  "emotionalSupport", "executionSupport",
]);
const VALID_OPTIONS = QUESTIONS.flatMap((question, index) =>
  question.options.map(option => ({ key: question.key, index, value: option.value })));
const ABSENT_OPTIONS = QUESTIONS.flatMap((question, index) =>
  OPTION_VALUES
    .filter(value => !question.options.some(option => option.value === value))
    .map(value => ({ key: question.key, index, value })));

function answersOn(side: "left" | "right"): WeddingCodeV06Answers {
  const answers: WeddingCodeV06Answers = {};
  for (const question of QUESTIONS) {
    const axis = WEDDING_CODE_V12_AXES.find(item => item.key === question.axis);
    if (!axis) throw new Error(`Missing axis: ${question.key}`);
    const constructs = new Set<string>(axis[side].constructs);
    const option = question.options.find(item =>
      item.weights.some(weight => constructs.has(weight.construct)));
    if (!option) throw new Error(`Missing ${side} option: ${question.key}`);
    answers[question.key] = option.value;
  }
  return answers;
}

function replaceCharacter(code: string, index: number, value: string): string {
  return code.slice(0, index) + value + code.slice(index + 1);
}

function shareUrl(first: WeddingCodeV06Answers, second?: WeddingCodeV06Answers): URL {
  return new URL(buildWeddingCodeShareUrl({
    origin: "https://hanbang.ai",
    version: WEDDING_CODE_V12_VERSION,
    firstCode: encodeWeddingCodeV06(first, QUESTIONS),
    secondCode: second ? encodeWeddingCodeV06(second, QUESTIONS) : undefined,
  }));
}

describe("웨딩코드 v1.2 가변 보기와 판별 계약", () => {
  it("새 판의 스무 자리와 축별 다섯 문항을 고정한다", () => {
    expect(WEDDING_CODE_V12_VERSION).toBe("v1.2-code");
    expect(WEDDING_CODE_V12_VERSION).not.toBe(WEDDING_CODE_V11_VERSION);
    const expectedKeys = ["A", "B", "C", "D"].flatMap(prefix =>
      [1, 2, 3, 4, 5].map(index => `${prefix}${index}`));
    expect(QUESTIONS.map(question => question.key)).toEqual(expectedKeys);
    expect(new Set(QUESTIONS.map(question => question.key)).size).toBe(20);
    expect(WEDDING_CODE_V12_AXES.map(axis => axis.key)).toEqual(AXIS_KEYS);
    for (const [index, axis] of AXIS_KEYS.entries()) {
      expect(QUESTIONS.filter(question => question.axis === axis), axis).toHaveLength(5);
      expect(QUESTIONS.slice(index * 5, (index + 1) * 5).map(question => question.axis))
        .toEqual(Array(5).fill(axis));
    }
  });

  it("각 문항은 실제로 존재하는 고유한 보기 2~4개를 가진다", () => {
    for (const question of QUESTIONS) {
      expect(question.options.length, question.key).toBeGreaterThanOrEqual(2);
      expect(question.options.length, question.key).toBeLessThanOrEqual(4);
      const values = question.options.map(option => option.value);
      expect(new Set(values).size, question.key).toBe(values.length);
      const labels = question.options.map(option =>
        option.label.normalize("NFC").replace(/\s+/gu, " ").trim());
      expect(new Set(labels).size, question.key).toBe(labels.length);
      for (const option of question.options) {
        expect(OPTION_VALUES, `${question.key}-${option.value}`).toContain(option.value);
        expect(option.label.trim(), `${question.key}-${option.value}`).not.toBe("");
      }
    }
  });

  it("각 선택은 자기 축의 공개 구성개념 하나에 2로 실리고 양쪽 답을 고를 수 있다", () => {
    for (const question of QUESTIONS) {
      const axis = WEDDING_CODE_V12_AXES.find(item => item.key === question.axis);
      if (!axis) throw new Error(`Missing axis: ${question.key}`);
      const left = new Set<string>(axis.left.constructs);
      const right = new Set<string>(axis.right.constructs);
      const sides = new Set<string>();
      for (const option of question.options) {
        const label = `${question.key}-${option.value}`;
        expect(option.weights, label).toHaveLength(1);
        const weight = option.weights[0];
        expect(PUBLIC_CONSTRUCTS.has(weight.construct), label).toBe(true);
        expect(weight.value, label).toBe(2);
        const belongsLeft = left.has(weight.construct);
        const belongsRight = right.has(weight.construct);
        expect(Number(belongsLeft) + Number(belongsRight), label).toBe(1);
        sides.add(belongsLeft ? "left" : "right");
      }
      // 보기 수를 2:2로 맞추지 않는다. 각 방향을 실제로 선택할 수 있는지만 확인한다.
      expect([...sides].sort(), question.key).toEqual(["left", "right"]);
    }
  });

  it("예산·서비스·사진·경험의 구체적인 다섯 답을 정해진 방향과 서로 다른 설명으로 읽는다", () => {
    // 기대 방향을 현재 weights에서 만들면 잘못 옮긴 가중치까지 정답으로 따라가므로,
    // 검토한 실제 응답 시나리오와 기대 방향을 별도로 고정한다.
    const scenarios = [
      {
        name: "예산",
        answers: { A1: "A", A2: "A", A3: "D", A4: "D", A5: "A" },
        counts: [5, 0],
        reflectionTopic: /예산/u,
      },
      {
        name: "서비스",
        answers: { A1: "B", A2: "C", A3: "C", A4: "B", A5: "B" },
        counts: [5, 0],
        reflectionTopic: /서비스/u,
      },
      {
        name: "사진과 분위기",
        answers: { A1: "C", A2: "D", A3: "B", A4: "A", A5: "C" },
        counts: [0, 5],
        reflectionTopic: /사진|영상|공간/u,
      },
      {
        name: "경험과 기억",
        answers: { A1: "D", A2: "B", A3: "A", A4: "C", A5: "D" },
        counts: [0, 5],
        reflectionTopic: /경험|기억/u,
      },
    ] as const;
    const reflections: string[] = [];
    for (const scenario of scenarios) {
      const result = buildWeddingCodeResultProfile(scenario.answers, WEDDING_CODE_V12_SCENE_CONFIG);
      const reading = result.axes.find(axis => axis.axis === "decisionCriteria");
      if (!reading) throw new Error(`Missing decisionCriteria: ${scenario.name}`);
      expect(result.answered, scenario.name).toBe(5);
      expect([reading.leftCount, reading.rightCount], scenario.name).toEqual(scenario.counts);
      expect(reading.answered, scenario.name).toBe(5);
      expect(reading.allEvidence, scenario.name).toHaveLength(5);
      expect(reading.reflection, scenario.name).toMatch(scenario.reflectionTopic);
      if (reading.reflection) reflections.push(reading.reflection);
    }
    expect(reflections).toHaveLength(4);
    expect(new Set(reflections).size).toBe(4);
  });

  it("모든 문항에 질문과 후속 안내가 있고 다른 문항의 안내는 끼어들지 않는다", () => {
    expect(Object.keys(WEDDING_CODE_V12_NEXT_STEPS).sort())
      .toEqual(QUESTIONS.map(question => question.key).sort());
    for (const question of QUESTIONS) {
      expect(question.scene.trim(), question.key).not.toBe("");
      expect(question.question.trim(), question.key).not.toBe("");
      expect(WEDDING_CODE_V12_NEXT_STEPS[question.key].trim(), question.key).not.toBe("");
    }
  });

  it("새 진입과 명시된 v1.2 링크만 v1.2 원문으로 연결한다", () => {
    expect(resolveWeddingCodeSceneConfig(undefined, false)?.questions)
      .toBe(WEDDING_CODE_V12_QUESTIONS);
    expect(resolveWeddingCodeSceneConfig(WEDDING_CODE_V12_VERSION, true)?.questions)
      .toBe(WEDDING_CODE_V12_QUESTIONS);
    expect(resolveWeddingCodeSceneConfig(WEDDING_CODE_V11_VERSION, true)?.questions)
      .toBe(WEDDING_CODE_V11_QUESTIONS);
  });

  it.each(VALID_OPTIONS)("$key-$value를 단독·전체 응답에서 같은 위치로 왕복한다", ({ key, index, value }) => {
    const partial: WeddingCodeV06Answers = { [key]: value };
    const expectedCode = replaceCharacter("-".repeat(20), index, value);
    expect(encodeWeddingCodeV06(partial, QUESTIONS)).toBe(expectedCode);
    expect(decodeWeddingCodeV06(expectedCode, QUESTIONS)).toEqual(partial);
    expect(isCompleteWeddingCodeV06(partial, QUESTIONS)).toBe(false);

    const full = answersOn("left");
    full[key] = value;
    const encoded = encodeWeddingCodeV06(full, QUESTIONS);
    expect(encoded).toHaveLength(20);
    expect(encoded[index]).toBe(value);
    expect(decodeWeddingCodeV06(encoded, QUESTIONS)).toEqual(full);
    expect(isCompleteWeddingCodeV06(full, QUESTIONS)).toBe(true);
  });

  it.each(ABSENT_OPTIONS)("$key에 없는 $value는 전체 답·커플 링크에서 거부한다", ({ key, index, value }) => {
    const valid = answersOn("left");
    const validCode = encodeWeddingCodeV06(valid, QUESTIONS);
    const invalidCode = replaceCharacter(validCode, index, value);
    const invalidAnswers = { ...valid, [key]: value };
    expect(decodeWeddingCodeV06(invalidCode, QUESTIONS)).toBeNull();
    expect(isCompleteWeddingCodeV06(invalidAnswers, QUESTIONS)).toBe(false);
    expect(decodeWeddingCodeShareHash(
      `#v=${WEDDING_CODE_V12_VERSION}&a=${invalidCode}&b=${validCode}`,
    )).toBeNull();
    expect(decodeWeddingCodeShareHash(
      `#v=${WEDDING_CODE_V12_VERSION}&a=${validCode}&b=${invalidCode}`,
    )).toBeNull();
  });

  it.each(QUESTIONS)("$key의 모르는 답 기호는 완료한 응답으로 세지 않는다", question => {
    const valid = answersOn("left");
    const index = QUESTIONS.findIndex(item => item.key === question.key);
    const invalidCode = replaceCharacter(encodeWeddingCodeV06(valid, QUESTIONS), index, "Z");
    expect(decodeWeddingCodeV06(invalidCode, QUESTIONS)).toBeNull();
    // URL 외의 런타임 입력도 검사하므로 타입 밖의 값을 명시적으로 주입한다.
    Reflect.set(valid, question.key, "Z");
    expect(isCompleteWeddingCodeV06(valid, QUESTIONS)).toBe(false);
  });

  it.each(QUESTIONS)("$key를 건너뛰어도 나머지 열아홉 자리와 답은 이동하지 않는다", question => {
    const partial = answersOn("right");
    delete partial[question.key];
    const index = QUESTIONS.findIndex(item => item.key === question.key);
    const code = encodeWeddingCodeV06(partial, QUESTIONS);
    expect(code).toHaveLength(20);
    expect(code[index]).toBe("-");
    expect(decodeWeddingCodeV06(code, QUESTIONS)).toEqual(partial);
    expect(isCompleteWeddingCodeV06(partial, QUESTIONS)).toBe(false);
    expect(decodeWeddingCodeShareHash(shareUrl(partial).hash)?.partnerAnswers)
      .toEqual(partial);
  });

  it("모두 건너뛰거나 스무 자리가 아닌 코드를 유효한 답으로 채우지 않는다", () => {
    const fullCode = encodeWeddingCodeV06(answersOn("left"), QUESTIONS);
    for (const code of ["", "-".repeat(20), fullCode.slice(0, 16), fullCode.slice(0, 19), `${fullCode}A`]) {
      expect(decodeWeddingCodeV06(code, QUESTIONS), code).toBeNull();
      expect(decodeWeddingCodeShareHash(`#v=${WEDDING_CODE_V12_VERSION}&a=${code}`), code).toBeNull();
    }
    expect(isCompleteWeddingCodeV06({}, QUESTIONS)).toBe(false);
  });

  it.each(["C", "D"] as const)("옛 v1.1의 모든 %s 답은 v1.1 문항으로 계속 복원한다", value => {
    const expected: WeddingCodeV06Answers = {};
    for (const question of WEDDING_CODE_V11_QUESTIONS) expected[question.key] = value;
    const code = value.repeat(20);
    expect(encodeWeddingCodeV06(expected, WEDDING_CODE_V11_QUESTIONS)).toBe(code);
    expect(decodeWeddingCodeV06(code, WEDDING_CODE_V11_QUESTIONS)).toEqual(expected);
    expect(isCompleteWeddingCodeV06(expected, WEDDING_CODE_V11_QUESTIONS)).toBe(true);
    const decoded = decodeWeddingCodeShareHash(`#v=${WEDDING_CODE_V11_VERSION}&a=${code}`);
    expect(decoded?.version).toBe(WEDDING_CODE_V11_VERSION);
    expect(decoded?.partnerAnswers).toEqual(expected);
    expect(resolveWeddingCodeSceneConfig(decoded?.version, true)?.questions)
      .toBe(WEDDING_CODE_V11_QUESTIONS);
    // 새 판에는 없는 C/D를 옛 판으로 자동 우회하거나 새 보기로 바꾸지 않는다.
    expect(decodeWeddingCodeV06(code, QUESTIONS)).toBeNull();
  });

  it("양극에서 고른 스무 답을 커플 링크에 싣고 실제 선택 문장으로 비교한다", () => {
    const first = answersOn("left");
    const second = answersOn("right");
    const url = shareUrl(first, second);
    expect(url.search).toBe("");
    const decoded = decodeWeddingCodeShareHash(url.hash);
    expect(decoded?.version).toBe(WEDDING_CODE_V12_VERSION);
    expect(decoded?.bothCodes).toEqual({ first, second });
    const map = buildWeddingCodeV06GapMap(first, second, {
      questions: QUESTIONS,
      axes: WEDDING_CODE_V12_AXES,
    });
    expect(map.splits).toHaveLength(20);
    expect(map.shared).toHaveLength(0);
    expect(map.identical).toHaveLength(0);
    expect(map.missing).toBe(0);
    for (const gap of map.splits) {
      const question = QUESTIONS.find(item => item.key === gap.key)!;
      expect(gap.firstLabel).toBe(question.options.find(option => option.value === first[gap.key])?.label);
      expect(gap.secondLabel).toBe(question.options.find(option => option.value === second[gap.key])?.label);
      expect(gap.sameSide).toBe(false);
    }
  });

  it("같은 답·같은 쪽 다른 답·반대 답·서로 다른 건너뛰기를 섞어도 구별한다", () => {
    const first = answersOn("left");
    const second = answersOn("right");
    second.A1 = first.A1;
    first.B2 = "B";
    second.B2 = "C";
    delete first.C5;
    delete second.D5;
    const decoded = decodeWeddingCodeShareHash(shareUrl(first, second).hash);
    expect(decoded?.bothCodes).toEqual({ first, second });
    const map = buildWeddingCodeV06GapMap(first, second, {
      questions: QUESTIONS,
      axes: WEDDING_CODE_V12_AXES,
    });
    expect(map.identical.map(gap => gap.key)).toEqual(["A1"]);
    expect(map.shared.map(gap => gap.key)).toEqual(["B2"]);
    expect(map.shared[0]).toMatchObject({ same: false, sameSide: true });
    expect(map.splits).toHaveLength(16);
    expect(map.missing).toBe(2);
    const comparedKeys = [...map.identical, ...map.shared, ...map.splits].map(gap => gap.key);
    expect(comparedKeys).not.toContain("C5");
    expect(comparedKeys).not.toContain("D5");
  });
});
