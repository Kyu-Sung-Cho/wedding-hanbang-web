import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { verifyTurnstile, normalizeEmailForRateLimit } from "@/lib/turnstile";
import { checkRateLimitPersistent, getClientIp, rateLimitKey } from "@/utils/rateLimit";
import {
  cleanOptionalBoolean,
  cleanOptionalEnum,
  cleanOptionalIsoDate,
  cleanOptionalText,
  isBodyTooLarge,
  isRecord,
  normalizeEmail,
} from "@/utils/requestValidation";
import { ymdInKst } from "@/lib/utils/kstDate";
import { USER_RESEARCH_COHORT_CODE } from "@/constants/beta";
import { hasResearchEmailVerificationConfig } from "@/lib/researchEmailVerification";
import { isResearchCohortApplicationsEnabled } from "@/lib/researchCohortAvailability";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const ROLE_VALUES = ["bride", "groom"] as const;
const PRIVACY_POLICY_VERSION = "2026-07-12";
const RETENTION_DAYS = 180;
const COHORT_WEDDING_DATE_MIN = "2026-07-01";
const COHORT_WEDDING_DATE_MAX = "2026-12-31";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function attemptVerificationEmail(
  supabase: ReturnType<typeof getServiceClient>,
  email: string,
  applicationId: string,
): Promise<boolean> {
  const { sendResearchCohortReceiptEmail } = await import("@/lib/resend");
  const delivered = await sendResearchCohortReceiptEmail(
    email,
    applicationId,
    USER_RESEARCH_COHORT_CODE
  );
  const { error: receiptStatusError } = await supabase
    .from("research_cohort_applications")
    .update({
      receipt_email_status: delivered ? "sent" : "failed",
      receipt_email_attempted_at: new Date().toISOString(),
    })
    .eq("id", applicationId);
  if (receiptStatusError) {
    console.error("RESEARCH_COHORT_RECEIPT_STATUS_UPDATE_FAILED");
  }
  if (!delivered) {
    console.error("RESEARCH_COHORT_RECEIPT_EMAIL_PENDING");
  }
  return delivered;
}

