// 웨딩코드 스모크 응답 수집 — 익명 공개 쓰기.
// 이름·이메일·전화 전용 필드는 없지만 자유입력에는 사용자가 식별정보를 적을 수 있다.
// UI 경고 + 정화/길이 제한 + persistent IP rate limit으로 경계를 두며,
// 채점·가중치 계산은 하지 않는다(가드레일).

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord, isUuid } from "@/utils/requestValidation";
import {
  WEDDING_CODE_V05_COMPATIBLE_VERSIONS,
  WEDDING_CODE_V05_QUESTIONS,
  WEDDING_CODE_V05_SCORING_VERSION,
} from "@/constants/weddingCodeV05";
import { toWeddingCodeV05Answers } from "@/lib/weddingCode/answers";
import { validateWcSubmission } from "@/lib/weddingCode/validate";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024;
const COMPATIBLE_FORM_VERSIONS = new Set<string>(WEDDING_CODE_V05_COMPATIBLE_VERSIONS);

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(request: NextRequest) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const limited = await checkRateLimitPersistent(rateLimitKey("wedding-code", request), {
      maxRequests: 10,
      windowMs: 60 * 60 * 1000,
    });
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const result = validateWcSubmission(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    const data = result.data;

    const admin = getServiceClient();

    // DB RPC owns check + slot claim + insert in one transaction. A trigger
    // enforces the same max-two invariant for direct service-role writes.
    const { data: inserted, error } = await admin.rpc("insert_wedding_code_response", {
      p_submission_id: data.submission_id,
      p_form_version: data.form_version,
      p_scoring_version: data.scoring_version,
      p_participant_stage: data.participant_stage,
      p_answering_mode: data.answering_mode,
      p_quote_status: data.quote_status,
      p_parent_involvement: data.parent_involvement,
      p_biggest_concern: data.biggest_concern,
      p_biggest_concern_other: data.biggest_concern_other,
      p_answers: data.answers,
      p_stage_flags: data.stage_flags,
      p_feedback: data.feedback,
      p_cta_interest: data.cta_interest,
      p_free_text: data.free_text,
      p_duration_ms: data.duration_ms,
      p_utm_source: data.utm.source,
      p_utm_medium: data.utm.medium,
      p_utm_campaign: data.utm.campaign,
      p_utm_content: data.utm.content,
      p_couple_token: data.couple_token,
    });

    if (error) {
      console.error("[wedding-code] atomic insert 실패:", error.message);
      return NextResponse.json(
        {
          error: "저장에 실패했습니다. 잠시 후 다시 시도해주세요.",
          pairingStatus: "error",
        },
        { status: 503 }
      );
    }

    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    const pairingStatus = isRecord(row) ? row.pairing_status : null;
    const recovered = isRecord(row) ? row.recovered : null;
    const storedCoupleToken = isRecord(row) ? row.couple_token : null;
    const storedFormVersion = isRecord(row) ? row.form_version : null;
    const storedScoringVersion = isRecord(row) ? row.scoring_version : null;
    const storedParticipantStage = isRecord(row) ? row.participant_stage : null;
    const storedQuoteStatus = isRecord(row) ? row.quote_status : null;
    const storedAnswers = toWeddingCodeV05Answers(isRecord(row) ? row.answers : null);
    if (
      !isRecord(row) ||
      !isUuid(row.response_id) ||
      typeof recovered !== "boolean" ||
      !["unpaired", "waiting", "paired", "full"].includes(String(pairingStatus)) ||
      ((pairingStatus === "waiting" || pairingStatus === "paired") &&
        !isUuid(storedCoupleToken)) ||
      ((pairingStatus === "unpaired" || pairingStatus === "full") &&
        storedCoupleToken !== null) ||
      typeof storedFormVersion !== "string" ||
      !COMPATIBLE_FORM_VERSIONS.has(storedFormVersion) ||
      storedScoringVersion !== WEDDING_CODE_V05_SCORING_VERSION ||
      typeof storedParticipantStage !== "string" ||
      typeof storedQuoteStatus !== "string" ||
      Object.keys(storedAnswers).length !== WEDDING_CODE_V05_QUESTIONS.length
    ) {
      console.error("[wedding-code] atomic insert 응답 형식 오류");
      return NextResponse.json(
        { error: "저장 결과를 확인하지 못했어요.", pairingStatus: "error" },
        { status: 503 }
      );
    }

    const paired = pairingStatus === "paired";
    const coupleToken = pairingStatus === "waiting" || paired ? storedCoupleToken : null;
    return NextResponse.json({
      success: true,
      id: row.response_id,
      paired,
      recovered,
      coupleToken,
      pairingStatus,
      formVersion: storedFormVersion,
      scoringVersion: storedScoringVersion,
      participantStage: storedParticipantStage,
      quoteStatus: storedQuoteStatus,
      answers: storedAnswers,
    });
  } catch (err) {
    console.error("[wedding-code] 서버 오류:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다.", pairingStatus: "error" },
      { status: 503 }
    );
  }
}
