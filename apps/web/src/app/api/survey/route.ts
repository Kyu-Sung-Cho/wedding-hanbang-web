import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTurnstile } from "@/lib/turnstile";
import { getTurnstileRequestHostname } from "@/lib/turnstileRequestHostname";
import { checkRateLimitPersistent, getClientIp, rateLimitKey } from "@/utils/rateLimit";
import {
  cleanIntegerInRange,
  cleanOptionalText,
  isBodyTooLarge,
  isRecord,
  readBoundedJsonValue,
} from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { CURRENT_CUSTOMER_SURVEY_CONSENT_VERSION } from "@/lib/survey/consent";
import { validateSurveySubmission } from "@/lib/survey/submission";

const MAX_BODY_BYTES = 32 * 1024;

function getServiceClient() {
  return createAdminClient();
}

function scalar(value: unknown, maxLength = 500): string | number | boolean | null {
  if (typeof value === "string") return cleanOptionalText(value, maxLength);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return null;
}

function stringArray(value: unknown, maxItems = 20): string[] | null {
  if (!Array.isArray(value)) return null;
  const cleaned = value
    .slice(0, maxItems)
    .map((item) => cleanOptionalText(item, 120))
    .filter((item): item is string => Boolean(item));
  return cleaned.length > 0 ? cleaned : null;
}

export async function POST(request: NextRequest) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const limited = await checkRateLimitPersistent(rateLimitKey("survey", request), {
      maxRequests: 5,
      windowMs: 60 * 60 * 1000,
    });
    if (limited) return limited;

    const bodyResult = await readBoundedJsonValue(request, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: bodyResult.reason === "too_large" ? "요청 데이터가 너무 큽니다." : "잘못된 요청입니다." },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }
    const body = bodyResult.value;
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    if (
      body.consent !== true
      || body.consentVersion !== CURRENT_CUSTOMER_SURVEY_CONSENT_VERSION
    ) {
      return NextResponse.json(
        { error: "설문 응답 처리 동의가 필요합니다." },
        { status: 400 },
      );
    }

    const turnstile = await verifyTurnstile(
      typeof body.turnstileToken === "string" ? body.turnstileToken : null,
      getClientIp(request),
      "survey",
      getTurnstileRequestHostname(request),
    );
    if (!turnstile.ok) {
      return NextResponse.json(
        { error: "봇 확인에 실패했습니다. 새로고침 후 다시 시도해주세요." },
        { status: 400 }
      );
    }

    const validated = validateSurveySubmission(body.answers, body.otherTexts ?? {});
    if (!validated.ok) {
      return NextResponse.json(
        {
          error: validated.reason === "direct_identifier"
            ? "자유서술에서 연락처와 링크를 제거해 주세요."
            : "설문 응답을 다시 확인해 주세요.",
        },
        { status: 400 },
      );
    }
    const { answers, otherTexts } = validated.data;

    const ranking = Array.isArray(answers.q13) ? answers.q13 : [];
    const q15 = isRecord(answers.q15) ? answers.q15 : {};
    const q22 = isRecord(answers.q22) ? answers.q22 : {};

    const row = {
      q1_status: scalar(answers.q1),
      q2_region: scalar(answers.q2),

      q3_info_compare: scalar(answers.q3),
      q4_cost_transparent: scalar(answers.q4),
      q5_reservation_easy: scalar(answers.q5),
      q6_price_gap: scalar(answers.q6),
      q7_pain_points: stringArray(answers.q7),
      q7_other: cleanOptionalText(otherTexts.q7, 1000),

      q8_planner_usage: scalar(answers.q8),
      q8_1_planner_satisfaction: scalar(answers.q8_1),
      q8_2_no_planner_reasons: stringArray(answers.q8_2),
      q8_2_other: cleanOptionalText(otherTexts.q8_2, 1000),
      q9_commission_awareness: scalar(answers.q9),
      q10_transparency_impact: scalar(answers.q10),

      q11_main_channel: scalar(answers.q11),
      q11_other: cleanOptionalText(otherTexts.q11, 1000),
      q11_1_channel_satisfaction: scalar(answers.q11_1),
      q12_dissatisfaction: stringArray(answers.q12),
      q12_other: cleanOptionalText(otherTexts.q12, 1000),

      q13_feature_rank_1: scalar(ranking[0]),
      q13_feature_rank_2: scalar(ranking[1]),
      q13_feature_rank_3: scalar(ranking[2]),
      q14_ai_expectations: stringArray(answers.q14),

      q15_a_fair_price: scalar(q15.q15_a),
      q15_b_max_price: scalar(q15.q15_b),
      q16_payment_preference: scalar(answers.q16),

      q17_interested_services: stringArray(answers.q17),
      q17_other: cleanOptionalText(otherTexts.q17, 1000),
      q18_lacking_info: scalar(answers.q18),
      q18_other: cleanOptionalText(otherTexts.q18, 1000),

      q19_usage_intent: scalar(answers.q19),
      q20_nps: scalar(answers.q20),
      q21_feedback: cleanOptionalText(answers.q21, 2000),

      q22_gender: scalar(q22.q22_gender),
      q22_age: scalar(q22.q22_age),
      q22_budget: scalar(q22.q22_budget),
      completion_time_seconds:
        cleanIntegerInRange(body.completionTimeSeconds, 0, 24 * 60 * 60) ?? null,
      screen_out: false,
      survey_consent_version: CURRENT_CUSTOMER_SURVEY_CONSENT_VERSION,
      survey_consented_at: new Date().toISOString(),
    };

    const { error } = await getServiceClient()
      .from("customer_survey_responses")
      .insert(row);

    if (error) {
      console.error("survey insert failed", safeErrorDiagnostic(error));
      return NextResponse.json(
        { error: "응답 저장에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Survey API error", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
