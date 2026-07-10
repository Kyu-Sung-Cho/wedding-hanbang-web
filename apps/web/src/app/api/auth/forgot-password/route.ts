import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { checkRateLimitPersistent, getClientIp, rateLimitKey } from "@/utils/rateLimit";
import { verifyTurnstile, normalizeEmailForRateLimit } from "@/lib/turnstile";
import { normalizeEmail } from "@/utils/requestValidation";

const GENERIC_RECOVERY_MESSAGE =
  "요청을 확인했습니다. 해당 이메일로 재설정이 가능하면 안내가 도착합니다.";

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function genericRecoveryResponse() {
  return NextResponse.json({ success: true, message: GENERIC_RECOVERY_MESSAGE });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

export async function POST(request: Request) {
  try {
    const { email: rawEmail, turnstileToken } = await request.json();
    const email = normalizeEmail(rawEmail);

    if (!email) {
      return NextResponse.json({ error: "이메일을 입력해주세요." }, { status: 400 });
    }

    // 모든 비인증 호출은 출처와 관계없이 서버 검증을 통과해야 한다.
    const turnstile = await verifyTurnstile(turnstileToken, getClientIp(request));
    if (!turnstile.ok) {
      return NextResponse.json(
        { error: "보안 확인을 완료한 뒤 다시 시도해주세요." },
        { status: 400 }
      );
    }
    const ipLimited = await checkRateLimitPersistent(rateLimitKey("forgot", request), {
      maxRequests: 5,
      windowMs: 10 * 60 * 1000,
    });
    if (ipLimited) return genericRecoveryResponse();
    const emailLimited = await checkRateLimitPersistent(`forgot-email:${normalizeEmailForRateLimit(email)}`, {
      maxRequests: 3,
      windowMs: 60 * 60 * 1000,
    });
    if (emailLimited) return genericRecoveryResponse();

    const supabase = getAdminSupabase();

    // Admin API로 비밀번호 재설정 링크 생성
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "https://hanbang.ai"}/reset-password`,
      },
    });

    if (error) {
      console.error("AUTH_RECOVERY_LINK_GENERATION_FAILED", {
        severity: "error",
        ...safeErrorMetadata(error),
      });
      return genericRecoveryResponse();
    }

    if (!data?.properties?.action_link) {
      console.error("AUTH_RECOVERY_LINK_MISSING", { severity: "error" });
      return genericRecoveryResponse();
    }

    // Resend로 비밀번호 재설정 이메일 발송
    const resetLink = data.properties.action_link;
    const safeResetLink = escapeHtml(resetLink);

    try {
      if (!process.env.RESEND_API_KEY) {
        throw new Error("RESEND_API_KEY is not configured");
      }

      const resend = new Resend(process.env.RESEND_API_KEY);
      const { error: emailError } = await resend.emails.send({
        from: "웨딩한방 <noreply@hanbang.ai>",
        to: email,
        subject: "웨딩한방 비밀번호 재설정",
        html: `
        <div style="font-family: 'Paperlogy', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FDFCFA;">
          <div style="text-align: center; margin-bottom: 32px;">
            <img src="https://hanbang.ai/images/logo-512-transparent.png" alt="웨딩한방" width="64" height="64" style="width: 64px; height: 64px; object-fit: contain;" />
          </div>
          <h1 style="font-size: 24px; font-weight: 300; color: #1A1A1F; text-align: center; margin-bottom: 16px;">
            비밀번호 재설정
          </h1>
          <p style="font-size: 15px; color: #4A4A52; line-height: 1.7; text-align: center; margin-bottom: 32px;">
            아래 버튼을 클릭하여 새 비밀번호를 설정해주세요.<br>
            이 링크는 24시간 동안 유효합니다.
          </p>
          <div style="text-align: center; margin-bottom: 32px;">
            <a href="${safeResetLink}" style="display: inline-block; padding: 14px 40px; background: #1A1A1F; color: white; border-radius: 24px; text-decoration: none; font-size: 14px; font-weight: 500;">
              비밀번호 재설정하기
            </a>
          </div>
          <p style="font-size: 13px; color: #928980; text-align: center; margin-bottom: 24px;">
            버튼이 작동하지 않으면 아래 링크를 복사하여 브라우저에 붙여넣으세요:
          </p>
          <p style="font-size: 12px; color: #B5ADA3; word-break: break-all; text-align: center; margin-bottom: 32px; padding: 16px; background: #FAF7F2; border-radius: 12px;">
            ${safeResetLink}
          </p>
          <p style="font-size: 12px; color: #B5ADA3; text-align: center;">
            비밀번호 재설정을 요청하지 않으셨다면 이 메일을 무시하셔도 됩니다.
          </p>
          <p style="font-size: 11px; color: #D5D0C9; text-align: center; margin-top: 24px;">
            © 2026 웨딩한방. All rights reserved.
          </p>
        </div>
        `,
      });

      if (emailError) throw emailError;
    } catch (error) {
      // 외부에는 계정 존재 여부와 전달 결과를 숨기고, 운영 로그에만 실패 신호를 남긴다.
      console.error("AUTH_RECOVERY_EMAIL_DELIVERY_FAILED", {
        severity: "error",
        ...safeErrorMetadata(error),
      });
    }

    return genericRecoveryResponse();
  } catch (err) {
    console.error("AUTH_RECOVERY_UNEXPECTED_FAILURE", {
      severity: "error",
      ...safeErrorMetadata(err),
    });
    return genericRecoveryResponse();
  }
}
