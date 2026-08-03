import { describe, expect, it } from "vitest";
import { allQuestions } from "@/app/customersurvey/data/questions";
import { validateSurveySubmission } from "@/lib/survey/submission";

function validAnswers(overrides: Record<string, unknown> = {}) {
  return {
    q1: 1,
    q2: 1,
    q3: 3,
    q4: 3,
    q5: 3,
    q6: 2,
    q7: [1],
    q8: 2,
    q9: 2,
    q10: 3,
    q11: 8,
    q13: ["A", "B", "C"],
    q14: [1, 2],
    q15: { q15_a: 9_900, q15_b: 19_900 },
    q16: 3,
    q17: [1, 2],
    q18: 1,
    q19: 2,
    q20: 8,
    q22: {
      q22_gender: "응답 안 함",
      q22_age: "30대",
      q22_budget: "500~700만원",
    },
    ...overrides,
  };
}

describe("customer survey server schema", () => {
  it("accepts a complete answer set and drops unknown legacy fields", () => {
    const result = validateSurveySubmission(
      validAnswers({ q23: "person@example.com" }),
      {},
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.answers.q23).toBeUndefined();
      expect(result.data.answers.q13).toEqual(["A", "B", "C"]);
    }
  });

  it.each([
    { q1: 4 },
    { q3: 99 },
    { q7: [1, 1] },
    { q13: ["A", "A", "B"] },
    { q13: ["A", "B"] },
    { q15: { q15_a: 20_000, q15_b: 10_000 } },
    { q15: { q15_a: 1, q15_b: 100_000_000 } },
    { q20: 11 },
    { q22: { q22_gender: "forged", q22_age: "30대", q22_budget: "500~700만원" } },
  ])("rejects out-of-domain or analytics-poisoning values: %o", (overrides) => {
    expect(validateSurveySubmission(validAnswers(overrides), {}).ok).toBe(false);
  });

  it("enforces conditional questions and ignores stale hidden children", () => {
    expect(validateSurveySubmission(validAnswers({ q8: 1 }), {}).ok).toBe(false);
    expect(validateSurveySubmission(validAnswers({ q8: 1, q8_1: 4 }), {}).ok).toBe(true);

    const hidden = validateSurveySubmission(validAnswers({ q11: 8, q11_1: 99, q12: [99] }), {});
    expect(hidden.ok).toBe(true);
    if (hidden.ok) {
      expect(hidden.data.answers.q11_1).toBeUndefined();
      expect(hidden.data.answers.q12).toBeUndefined();
    }
  });

  it("keeps the structured other option without opening a free-text lane", () => {
    expect(validateSurveySubmission(validAnswers({ q7: [7] }), {}).ok).toBe(true);
    expect(validateSurveySubmission(validAnswers({ q7: [7] }), {
      q7: "업체 비교 기준",
    })).toEqual({ ok: false, reason: "free_text_disabled" });
  });

  it.each([
    "가격 비교가 쉬우면 좋겠습니다.",
    "person@example.com",
    "010-1234-5678로 연락 주세요",
    "https://example.com/private 를 확인해 주세요",
    "홍길동 주민등록번호 900101-1234567, 서울 강남구",
    "계좌 110-123-456789 또는 @private_social",
  ])("rejects every retired anonymous free-text payload: %s", (q21) => {
    expect(validateSurveySubmission(validAnswers({ q21 }), {})).toEqual({
      ok: false,
      reason: "free_text_disabled",
    });
  });

  it("keeps all configured survey questions structured-only", () => {
    expect(allQuestions.some((question) =>
      question.type === "text_area"
      || question.type === "text_input"
      || question.options?.some((option) => option.hasTextInput)
    )).toBe(false);
  });

  it("rejects incomplete submissions", () => {
    expect(validateSurveySubmission({ q1: 1 }, {}).ok).toBe(false);
  });
});