export async function POST(request: NextRequest) {
  try {
    if (!isResearchCohortApplicationsEnabled()) {
      return NextResponse.json(
        {
          code: "RESEARCH_INTAKE_CLOSED",
          error: "사용자 연구 신청은 안전 확인을 마친 뒤 열 예정입니다.",
        },
        {
          status: 503,
          headers: { "Cache-Control": "no-store, max-age=0" },
        }
      );
    }
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const ipLimited = await checkRateLimitPersistent(rateLimitKey("preregister", request), {
      maxRequests: 10,
      windowMs: 60 * 60 * 1000,
    });
    if (ipLimited) return ipLimited;

    const body = await request.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    // 보관·중복 판정·메일 발송에는 사용자가 입력한 정규화 주소를 그대로
    // 사용한다. Gmail 점/plus alias 정규화는 남용 방지 버킷에만 적용한다.
    const email = normalizeEmail(body.email) ?? "";
    const name = cleanOptionalText(body.name, 60);
    const weddingDate = cleanOptionalIsoDate(body.weddingDate);
    const role = cleanOptionalEnum(body.role, ROLE_VALUES);
    const message = cleanOptionalText(body.message, 500);
    const isBetaCandidate = cleanOptionalBoolean(body.isBetaCandidate);
    const privacyConsent = cleanOptionalBoolean(body.privacyConsent);

    if (!email) {
      return NextResponse.json(
        { error: "유효한 이메일을 입력해주세요." },
        { status: 400 }
      );
    }

    if (privacyConsent !== true) {
      return NextResponse.json(
        { error: "개인정보 수집·이용 안내를 확인하고 동의해주세요." },
        { status: 400 }
      );
    }

    if (body.weddingDate !== undefined && weddingDate === undefined) {
      return NextResponse.json(
        { error: "결혼 예정일 형식이 올바르지 않습니다." },
        { status: 400 }
      );
    }

    if (body.role !== undefined && body.role !== "" && !role) {
      return NextResponse.json(
        { error: "역할 값이 올바르지 않습니다." },
        { status: 400 }
      );
    }
    if (weddingDate && weddingDate < ymdInKst()) {
      return NextResponse.json({ error: "지난 예식일은 베타 신청에 사용할 수 없습니다." }, { status: 400 });
    }
    if (
      weddingDate
      && (weddingDate < COHORT_WEDDING_DATE_MIN || weddingDate > COHORT_WEDDING_DATE_MAX)
    ) {
      return NextResponse.json(
        { error: "이번 사용자 연구는 2026년 7~12월 예식 예정자 또는 예식일 미정인 분을 대상으로 합니다." },
        { status: 400 }
      );
    }
    if (isBetaCandidate !== true) {
      return NextResponse.json(
        { error: "현재는 6주 사용자 연구 코호트 신청만 접수하고 있습니다." },
        { status: 400 }
      );
    }
    if (!role) {
      return NextResponse.json({ error: "역할을 선택해주세요." }, { status: 400 });
    }

    const turnstile = await verifyTurnstile(
      typeof body.turnstileToken === "string" ? body.turnstileToken : null,
      getClientIp(request),
      "preregister"
    );
    if (!turnstile.ok) {
      return NextResponse.json(
        { error: "봇 확인에 실패했습니다. 새로고침 후 다시 시도해주세요." },
        { status: 400 }
      );
    }

    if (!process.env.RESEND_API_KEY || !hasResearchEmailVerificationConfig()) {
      console.error("RESEARCH_EMAIL_VERIFICATION_NOT_CONFIGURED");
      return NextResponse.json(
        { error: "이메일 확인을 안전하게 시작할 수 없습니다. 잠시 후 다시 시도해주세요." },
        { status: 503 }
      );
    }

    // 검증되지 않은 요청이 타인의 이메일 버킷을 소진해 24시간 신청을
    // 막지 못하도록, 주소별 제한은 Turnstile 성공 뒤에만 소비한다.
    const emailRateLimitIdentity = normalizeEmailForRateLimit(email);
    const emailLimited = await checkRateLimitPersistent(`preregister-email:${emailRateLimitIdentity}`, {
      maxRequests: 3,
      windowMs: 24 * 60 * 60 * 1000,
    });
    if (emailLimited) return emailLimited;

    const supabase = getServiceClient();
    const now = new Date();
    const applicationTimestamp = now.toISOString();
    const expiresAt = new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { error: purgeError } = await supabase
      .from("research_cohort_applications")
      .delete()
      .lte("expires_at", applicationTimestamp);
    if (purgeError) {
      console.error("RESEARCH_COHORT_EXPIRED_PURGE_FAILED");
      return NextResponse.json(
        { error: "신청 정보를 안전하게 처리할 수 없습니다. 잠시 후 다시 시도해주세요." },
        { status: 503 }
      );
    }

    const { data: existing, error: existingError } = await supabase
      .from("research_cohort_applications")
      .select("id")
      .eq("email", email)
      .eq("cohort_code", USER_RESEARCH_COHORT_CODE)
      .gt("expires_at", applicationTimestamp)
      .maybeSingle();

    if (existingError) {
      console.error("RESEARCH_COHORT_LOOKUP_FAILED");
      return NextResponse.json(
        { error: "신청 상태를 확인할 수 없습니다. 잠시 후 다시 시도해주세요." },
        { status: 503 }
      );
    }

    if (existing) {
      // 이메일 소유 확인 전에는 타인이 기존 신청의 PII·동의·만료일을
      // 덮어쓸 수 없다. 신규/기존 여부도 같은 응답으로 반환해 열거를 막는다.
      // 신규/기존/확인 완료 여부를 응답 시간이나 발송 유무로 구분할 수
      // 없게 동일 주소로 새 2시간 확인 링크를 보낸다. PII는 덮어쓰지 않는다.
      const verificationEmailSent = await attemptVerificationEmail(
        supabase,
        email,
        existing.id
      );
      return NextResponse.json({ success: true, verificationEmailSent });
    }

    // UTM: body 우선, URL 쿼리 폴백 — 폼은 fetch POST라 쿼리가 안 실린다.
    // 클라이언트(BetaForm)가 랜딩 시 캡처한 first-touch UTM을 body로 보낸다.
    const url = new URL(request.url);
    const utm_source =
      cleanOptionalText(body.utmSource, 80) ?? cleanOptionalText(url.searchParams.get("utm_source"), 80);
    const utm_medium =
      cleanOptionalText(body.utmMedium, 80) ?? cleanOptionalText(url.searchParams.get("utm_medium"), 80);
    const utm_campaign =
      cleanOptionalText(body.utmCampaign, 120) ?? cleanOptionalText(url.searchParams.get("utm_campaign"), 120);

    const { data: inserted, error: insertError } = await supabase
      .from("research_cohort_applications")
      .insert({
        cohort_code: USER_RESEARCH_COHORT_CODE,
        email,
        name,
        wedding_date: weddingDate ?? null,
        role,
        message,
        source: "research",
        utm_source,
        utm_medium,
        utm_campaign,
        privacy_consent_at: applicationTimestamp,
        privacy_policy_version: PRIVACY_POLICY_VERSION,
        created_at: applicationTimestamp,
        expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (insertError) {
      // 동시에 같은 이메일이 접수된 경우에도 신규/기존 여부를 드러내지
      // 않고 같은 성공 응답을 준다. 기존 행의 동의·PII는 변경하지 않는다.
      if (insertError.code === "23505") {
        const { data: concurrentExisting, error: concurrentLookupError } = await supabase
          .from("research_cohort_applications")
          .select("id")
          .eq("email", email)
          .eq("cohort_code", USER_RESEARCH_COHORT_CODE)
          .gt("expires_at", applicationTimestamp)
          .maybeSingle();
        if (!concurrentLookupError && concurrentExisting) {
          const verificationEmailSent = await attemptVerificationEmail(
            supabase,
            email,
            concurrentExisting.id
          );
          return NextResponse.json({ success: true, verificationEmailSent });
        }
        if (concurrentLookupError) {
          console.error("RESEARCH_COHORT_CONCURRENT_LOOKUP_FAILED");
        }
      }
      console.error("RESEARCH_COHORT_INSERT_FAILED");
      return NextResponse.json(
        { error: "등록 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }
    if (!inserted?.id) {
      console.error("RESEARCH_COHORT_INSERT_ID_MISSING");
      return NextResponse.json(
        { error: "신청 접수 결과를 확인할 수 없습니다." },
        { status: 503 }
      );
    }

    const verificationEmailSent = await attemptVerificationEmail(
      supabase,
      email,
      inserted.id
    );

    return NextResponse.json({ success: true, verificationEmailSent });
  } catch {
    console.error("RESEARCH_COHORT_UNEXPECTED_FAILURE");
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
