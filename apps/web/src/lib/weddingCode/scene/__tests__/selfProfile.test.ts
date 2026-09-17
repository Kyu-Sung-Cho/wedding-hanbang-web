import { describe, expect, it } from "vitest";

import {
  WEDDING_CODE_V06_AXES,
  WEDDING_CODE_V06_QUESTIONS,
  type WeddingCodeV06OptionValue,
} from "@/constants/weddingCodeV06";
import { WEDDING_CODE_V08_QUESTIONS } from "@/constants/weddingCodeV08";
import { WEDDING_CODE_V09_QUESTIONS } from "@/constants/weddingCodeV09";
import { WEDDING_CODE_SELF_READING } from "@/constants/weddingCodeSelfReading";
import { WEDDING_CODE_LETTERS } from "@/lib/weddingCode/profile/letters";
import type { WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";
import {
  buildWeddingCodeSelfProfile,
  describeSelfAxisAbsence,
  describeSelfAxisReading,
  withJosa,
} from "../selfProfile";

const V07 = { questions: WEDDING_CODE_V08_QUESTIONS, axes: WEDDING_CODE_V06_AXES } as const;

function answerAll(value: WeddingCodeV06OptionValue): WeddingCodeV06Answers {
  return Object.fromEntries(
    WEDDING_CODE_V08_QUESTIONS.map((question) => [question.key, value]),
  );
}

/** 축 하나에서 각 편을 정확히 몇 번 고르게 만드는 응답. */
function answersForAxis(
  axisKey: string,
  values: readonly WeddingCodeV06OptionValue[],
): WeddingCodeV06Answers {
  const questions = WEDDING_CODE_V08_QUESTIONS.filter((question) => question.axis === axisKey);
  return Object.fromEntries(questions.map((question, index) => [question.key, values[index]]));
}

function reading(profile: ReturnType<typeof buildWeddingCodeSelfProfile>, axis: string) {
  return profile.axes.find((item) => item.axis === axis)!;
}

describe("웨딩코드 개인 결과", () => {
  it.each([
    { answers: { A1: "A", A2: "B" } as const, answered: 2 },
    { answers: { A1: "A", A2: "A", A3: "A", A4: "A" } as const, answered: 4 },
  ])("반반인 부분 응답도 실제 답한 $answered장면만 읽는다", ({ answers, answered }) => {
    const axis = reading(buildWeddingCodeSelfProfile(answers, V07), "decisionCriteria");
    expect(axis.lean).toBe("mixed");
    expect(describeSelfAxisReading(axis)).toContain(`답한 ${answered}장면`);
  });

  it.each([
    { answers: { A1: "A", A2: "A", A3: "C", A4: "A", A5: "C" } as const, minorityScene: "A4" },
    { answers: { A1: "C", A2: "B", A3: "A", A4: "B", A5: "A" } as const, minorityScene: "A4" },
  ])("3 대 2 응답에서 소수 쪽 원문도 결과 근거에 남긴다", ({ answers, minorityScene }) => {
    const axis = reading(buildWeddingCodeSelfProfile(answers, V07), "decisionCriteria");
    const minorityQuestion = WEDDING_CODE_V08_QUESTIONS.find((question) => question.key === minorityScene)!;
    const minorityOption = minorityQuestion.options.find((option) => option.value === answers.A4)!;
    expect(axis.evidence).toHaveLength(2);
    expect(axis.evidence.map((quote) => quote.label)).toContain(minorityOption.label);
  });

  it("상대에게 실행 도움을 준 답으로 내가 받을 도움을 단정하지 않는다", () => {
    const axis = reading(buildWeddingCodeSelfProfile({
      D1: "A", D2: "B", D3: "A", D4: "B", D5: "B",
    }, V07), "supportOrder");
    expect(axis.tellPartner).not.toContain("할 일을 하나 정하면 마음이 놓여");
    expect(axis.tellPartner).toContain("?");
    expect(axis.watchOut).toContain("확인");
  });

  it("일정이 밀린 답에서 함께 준비하면 안심된다는 마음을 만들지 않는다", () => {
    const axis = reading(buildWeddingCodeSelfProfile({ B5: "A" }, V07), "preparationMode");
    expect(axis.tellPartner).not.toMatch(/안심|편해|싶어/);
    expect(axis.tellPartner).toContain("?");
    expect(axis.title).toContain("답");
  });

  it("답하지 않은 문항을 고른 것처럼 세지 않는다", () => {
    const profile = buildWeddingCodeSelfProfile({}, V07);
    expect(profile.answered).toBe(0);
    expect(profile.complete).toBe(false);
    expect(profile.repeated).toEqual([]);
    for (const axis of profile.axes) {
      expect(axis.answered).toBe(0);
      expect(axis.evidence).toEqual([]);
      expect(describeSelfAxisReading(axis)).toContain("답한 장면이 없어요");
    }
  });

  it("집계는 실제로 고른 답의 수와 같다", () => {
    const profile = buildWeddingCodeSelfProfile(answerAll("A"), V07);
    expect(profile.answered).toBe(WEDDING_CODE_V08_QUESTIONS.length);
    expect(profile.complete).toBe(true);
    for (const axis of profile.axes) {
      expect(axis.leftCount + axis.rightCount).toBe(axis.answered);
      expect(axis.answered).toBe(5);
    }
  });

  it("인용은 사용자가 실제로 고른 선택지 문장이다", () => {
    const answers = answerAll("B");
    const profile = buildWeddingCodeSelfProfile(answers, V07);
    const chosen = new Set<string>(
      WEDDING_CODE_V08_QUESTIONS.map(
        (question) => question.options.find((option) => option.value === "B")!.label,
      ),
    );
    for (const axis of profile.axes) {
      for (const quote of axis.evidence) {
        expect(chosen.has(quote.label), quote.label).toBe(true);
      }
    }
  });

  it("한쪽으로 몰리면 그 쪽으로, 2:2면 균형으로 읽는다", () => {
    // 선택지 위치는 문항마다 다르다(LLRR·LRLR·RRLL·RLRL). 그래서 같은 편만 고르면
    // letter가 섞인다. 축당 문항이 홀수라 다 답하면 2:2 동점은 생길 수 없다.
    const lopsided = buildWeddingCodeSelfProfile(
      answersForAxis("decisionCriteria", ["A", "A", "C", "B", "A"]),
      V07,
    );
    const lopsidedAxis = reading(lopsided, "decisionCriteria");
    expect(lopsidedAxis.lean).toBe("left");
    expect(lopsidedAxis.leftCount).toBe(5);
    expect(lopsidedAxis.rightCount).toBe(0);
    expect(describeSelfAxisReading(lopsidedAxis)).toBe("답한 5장면 모두 V(조건 먼저) 쪽이었어요.");

    const balanced = buildWeddingCodeSelfProfile(
      answersForAxis("decisionCriteria", ["A", "A", "A", "A"]),
      V07,
    );
    const balancedAxis = reading(balanced, "decisionCriteria");
    expect(balancedAxis.leftCount).toBe(2);
    expect(balancedAxis.rightCount).toBe(2);
    expect(balancedAxis.lean).toBe("mixed");
    expect(balancedAxis.title).toBe(
      WEDDING_CODE_SELF_READING.decisionCriteria.mixed.title,
    );
  });

  it("균형일 때는 양쪽에서 하나씩 인용해 한쪽만 보여주지 않는다", () => {
    const profile = buildWeddingCodeSelfProfile(
      answersForAxis("decisionCriteria", ["A", "A", "A", "A"]),
      V07,
    );
    const axis = reading(profile, "decisionCriteria");
    expect(axis.evidence).toHaveLength(2);
    expect(axis.evidence[0].label).not.toBe(axis.evidence[1].label);
  });

  it("한 번도 고르지 않은 확인만 부재로 말한다", () => {
    const onlyLeft = buildWeddingCodeSelfProfile(
      answersForAxis("preparationMode", ["A", "B", "C", "A", "A"]),
      V07,
    );
    const axis = reading(onlyLeft, "preparationMode");
    expect(axis.lean).toBe("left");
    expect(axis.rightCount).toBe(0);
    expect(describeSelfAxisAbsence(axis)).toBe(
      "“맡아서 하기” 쪽 답은 한 번도 고르지 않았어요.",
    );

    // 균형이면 양쪽 다 골랐으므로 없는 것을 없다고 말하지 않는다.
    const balanced = reading(
      buildWeddingCodeSelfProfile(answersForAxis("preparationMode", ["A", "A", "A", "A"]), V07),
      "preparationMode",
    );
    expect(balanced.lean).toBe("mixed");
    expect(balanced.missingPhrases).toEqual([]);
    expect(describeSelfAxisAbsence(balanced)).toBeNull();
  });

  /**
   * 한 편에 주제가 둘인 축(decisionCriteria)은 덜 고른 쪽 답을 몇 개 골랐어도 그쪽 주제
   * 하나가 통째로 빠질 수 있다. 그때 「분위기 먼저 쪽 답을 한 번도 안 골랐다」고 하면 거짓이다.
   */
  it("덜 고른 쪽 답이 있는데 그쪽 주제 하나만 빠졌으면 그 주제만 말한다", () => {
    const axis = reading(
      buildWeddingCodeSelfProfile(
        { A1: "A", A2: "A", A3: "C", A4: "B", A5: "C" },
        { questions: WEDDING_CODE_V09_QUESTIONS, axes: WEDDING_CODE_V06_AXES },
      ),
      "decisionCriteria",
    );
    expect(axis).toMatchObject({ lean: "left", leftCount: 4, rightCount: 1 });
    expect(axis.missingPhrases).toEqual(["결혼식 날에 거는 기대나 받은 인상"]);
    expect(describeSelfAxisAbsence(axis)).toBe(
      "“분위기 먼저” 쪽 답을 고르긴 했지만, 그중 ‘결혼식 날에 거는 기대나 받은 인상’ 답은 없었어요.",
    );
    expect(describeSelfAxisReading(axis)).toBe(
      "답한 5장면 중 4장면은 V(조건 먼저), 1장면은 M(분위기 먼저) 쪽이었어요.",
    );
  });

  it("겪은 일과 한 일이 섞인 두 축에만 확인 안내를 붙이고, 답이 없으면 붙이지 않는다", () => {
    const profile = buildWeddingCodeSelfProfile(answerAll("A"), V07);
    const note = "이 주제의 답에는 겪은 일, 바랐던 일, 내가 한 일이 섞여 있어요. 숫자만 보지 말고 고른 답도 같이 봐 주세요.";
    const withNote = profile.axes.filter((axis) => describeSelfAxisReading(axis).endsWith(note));
    expect(withNote.map((axis) => axis.axis)).toEqual(["preparationMode", "supportOrder"]);
    for (const axis of buildWeddingCodeSelfProfile({}, V07).axes) {
      expect(describeSelfAxisReading(axis)).toBe("답한 장면이 없어요.");
    }
  });

  it("짧은 이름은 글자 정의와 같고, 한정 안내는 카드 문구와 따로 나간다", () => {
    const profile = buildWeddingCodeSelfProfile({ D1: "B", B5: "A" }, V07);
    for (const axis of profile.axes) {
      expect(axis.leftLabel).toBe(WEDDING_CODE_LETTERS[axis.axis].left.short);
      expect(axis.rightLabel).toBe(WEDDING_CODE_LETTERS[axis.axis].right.short);
    }
    const support = reading(profile, "supportOrder");
    expect(support.qualifiers).toEqual(["말을 멈춘 경험만으로 듣는 도움을 원했다고 단정하지 않아요."]);
    expect(support.watchOut).toBe(WEDDING_CODE_SELF_READING.supportOrder.left.watchOut);
  });

  it("가장 자주 고른 확인이 동률이면 하나만 고르지 않는다", () => {
    const profile = buildWeddingCodeSelfProfile(answerAll("A"), V07);
    const max = Math.max(...profile.repeated.map((item) => item.count));
    expect(profile.repeated.every((item) => item.count === max)).toBe(true);
    expect(profile.repeated.length).toBeGreaterThan(0);
    // 같은 응답을 다시 계산해도 순서가 같아야 한다.
    const again = buildWeddingCodeSelfProfile(answerAll("A"), V07);
    expect(again.repeated).toEqual(profile.repeated);
  });

  it("사용자에게 노출하지 않기로 한 구성개념은 결과에 등장하지 않는다", () => {
    // v0.6 A3의 B안에는 decisionPaceRisk가 부가 가중치로 실려 있다.
    const profile = buildWeddingCodeSelfProfile(
      Object.fromEntries(WEDDING_CODE_V06_QUESTIONS.map((question) => [question.key, "B"])),
      { questions: WEDDING_CODE_V06_QUESTIONS, axes: WEDDING_CODE_V06_AXES },
    );
    for (const item of profile.repeated) {
      expect(item.construct).not.toBe("decisionPaceRisk");
      expect(item.phrase).toBeTruthy();
    }
  });

  it("판정 언어를 만들지 않는다", () => {
    const profile = buildWeddingCodeSelfProfile(answerAll("A"), V07);
    const text = [
      ...profile.axes.map((axis) => `${axis.title} ${axis.tellPartner} ${axis.watchOut} ${axis.qualifiers.join(" ")}`),
      ...profile.axes.map(describeSelfAxisReading),
      ...profile.axes.map((axis) => describeSelfAxisAbsence(axis) ?? ""),
      ...profile.repeated.map((item) => item.phrase),
    ].join(" ");
    for (const banned of ["유형", "궁합", "점수", "등급", "성격", "당신은", "예측"]) {
      expect(text, banned).not.toContain(banned);
    }
  });

  it("받침에 맞는 조사를 고른다", () => {
    expect(withJosa("사정", "을", "를")).toBe("사정을");
    expect(withJosa("기준", "을", "를")).toBe("기준을");
    expect(withJosa("의미인지", "을", "를")).toBe("의미인지를");
    // 인용부호로 끝나도 안쪽 마지막 글자로 판단한다.
    expect(withJosa("“방법”", "을", "를")).toBe("“방법”을");
    expect(withJosa("“느낌인지”", "과", "와")).toBe("“느낌인지”와");
    expect(withJosa("“사정”", "과", "와")).toBe("“사정”과");
    // 한글이 아닌 끝은 받침 없는 쪽으로 둔다 — 틀리더라도 한 방향으로만 틀린다.
    expect(withJosa("A/B", "을", "를")).toBe("A/B를");
  });

  it("v0.6 문항으로도 같은 계약으로 동작한다", () => {
    const profile = buildWeddingCodeSelfProfile(
      Object.fromEntries(WEDDING_CODE_V06_QUESTIONS.map((question) => [question.key, "A"])),
      { questions: WEDDING_CODE_V06_QUESTIONS, axes: WEDDING_CODE_V06_AXES },
    );
    expect(profile.complete).toBe(true);
    expect(profile.axes).toHaveLength(WEDDING_CODE_V06_AXES.length);
  });
});
