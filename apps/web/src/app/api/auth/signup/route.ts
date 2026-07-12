import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { checkRateLimitPersistent, getClientIp, rateLimitKey } from "@/utils/rateLimit";
import { verifyTurnstile, normalizeEmailForRateLimit } from "@/lib/turnstile";
import { cleanOptionalText, normalizeEmail } from "@/utils/requestValidation";
import { sanitizeAuthReturnPath } from "@/lib/authReturnPath";
import { isStrongPassword } from "@hanbang/shared";
import { ChatRequestError, readBoundedJsonBody } from "@/lib/ai/chatRequest";

const MAX_BODY_BYTES = 16 * 1024;

const GENERIC_SIGNUP_MESSAGE =
  "요청을 확인했습니다. 가입 가능한 이메일이면 인증 안내가 도착합니다. 받지 못했다면 잠시 후 다시 시도해주세요.";

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function genericSignupResponse() {
  return NextResponse.json({ success: true, message: GENERIC_SIGNUP_MESSAGE });
}

function safeErrorMetadata(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return { errorType: typeof error };
  }

  const value = error as { name?: unknown; code?: unknown; status?: unknown };
  return {
    errorName: typeof value.name === "string" ? value.name : undefined,
    code: typeof value.code === "string" ? value.code : undefined,
    status: typeof value.status === "number" ? value.status : undefined,
  };
}

