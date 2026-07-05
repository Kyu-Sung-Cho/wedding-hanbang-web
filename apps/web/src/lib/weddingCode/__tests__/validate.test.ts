import { describe, expect, it } from "vitest";
import { validateWcSubmission } from "../validate";
import { WC_QUESTIONS, gateQuestion } from "@/constants/weddingCodeForm";

function validBody(overrides: Record<string, unknown> = {}) {
  const answers: Record<string, string> = {};
  const stage_flags: Record<string, string> = {};
  for (const q of WC_QUESTIONS) {
    answers[q.key] = "A";
    if (q.gateFlag) stage_flags[q.key] = "hypothetical";
  }
  return {
    consent: true,
    participant_stage: "venue_search",
    answering_mode: "alone",
    quote_status: "none",
    parent_involvement: "low",
    biggest_concern: ["예산·견적"],
    answers,
    stage_flags,
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
      expect(r.data.utm.source).toBe("naver_kin");
      expect(r.data.feedback.feels_like_me).toBe(4);
    }
  });

  it("동의 없으면 거부", () => {
    const r = validateWcSubmission(validBody({ consent: false }));
    expect(r.ok).toBe(false);
  });

  it("필수 문항 누락 거부, 비게이팅 선택 문항(q14) 미응답은 허용", () => {
    const missing = validBody();
    delete (missing.answers as Record<string, string>).q01;
    expect(validateWcSubmission(missing).ok).toBe(false);

    const optional = validBody();
    delete (optional.answers as Record<string, string>).q14;
    expect(validateWcSubmission(optional).ok).toBe(true);
  });

  it("게이팅 문항은 skipped면 무응답 허용, 답이 있으면 모순으로 거부", () => {
    const body = validBody();
    (body.stage_flags as Record<string, string>).q16 = "skipped";
    delete (body.answers as Record<string, string>).q16;
    expect(validateWcSubmission(body).ok).toBe(true);

    const contradict = validBody();
    (contradict.stage_flags as Record<string, string>).q16 = "skipped"; // 답변은 남긴 채
    expect(validateWcSubmission(contradict).ok).toBe(false);
  });

  it("enum 밖 값·범위 밖 척도 거부", () => {
    expect(validateWcSubmission(validBody({ participant_stage: "hacker" })).ok).toBe(false);
    const badScale = validBody({ feedback: { feels_like_me: 9 } });
    expect(validateWcSubmission(badScale).ok).toBe(false);
    const badOption = validBody();
    (badOption.answers as Record<string, string>).q02 = "E";
    expect(validateWcSubmission(badOption).ok).toBe(false);
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

describe("단계 게이팅 (15번 §6 Option B)", () => {
  it("본식 주간이면 q10 직접 노출, 초기 단계면 가정 섹션", () => {
    const q10 = WC_QUESTIONS.find((q) => q.key === "q10")!;
    expect(gateQuestion(q10, { stage: "wedding_week", quoteStatus: "none", parentInvolvement: "low" })).toBe("direct");
    expect(gateQuestion(q10, { stage: "dating_or_meeting", quoteStatus: "none", parentInvolvement: "low" })).toBe("hypothetical");
  });

  it("견적 경험 있으면 q12 직접 노출", () => {
    const q12 = WC_QUESTIONS.find((q) => q.key === "q12")!;
    expect(gateQuestion(q12, { stage: "sdm_search", quoteStatus: "received", parentInvolvement: "low" })).toBe("direct");
    expect(gateQuestion(q12, { stage: "sdm_search", quoteStatus: "none", parentInvolvement: "low" })).toBe("hypothetical");
  });

  it("게이팅 없는 문항은 항상 direct", () => {
    const q01 = WC_QUESTIONS.find((q) => q.key === "q01")!;
    expect(gateQuestion(q01, { stage: "dating_or_meeting", quoteStatus: "none", parentInvolvement: "low" })).toBe("direct");
  });
});
