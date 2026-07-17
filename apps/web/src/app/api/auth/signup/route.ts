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
import { cleanOptionalText, normalizeEmail } from "@/utils/requestValidation";

function getAdminSupabase() {
  return createAdminClient();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isStrongPassword(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

export async function POST(request: Request) {
  try {
    const { email: rawEmail, password, name: rawName, turnstileToken, marketingAgreed } = await request.json();
    const email = normalizeEmail(rawEmail);
    const name = cleanOptionalText(rawName, 60);
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

    // 모바일 앱은 Turnstile 위젯을 렌더할 수 없어 토큰을 만들 수 없다.
    // 브라우저 봇 차단(Turnstile)만 생략하고, 이메일 폭탄의 실제 방어선인
    // IP/이메일 rate limit·enumeration 마스킹·강한 비밀번호는 모바일에도 그대로 적용한다.
    // (헤더는 스푸핑 가능하나, 남용은 아래 rate limit + 이메일 인증 필수로 봉인된다.
    //  장기적으로는 모바일 앱 어테스테이션/Turnstile 도입 권장.)
    const isMobileClient = request.headers.get("x-hanbang-client") === "mobile";
    if (!isMobileClient) {
      const turnstile = await verifyTurnstile(turnstileToken, getClientIp(request));
      if (!turnstile.ok) {
        return NextResponse.json(
          { error: "봇 확인에 실패했습니다. 페이지를 새로고침하고 다시 시도해주세요." },
          { status: 400 }
        );
      }
    }

    const ipLimited = await checkRateLimitPersistent(rateLimitKey("signup", request), {
      maxRequests: 5,
      windowMs: 10 * 60 * 1000,
    });
    if (ipLimited) return ipLimited;

    const emailLimited = await checkRateLimitPersistent(
      rateLimitSubjectKey("signup-email", normalizeEmailForRateLimit(email)),
      {
        maxRequests: 3,
        windowMs: 60 * 60 * 1000,
      },
    );
    if (emailLimited) return emailLimited;

    const supabase = getAdminSupabase();
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "signup",
      email,
      password,
      options: {
        data: { name, marketing_agreed: marketingConsent },
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "https://hanbang.ai"}/api/auth/callback`,
      },
    });

    if (error) {
      if (
        error.message.includes("already been registered") ||
        error.message.includes("already registered")
      ) {
        return NextResponse.json({ success: true, message: "인증 이메일을 발송했습니다." });
      }
      console.error("generateLink error:", error);
      return NextResponse.json(
        { error: "회원가입 처리 중 오류가 발생했습니다." },
        { status: 400 }
      );
    }

    if (!data?.properties?.action_link) {
      return NextResponse.json({ error: "인증 링크 생성에 실패했습니다." }, { status: 500 });
    }

    const confirmLink = data.properties.action_link;
    const resend = new Resend(process.env.RESEND_API_KEY);
    const safeName = escapeHtml(name);

    await resend.emails.send({
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
            <a href="${confirmLink}" style="display: inline-block; padding: 14px 40px; background: #1A1A1F; color: white; border-radius: 24px; text-decoration: none; font-size: 14px; font-weight: 500;">
              이메일 인증하기
            </a>
          </div>
          <p style="font-size: 13px; color: #928980; text-align: center; margin-bottom: 24px;">
            버튼이 작동하지 않으면 아래 링크를 복사해 브라우저에 붙여넣어주세요:
          </p>
          <p style="font-size: 12px; color: #B5ADA3; word-break: break-all; text-align: center; margin-bottom: 32px; padding: 16px; background: #FAF7F2; border-radius: 12px;">
            ${confirmLink}
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

    return NextResponse.json({ success: true, message: "인증 이메일을 발송했습니다." });
  } catch (err) {
    console.error("Signup API error:", err);
    return NextResponse.json(
      { error: "회원가입 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
