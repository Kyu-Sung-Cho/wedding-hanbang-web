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

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const ROLE_VALUES = ["bride", "groom"] as const;
const PRIVACY_POLICY_VERSION = "2026-07-11";
const RETENTION_DAYS = 180;

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

    const ipLimited = await checkRateLimitPersistent(rateLimitKey("preregister", request), {
      maxRequests: 10,
      windowMs: 60 * 60 * 1000,
    });
    if (ipLimited) return ipLimited;

    const body = await request.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const email = normalizeEmailForRateLimit(normalizeEmail(body.email) ?? "");
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
    if (isBetaCandidate && !role) {
      return NextResponse.json({ error: "역할을 선택해주세요." }, { status: 400 });
    }

    const emailLimited = await checkRateLimitPersistent(`preregister-email:${email}`, {
      maxRequests: 3,
      windowMs: 24 * 60 * 60 * 1000,
    });
    if (emailLimited) return emailLimited;

    const turnstile = await verifyTurnstile(
      typeof body.turnstileToken === "string" ? body.turnstileToken : null,
      getClientIp(request)
    );
    if (!turnstile.ok) {
      return NextResponse.json(
        { error: "봇 확인에 실패했습니다. 새로고침 후 다시 시도해주세요." },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { error: purgeError } = await supabase
      .from("preregistrations")
      .delete()
      .lt("expires_at", now.toISOString());
    if (purgeError) {
      console.error("expired preregistration purge failed:", purgeError);
      return NextResponse.json(
        { error: "신청 정보를 안전하게 처리할 수 없습니다. 잠시 후 다시 시도해주세요." },
        { status: 503 }
      );
    }

    const { data: existing, error: existingError } = await supabase
      .from("preregistrations")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existingError) {
      console.error("preregistration lookup failed:", existingError);
      return NextResponse.json(
        { error: "신청 상태를 확인할 수 없습니다. 잠시 후 다시 시도해주세요." },
        { status: 503 }
      );
    }

    if (existing) {
      // 이메일 소유 확인 전에는 타인이 기존 신청의 PII·동의·만료일을
      // 덮어쓸 수 없다. 신규/기존 여부도 같은 응답으로 반환해 열거를 막는다.
      return NextResponse.json({ success: true });
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

    const { error: insertError } = await supabase
      .from("preregistrations")
      .insert({
        email,
        name,
        wedding_date: weddingDate ?? null,
        role,
        message,
        is_beta_candidate: isBetaCandidate,
        source: isBetaCandidate ? "beta" : "web",
        utm_source,
        utm_medium,
        utm_campaign,
        privacy_consent_at: now.toISOString(),
        privacy_policy_version: PRIVACY_POLICY_VERSION,
        expires_at: expiresAt,
      });

    if (insertError) {
      // 동시에 같은 이메일이 접수된 경우에도 신규/기존 여부를 드러내지
      // 않고 같은 성공 응답을 준다. 기존 행의 동의·PII는 변경하지 않는다.
      if (insertError.code === "23505") {
        return NextResponse.json({ success: true });
      }
      console.error("preregistration insert failed:", insertError);
      return NextResponse.json(
        { error: "등록 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    const { sendPreregistrationEmail } = await import("@/lib/resend");
    void sendPreregistrationEmail(email);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("preregistration API error:", error);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
