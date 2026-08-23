import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  checkRateLimitPersistent,
  getClientIp,
  rateLimitKey,
  rateLimitSubjectKey,
} from "@/utils/rateLimit";
import { verifyTurnstile, normalizeEmailForRateLimit } from "@/lib/turnstile";
import { buildEmailConfirmUrl, describeEmailConfirmTtl } from "@/lib/auth/emailConfirmLink";
import {
  isRecord,
  normalizeEmail,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";

const MAX_BODY_BYTES = 4 * 1024;

function getAdminSupabase() {
  return createAdminClient();
}

export async function POST(request: Request) {
  try {
    const rawBody = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
    if (!rawBody.ok) {
      return NextResponse.json(
        { error: rawBody.reason === "too_large" ? "요청 데이터가 너무 큽니다." : "잘못된 요청입니다." },
        { status: rawBody.reason === "too_large" ? 413 : 400 },
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody.text);
    } catch {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const email = normalizeEmail(body.email);

    if (!email) {
      return NextResponse.json({ error: "이메일을 입력해주세요." }, { status: 400 });
    }

    const ipLimited = await checkRateLimitPersistent(rateLimitKey("forgot", request), {
      maxRequests: 5,
      windowMs: 10 * 60 * 1000,
    });
    if (ipLimited) return NextResponse.json({ success: true });

    // signup과 동일한 발송 표면 — caller-controlled client headers are not
    // attestation. 모든 클라이언트가 검증 토큰을 제출해야 하며, enumeration
    // 방지를 위해 실패 응답은 동일한 success 형태로 마스킹한다.
    const turnstile = await verifyTurnstile(
      typeof body.turnstileToken === "string" ? body.turnstileToken : undefined,
      getClientIp(request),
      "forgot",
    );
    if (!turnstile.ok) {
      return NextResponse.json({ success: true });
    }
    const emailLimited = await checkRateLimitPersistent(
      rateLimitSubjectKey("forgot-email", normalizeEmailForRateLimit(email)),
      {
        maxRequests: 3,
        windowMs: 60 * 60 * 1000,
      },
    );
    if (emailLimited) return NextResponse.json({ success: true });

    const supabase = getAdminSupabase();

    // Admin API로 비밀번호 재설정 링크 생성
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
    });

    if (error) {
      console.error("generateLink recovery error:", error);
      // 보안상 존재하지 않는 이메일도 성공으로 응답
      return NextResponse.json({ success: true });
    }

    if (!data?.properties?.hashed_token) {
      // 보안상 성공으로 응답
      return NextResponse.json({ success: true });
    }

    // Resend로 비밀번호 재설정 이메일 발송.
    // Supabase 의 action_link 를 쓰지 않는 이유는 @/lib/auth/emailConfirmLink 에
    // 적어 뒀다 — 그 링크는 재설정 화면을 "인증 확인 중"에서 영원히 멈추게 했다.
    const resetLink = buildEmailConfirmUrl({
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "https://hanbang.ai",
      tokenHash: data.properties.hashed_token,
      type: "recovery",
    });
    const resend = new Resend(process.env.RESEND_API_KEY);

    // 여기서는 계정 존재 여부가 새지 않도록 응답을 바꾸지 않는다. 다만 발송
    // 실패를 흔적 없이 삼키면 "메일이 안 와요" 문의를 추적할 방법이 없어진다.
    const sendResult = await resend.emails.send({
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
            이 링크는 ${describeEmailConfirmTtl("recovery")} 동안만 유효합니다.
          </p>
          <div style="text-align: center; margin-bottom: 32px;">
            <a href="${resetLink}" style="display: inline-block; padding: 14px 40px; background: #1A1A1F; color: white; border-radius: 24px; text-decoration: none; font-size: 14px; font-weight: 500;">
              비밀번호 재설정하기
            </a>
          </div>
          <p style="font-size: 13px; color: #928980; text-align: center; margin-bottom: 24px;">
            버튼이 작동하지 않으면 아래 링크를 복사하여 브라우저에 붙여넣으세요:
          </p>
          <p style="font-size: 12px; color: #B5ADA3; word-break: break-all; text-align: center; margin-bottom: 32px; padding: 16px; background: #FAF7F2; border-radius: 12px;">
            ${resetLink}
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

    if (sendResult.error || !sendResult.data?.id) {
      console.error("Password reset email send failed:", sendResult.error);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Forgot password API error:", err);
    // 보안상 성공으로 응답
    return NextResponse.json({ success: true });
  }
}
