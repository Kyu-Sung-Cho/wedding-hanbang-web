import { describe, expect, it } from "vitest";
import { validateWcSubmission } from "../validate";
import {
  WEDDING_CODE_V05_QUESTIONS,
  WEDDING_CODE_V05_SCORING_VERSION,
  WEDDING_CODE_V05_VERSION,
} from "@/constants/weddingCodeV05";

function validBody(overrides: Record<string, unknown> = {}) {
  const answers: Record<string, string> = {};
  for (const q of WEDDING_CODE_V05_QUESTIONS) {
    answers[q.key] = "A";
  }
  return {
    consent: true,
    submission_id: "323e4567-e89b-42d3-a456-426614174000",
    form_version: WEDDING_CODE_V05_VERSION,
    scoring_version: WEDDING_CODE_V05_SCORING_VERSION,
    participant_stage: "venue_search",
    answering_mode: "alone",
    quote_status: "none",
    parent_involvement: "low",
    biggest_concern: ["예산·비용"],
    answers,
    stage_flags: {},
    feedback: { feels_like_me: 4, clarity: 5 },
    cta_interest: { quote_check_interest: 3 },
    free_text: { free_text_feedback: "좋아요" },
    duration_ms: 180000,
    utm_source: "naver_kin",
    ...overrides,
  };
}

describe("웨딩코드 응답 검증", () => {
  it("정상 제출을 통과시키고 정규화한다", () => {
    const r = validateWcSubmission(validBody());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.data.answers)).toHaveLength(16);
      expect(r.data.submission_id).toBe("323e4567-e89b-42d3-a456-426614174000");
      expect(r.data.form_version).toBe(WEDDING_CODE_V05_VERSION);
      expect(r.data.scoring_version).toBe(WEDDING_CODE_V05_SCORING_VERSION);
      expect(r.data.utm.source).toBe("naver_kin");
      expect(r.data.feedback.feels_like_me).toBe(4);
    }
  });

  it("동의 없으면 거부", () => {
    const r = validateWcSubmission(validBody({ consent: false }));
    expect(r.ok).toBe(false);
  });

  it("v0.5 필수 문항 누락은 거부한다", () => {
    const missing = validBody();
    delete (missing.answers as Record<string, string>).A1;
    expect(validateWcSubmission(missing).ok).toBe(false);
  });

  it("지원하지 않는 폼·채점 버전은 거부한다", () => {
    expect(validateWcSubmission(validBody({ form_version: "v0.5-candidate.8" })).ok).toBe(false);
    expect(validateWcSubmission(validBody({ scoring_version: "v0.5-scoring.0" })).ok).toBe(false);
  });

  it("제출 식별자가 없거나 UUID가 아니면 거부한다", () => {
    expect(validateWcSubmission(validBody({ submission_id: undefined })).ok).toBe(false);
    expect(validateWcSubmission(validBody({ submission_id: true })).ok).toBe(false);
    expect(validateWcSubmission(validBody({ submission_id: "retry-me" })).ok).toBe(false);
  });

  it("enum 밖 값·범위 밖 척도 거부", () => {
    expect(validateWcSubmission(validBody({ participant_stage: "hacker" })).ok).toBe(false);
    const badScale = validBody({ feedback: { feels_like_me: 9 } });
    expect(validateWcSubmission(badScale).ok).toBe(false);
    const badOption = validBody();
    (badOption.answers as Record<string, string>).A2 = "E";
    expect(validateWcSubmission(badOption).ok).toBe(false);
  });

  it("숫자 척도와 소요 시간에 boolean·문자열을 숫자로 강제 변환하지 않는다", () => {
    expect(validateWcSubmission(validBody({ feedback: { feels_like_me: true } })).ok).toBe(false);
    expect(validateWcSubmission(validBody({ feedback: { feels_like_me: "4" } })).ok).toBe(false);

    expect(validateWcSubmission(validBody({ duration_ms: true })).ok).toBe(false);
    expect(validateWcSubmission(validBody({ duration_ms: "180000" })).ok).toBe(false);
  });

  it("couple_token: 유효 UUID는 통과, 형식 오류는 거부가 아니라 무시(null)", () => {
    const valid = validateWcSubmission(
      validBody({ couple_token: "123e4567-e89b-42d3-a456-426614174000" })
    );
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.data.couple_token).toBe("123e4567-e89b-42d3-a456-426614174000");

    const invalid = validateWcSubmission(validBody({ couple_token: "not-a-uuid" }));
    expect(invalid.ok).toBe(true); // 테스트 자체를 막지 않는다
    if (invalid.ok) expect(invalid.data.couple_token).toBeNull();

    const absent = validateWcSubmission(validBody());
    if (absent.ok) expect(absent.data.couple_token).toBeNull();
  });

  it("자유 텍스트는 정화·길이 제한된다", () => {
    const r = validateWcSubmission(
      validBody({ free_text: { free_text_feedback: "<script>x</script>" + "가".repeat(2000) } })
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.free_text.free_text_feedback).not.toContain("<script>");
      expect(r.data.free_text.free_text_feedback.length).toBeLessThanOrEqual(1000);
    }
  });
});