async function compensateCreatedUser(
  supabase: ReturnType<typeof getAdminSupabase>,
  userId: string | undefined,
  reason: "missing_action_link" | "email_delivery_failed"
): Promise<void> {
  const incidentId = crypto.randomUUID();

  if (!userId) {
    console.error("AUTH_SIGNUP_COMPENSATION_IMPOSSIBLE", {
      incidentId,
      reason,
      severity: "critical",
      detail: "generateLink succeeded without a user id",
    });
    return;
  }

  try {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) throw error;

    console.error("AUTH_SIGNUP_DELIVERY_FAILED_COMPENSATED", {
      incidentId,
      reason,
      userId,
      severity: "error",
    });
  } catch (error) {
    // userId는 운영자가 고아 계정을 수동 복구할 수 있도록 의도적으로 남긴다.
    // 이메일 주소·이름은 로그에 기록하지 않는다.
    console.error("AUTH_SIGNUP_COMPENSATION_FAILED", {
      incidentId,
      reason,
      userId,
      severity: "critical",
      ...safeErrorMetadata(error),
    });
  }
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return NextResponse.json({ error: "JSON 요청이 필요합니다." }, { status: 415 });
    }
    let body: Record<string, unknown>;
    try {
      body = await readBoundedJsonBody(request, { maxBytes: MAX_BODY_BYTES });
    } catch (error) {
      if (error instanceof ChatRequestError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
    const rawEmail = body.email;
    const password = typeof body.password === "string" ? body.password : "";
    const rawName = body.name;
    const turnstileToken = typeof body.turnstileToken === "string"
      ? body.turnstileToken
      : null;
    const marketingAgreed = body.marketingAgreed;
    const rawNext = body.next;
    const email = normalizeEmail(rawEmail);
    const name = cleanOptionalText(rawName, 60);
    const returnPath = sanitizeAuthReturnPath(rawNext);
    // 마케팅 수신 동의 기록 — 명시적 true만 동의로 저장 (미전달=false, 웹 폼은 현재 미수집)
    const marketingConsent = marketingAgreed === true;

    if (!email || !password || !name) {
      return NextResponse.json({ error: "모든 필드를 입력해주세요." }, { status: 400 });
    }
    if (!isStrongPassword(password)) {
      return NextResponse.json(
        { error: "비밀번호는 8자 이상이며 대문자, 소문자, 숫자, 특수문자를 포함해야 합니다." },
        { status: 400 }
      );
    }

    const ipLimited = await checkRateLimitPersistent(rateLimitKey("signup", request), {
      maxRequests: 5,
      windowMs: 10 * 60 * 1000,
    });
    if (ipLimited) return ipLimited;

    // 먼저 분산 limiter를 통과시켜 oversized/replayed 토큰이 외부 검증
    // provider 호출을 증폭하지 못하게 한다.
    const turnstile = await verifyTurnstile(
      turnstileToken,
      getClientIp(request),
      "signup"
    );
    if (!turnstile.ok) {
      return NextResponse.json(
        { error: "보안 확인을 완료한 뒤 다시 시도해주세요." },
        { status: 400 }
      );
    }

    // 이메일별 제한은 CAPTCHA를 통과한 요청만 소비한다. 그렇지 않으면
    // 공격자가 피해자 이메일만 알고도 가입 가능 시간을 고갈시킬 수 있다.
    const emailLimited = await checkRateLimitPersistent(`signup-email:${normalizeEmailForRateLimit(email)}`, {
      maxRequests: 3,
      windowMs: 60 * 60 * 1000,
    });
    if (emailLimited) return emailLimited;

    const supabase = getAdminSupabase();
    const callbackUrl = new URL(
      "/api/auth/callback",
      process.env.NEXT_PUBLIC_SITE_URL || "https://hanbang.ai"
    );
    if (returnPath) callbackUrl.searchParams.set("next", returnPath);

    const { data, error } = await supabase.auth.admin.generateLink({
      type: "signup",
      email,
      password,
      options: {
        data: { name, marketing_agreed: marketingConsent },
        redirectTo: callbackUrl.toString(),
      },
    });

    if (error) {
      // 기존 계정과 공급자 오류 모두 같은 외부 응답을 사용해 계정 열거를 막는다.
      console.error("AUTH_SIGNUP_LINK_GENERATION_FAILED", {
        severity: "error",
        code: error.code,
        status: error.status,
      });
      return genericSignupResponse();
    }

    if (!data?.properties?.action_link) {
      await compensateCreatedUser(supabase, data?.user?.id, "missing_action_link");
      return genericSignupResponse();
    }

    const confirmLink = data.properties.action_link;
    const safeName = escapeHtml(name);
    const safeConfirmLink = escapeHtml(confirmLink);

    try {
      if (!process.env.RESEND_API_KEY) {
        throw new Error("RESEND_API_KEY is not configured");
      }

      const resend = new Resend(process.env.RESEND_API_KEY);
      const { error: emailError } = await resend.emails.send({
        from: "웨딩한방 <noreply@hanbang.ai>",
        to: email,
        subject: "웨딩한방 이메일 인증을 완료해주세요",
        html: `
        <div style="font-family: 'Paperlogy', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FDFCFA;">
          <div style="text-align: center; margin-bottom: 32px;">
            <img src="https://hanbang.ai/images/logo-512-transparent.png" alt="웨딩한방" width="64" height="64" style="width: 64px; height: 64px; object-fit: contain;" />
          </div>
          <h1 style="font-size: 24px; font-weight: 300; color: #1A1A1F; text-align: center; margin-bottom: 16px;">
            이메일 인증
          </h1>
          <p style="font-size: 15px; color: #4A4A52; line-height: 1.7; text-align: center; margin-bottom: 32px;">
            안녕하세요, <strong>${safeName}</strong>님<br>
            아래 버튼을 클릭하여 이메일 인증을 완료해주세요.
          </p>
          <div style="text-align: center; margin-bottom: 32px;">
            <a href="${safeConfirmLink}" style="display: inline-block; padding: 14px 40px; background: #1A1A1F; color: white; border-radius: 24px; text-decoration: none; font-size: 14px; font-weight: 500;">
              이메일 인증하기
            </a>
          </div>
          <p style="font-size: 13px; color: #928980; text-align: center; margin-bottom: 24px;">
            버튼이 작동하지 않으면 아래 링크를 복사해 브라우저에 붙여넣어주세요:
          </p>
          <p style="font-size: 12px; color: #B5ADA3; word-break: break-all; text-align: center; margin-bottom: 32px; padding: 16px; background: #FAF7F2; border-radius: 12px;">
            ${safeConfirmLink}
          </p>
          <p style="font-size: 12px; color: #B5ADA3; text-align: center;">
            본 메일은 웨딩한방 회원가입 요청에 따라 발송되었습니다.<br>
            요청하지 않았다면 이 메일을 무시해주세요.
          </p>
          <p style="font-size: 11px; color: #D5D0C9; text-align: center; margin-top: 24px;">
            © 2026 웨딩한방. All rights reserved.
          </p>
        </div>
        `,
      });

      if (emailError) throw emailError;
    } catch (error) {
      console.error("AUTH_SIGNUP_EMAIL_DELIVERY_FAILED", {
        severity: "error",
        userId: data.user?.id,
        ...safeErrorMetadata(error),
      });
      await compensateCreatedUser(supabase, data.user?.id, "email_delivery_failed");
    }

    // 성공·기존 계정·보상 처리 결과를 구분하지 않아 이메일 열거를 막는다.
    return genericSignupResponse();
  } catch (err) {
    console.error("Signup API error:", err);
    return NextResponse.json(
      { error: "회원가입 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
