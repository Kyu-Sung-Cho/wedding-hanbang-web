import { describe, expect, it } from "vitest";
import {
  CourtVerdictValidationError,
  validateCourtVerdict,
} from "@/lib/coupleCourt/schema";
import { makeValidCourtVerdict } from "@/lib/coupleCourt/__tests__/fixtures";

const context = {
  mode: "couple" as const,
  category: "budget" as const,
  tone: "practical" as const,
  preflightSafetyLevel: "normal" as const,
};

describe("validateCourtVerdict", () => {
  it("accepts a strict, cross-field-consistent verdict", () => {
    const verdict = makeValidCourtVerdict();
    expect(validateCourtVerdict(verdict, context)).toBe(verdict);
  });

  it("rejects unknown model-controlled properties", () => {
    const verdict = makeValidCourtVerdict() as unknown as Record<string, unknown>;
    verdict.debug = "hidden reasoning";
    expect(() => validateCourtVerdict(verdict, context)).toThrow(CourtVerdictValidationError);
  });

  it("requires percentage responsibility to use five-point increments and sum to 100", () => {
    const wrongSum = makeValidCourtVerdict();
    wrongSum.responsibility!.shared = 35;
    expect(() => validateCourtVerdict(wrongSum, context)).toThrow(/sum_100/);

    const wrongIncrement = makeValidCourtVerdict();
    wrongIncrement.responsibility!.applicant = 24;
    wrongIncrement.responsibility!.respondent = 36;
    expect(() => validateCourtVerdict(wrongIncrement, context)).toThrow(/multiple_of_five/);
  });

  it("rejects percentage blame and inferred partner content in solo mode", () => {
    const solo = makeValidCourtVerdict({ mode: "solo" });
    solo.differentViews[0].respondent = "상대는 아마 무관심했을 것입니다.";
    expect(() => validateCourtVerdict(solo, {
      ...context,
      mode: "solo",
    })).toThrow(/solo_forbidden/);
  });

  it("requires the complete high-risk safety redirect invariant", () => {
    const unsafe = makeValidCourtVerdict();
    unsafe.safety = {
      level: "high_risk",
      riskTypes: ["violence"],
      disablePlayfulVerdict: true,
      publicEligible: false,
      supportMessage: "즉시 위험하면 안전한 곳에서 긴급기관에 연락하세요.",
    };
    unsafe.verdict.status = "safety_redirect";
    expect(() => validateCourtVerdict(unsafe, {
      ...context,
      preflightSafetyLevel: "high_risk",
    })).toThrow(/responsibility:forbidden_for_high_risk/);
  });

  it("does not allow the model to downgrade deterministic safety", () => {
    expect(() => validateCourtVerdict(makeValidCourtVerdict(), {
      ...context,
      preflightSafetyLevel: "sensitive",
    })).toThrow(/preflight_downgrade/);
  });

  it("rejects PII in a normal public card and unrealistic mission deadlines", () => {
    const pii = makeValidCourtVerdict();
    pii.publicCard!.oneLine = "010-1234-5678로 연락해 합의했어요.";
    expect(() => validateCourtVerdict(pii, context)).toThrow(/pii_detected/);

    const deadline = makeValidCourtVerdict();
    deadline.missions[0].dueInMinutes = 5;
    expect(() => validateCourtVerdict(deadline, context)).toThrow(CourtVerdictValidationError);
  });

  it("only emits missions supported by the verified task adapter", () => {
    const unsupported = makeValidCourtVerdict() as unknown as {
      missions: Array<{ relatedFeature: string }>;
    };
    unsupported.missions[0].relatedFeature = "budget";
    expect(() => validateCourtVerdict(unsupported, context)).toThrow(CourtVerdictValidationError);
  });
});
