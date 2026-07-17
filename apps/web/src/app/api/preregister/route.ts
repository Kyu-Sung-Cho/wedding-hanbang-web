import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTurnstile, normalizeEmailForRateLimit } from "@/lib/turnstile";
import {
  checkRateLimitPersistent,
  getClientIp,
  rateLimitKey,
  rateLimitSubjectKey,
} from "@/utils/rateLimit";
import {
  cleanOptionalBoolean,
  cleanOptionalEnum,
  cleanOptionalIsoDate,
  cleanOptionalText,
  isBodyTooLarge,
  isRecord,
  normalizeEmail,
} from "@/utils/requestValidation";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const ROLE_VALUES = ["bride", "groom"] as const;

function getServiceClient() {
  return createAdminClient();
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

    if (!email) {
      return NextResponse.json(
        { error: "유효한 이메일을 입력해주세요." },
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

    const emailLimited = await checkRateLimitPersistent(
      rateLimitSubjectKey("preregister-email", email),
      {
        maxRequests: 3,
        windowMs: 24 * 60 * 60 * 1000,
      },
    );
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

    const { data: existing } = await supabase
      .from("preregistrations")
      .select("id, is_beta_candidate")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      if (isBetaCandidate && !existing.is_beta_candidate) {
        await supabase
          .from("preregistrations")
          .update({
            is_beta_candidate: true,
            name: name ?? undefined,
            wedding_date: weddingDate ?? undefined,
            role: role ?? undefined,
            message: message ?? undefined,
          })
          .eq("id", existing.id);
        return NextResponse.json({ success: true, upgraded: true });
      }
      return NextResponse.json(
        { error: "이미 등록된 이메일입니다." },
        { status: 409 }
      );
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
      });

    if (insertError) {
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
