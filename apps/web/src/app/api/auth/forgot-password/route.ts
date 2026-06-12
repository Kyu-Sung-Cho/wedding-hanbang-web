import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { verifyTurnstile, normalizeEmailForRateLimit } from "@/lib/turnstile";

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(request: Request) {
  try {
    const { email, turnstileToken } = await request.json();

    if (!email) {
      return NextResponse.json({ error: "이메일을 입력해주세요." }, { status: 400 });
    }

    // signup과 동일한 발송 표면 — Turnstile + rate limit으로 이메일 폭탄을 막는다.
    // enumeration 방지를 위해 차단 시에도 동일하게 success를 반환(무발송)한다.
    const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const turnstile = await verifyTurnstile(turnstileToken, clientIp);
    if (!turnstile.ok) {
      return NextResponse.json({ success: true });
    }
    const ipLimited = checkRateLimit(rateLimitKey("forgot", request), {
      maxRequests: 5,
      windowMs: 10 * 60 * 1000,
    });
    if (ipLimited) return NextResponse.json({ success: true });
    const emailLimited = checkRateLimit(`forgot-email:${normalizeEmailForRateLimit(email)}`, {
      maxRequests: 3,
      windowMs: 60 * 60 * 1000,
    });
    if (emailLimited) return NextResponse.json({ success: true });

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
      console.error("generateLink recovery error:", error);
      // 보안상 존재하지 않는 이메일도 성공으로 응답
      return NextResponse.json({ success: true });
    }

    if (!data?.properties?.action_link) {
      // 보안상 성공으로 응답
      return NextResponse.json({ success: true });
    }

    // Resend로 비밀번호 재설정 이메일 발송
    const resetLink = data.properties.action_link;
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: "웨딩한방 <noreply@hanbang.ai>",
      to: email,
      subject: "웨딩한방 비밀번호 재설정",
      html: `
        <div style="font-family: 'Noto Sans KR', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FDFCFA;">
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

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Forgot password API error:", err);
    // 보안상 성공으로 응답
    return NextResponse.json({ success: true });
  }
}
