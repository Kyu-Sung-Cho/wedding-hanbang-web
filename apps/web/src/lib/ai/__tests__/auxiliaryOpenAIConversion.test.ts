import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateAmoraProfileUpdate } from "@/lib/ai/amora-profile";
import { validateExcavationClassification } from "@/lib/ai/classify-excavation";
import { validateConflictVerification } from "@/lib/ai/conflict-detector";
import { validateExtractionResponse } from "@/lib/ai/extract-decision";

const scopedRuntimeFiles = [
  "src/lib/ai/summarize.ts",
  "src/lib/ai/extract-decision.ts",
  "src/lib/ai/classify-excavation.ts",
  "src/lib/ai/amora-profile.ts",
  "src/lib/ai/conflict-detector.ts",
  "src/app/api/chat/check-couple-conflict/route.ts",
  "src/app/api/community/ai-comment/route.ts",
];
const webRoot = existsSync(resolve(process.cwd(), "src/lib/ai/summarize.ts"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

describe("auxiliary OpenAI runtime migration", () => {
  it("has no Anthropic runtime dependency or Claude model string in scope", () => {
    for (const path of scopedRuntimeFiles) {
      const source = readFileSync(resolve(webRoot, path), "utf8");
      expect(source).not.toMatch(/auditedAnthropic|createAnthropic|claude-|ANTHROPIC_API_KEY/);
      expect(source).toMatch(/createOpenAI(?:Structured)?ResponseWithAudit/);
    }
  });

  it("strictly validates bounded decision extractions", () => {
    expect(
      validateExtractionResponse({
        extractions: [
          {
            type: "decision",
            category: "budget",
            title: "예산 확정",
            value: "1,500만원",
            reasoning: null,
            confidence: 0.9,
          },
        ],
      }).extractions
    ).toHaveLength(1);
    expect(() =>
      validateExtractionResponse({
        extractions: [
          {
            type: "preference",
            category: "budget",
            title: "잘못된 선호",
            value: "가성비",
            reasoning: null,
            confidence: 0.9,
          },
        ],
      })
    ).toThrow("invalid preference category");
  });

  it("applies the confidence gate to excavation classifications", () => {
    expect(
      validateExcavationClassification({
        technique: "constraint_first",
        confidence: 0.59,
        evidence: "피하고 싶은 스타일",
      })
    ).toEqual({
      technique: null,
      confidence: 0.59,
      evidence: "피하고 싶은 스타일",
    });
    expect(() =>
      validateExcavationClassification({
        technique: "unknown",
        confidence: 0.9,
        evidence: null,
      })
    ).toThrow("invalid excavation technique");
  });

  it("rejects malformed conflict and profile structured outputs", () => {
    expect(validateConflictVerification({ conflict: true, reason: "서로 비난이 이어짐" })).toEqual({
      conflict: true,
      reason: "서로 비난이 이어짐",
    });
    expect(() => validateConflictVerification({ conflict: "yes", reason: "갈등" })).toThrow(
      "invalid conflict flag"
    );

    const profile = validateAmoraProfileUpdate({
      should_update: true,
      profile: {
        persona_summary: "가성비와 편안함을 중시",
        budget_posture: "추가금 상한을 먼저 확인",
        decision_style: "둘이 비교 후 합의",
        taste_profile: "과한 장식은 피함",
        communication_style: "짧고 구체적인 안내",
        conflict_pattern: null,
        sensitive_topics: [],
        recommendation_rules: ["총액과 추가금을 함께 제시"],
        open_questions: [],
        confidence_score: 0.8,
        evidence: [
          {
            insight: "추가금이 걱정된다고 밝힘",
            source: "recent_chat",
            confidence: 0.8,
            at: null,
          },
        ],
      },
    });
    expect(profile.shouldUpdate).toBe(true);
    expect(() =>
      validateAmoraProfileUpdate({
        should_update: false,
        profile: { confidence_score: 0.5 },
      })
    ).toThrow("profile must be null");
  });
});
