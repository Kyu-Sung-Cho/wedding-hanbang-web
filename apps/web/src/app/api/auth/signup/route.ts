import { NextResponse } from "next/server";
import { log } from "@/utils/log";
import { Resend } from "resend";
import { buildSignupConsentRecord, buildSignupConsentServerEvidence, parseSignupConsent, SIGNUP_CONSENT_POLICY_VERSION } from "@hanbang/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  checkRateLimitPersistent,
  getClientIp,
  rateLimitKey,
  rateLimitSubjectKey,
} from "@/utils/rateLimit";
import { verifyTurnstile, normalizeEmailForRateLimit } from "@/lib/turnstile";
import { buildEmailConfirmUrl } from "@/lib/auth/emailConfirmLink";
import { getRequestedAuthRedirectPath } from "@/lib/auth/safeRedirect";
import {
  cleanOptionalText,
  isRecord,
  normalizeEmail,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";

const MAX_BODY_BYTES = 8 * 1024;

function getAdminSupabase() {
  return createAdminClient();
}

/**
 * 이미 계정이 있는 주소로 가입을 시도했을 때, 계정 주인에게 길을 알려준다.
 *
 * 밖에서 보는 응답은 신규 가입과 완전히 같아야 하므로(계정 존재 여부가 새면 안 된다)
 * 이 함수는 무엇이 실패하든 조용히 끝난다. 실패를 호출부로 올리면 응답 모양이나
 * 응답 시간이 달라져 그 자체가 신호가 된다.
 *
 * 링크는 비밀번호 재설정 링크다. 비밀번호를 잊어 다시 가입한 경우가 가장 흔하고,
 * 그 링크 하나로 계정을 되찾을 수 있기 때문이다.
 */
async function sendExistingAccountNotice({
  email,
  name,
  siteUrl,
  supabase,
}: {
  email: string;
  name: string;
  siteUrl: string;
  supabase: ReturnType<typeof getAdminSupabase>;
}): Promise<void> {
  try {
    if (!process.env.RESEND_API_KEY) return;

    const { data, error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
    });
    // action_link 를 쓰지 않는 이유는 @/lib/auth/emailConfirmLink 주석에 있다.
    // 그 링크는 결과를 해시로 돌려주고, 해시는 서버에 오지 않는다.
    const hashedToken = error ? null : data?.properties?.hashed_token ?? null;
    const recoveryLink = hashedToken
      ? buildEmailConfirmUrl({ siteUrl, tokenHash: hashedToken, type: "recovery" })
      : null;

    const safeName = escapeHtml(name);
    const loginUrl = `${siteUrl}/login`;
    // 링크를 만들지 못해도 메일은 보낸다. 아무것도 안 오는 것이 지금의 문제였다.
    const recoveryBlock = recoveryLink
      ? `
          <div style="text-align: center; margin-bottom: 32px;">
            <a href="${recoveryLink}" style="display: inline-block; padding: 14px 40px; background: #1A1A1F; color: white; border-radius: 24px; text-decoration: none; font-size: 14px; font-weight: 500;">
              비밀번호 새로 정하기
            </a>
          </div>
          <p style="font-size: 12px; color: #B5ADA3; word-break: break-all; text-align: center; margin-bottom: 32px; padding: 16px; background: #FAF7F2; border-radius: 12px;">
            ${recoveryLink}
          </p>`
      : `
          <div style="text-align: center; margin-bottom: 32px;">
            <a href="${loginUrl}" style="display: inline-block; padding: 14px 40px; background: #1A1A1F; color: white; border-radius: 24px; text-decoration: none; font-size: 14px; font-weight: 500;">
              로그인하러 가기
            </a>
          </div>`;

    await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: "웨딩한방 <noreply@hanbang.ai>",
      to: email,
      subject: "웨딩한방 — 이미 가입된 계정이 있어요",
      html: `
        <div style="font-family: 'Paperlogy', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FDFCFA;">
          <div style="text-align: center; margin-bottom: 32px;">
            <img src="https://hanbang.ai/images/logo-512-transparent.png" alt="웨딩한방" width="64" height="64" style="width: 64px; height: 64px; object-fit: contain;" />
          </div>
          <h1 style="font-size: 24px; font-weight: 300; color: #1A1A1F; text-align: center; margin-bottom: 16px;">
            이미 가입된 계정이 있어요
          </h1>
          <p style="font-size: 15px; color: #4A4A52; line-height: 1.7; text-align: center; margin-bottom: 32px;">
            안녕하세요, <strong>${safeName}</strong>님<br>
            이 주소로 가입을 시도하셨는데, 이미 계정이 있어요.<br>
            비밀번호가 기억나지 않으시면 아래에서 새로 정하실 수 있어요.
          </p>
          ${recoveryBlock}
          <p style="font-size: 13px; color: #928980; text-align: center; margin-bottom: 24px;">
            로그인은 <a href="${loginUrl}" style="color: #4A4A52;">${loginUrl}</a> 에서 하실 수 있어요.
          </p>
          <p style="font-size: 12px; color: #B5ADA3; text-align: center;">
            본인이 시도하신 게 아니라면 이 메일을 무시하셔도 괜찮아요. 계정은 그대로 안전합니다.
          </p>
        </div>
      `,
    });
  } catch (sendError) {
    // 응답은 어떤 경우에도 동일해야 한다.
    console.error("existing account notice failed:", sendError);
  }
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
    const password = body.password;
    const name = cleanOptionalText(body.name, 60);
    const requestedRedirect = cleanOptionalText(body.redirect, 500);
    // 필수 동의(이용약관·개인정보 처리방침)와 선택 동의(마케팅)를 함께 읽는다.
    // 클라이언트 판정을 믿지 않고 서버가 다시 본다 — 동의 없이 만들어진
    // 계정이 정확히 문제이므로, 없으면 계정을 만들지 않는다.
    const consent = parseSignupConsent(body);

    if (!email || !password || !name) {
      return NextResponse.json({ error: "모든 필드를 입력해주세요." }, { status: 400 });
    }
    if (!consent) {
      if (body.termsAgreed === true && body.privacyAgreed === true && body.ageOver14Confirmed === true
        && body.consentPolicyVersion !== SIGNUP_CONSENT_POLICY_VERSION) {
        return NextResponse.json({ error: "동의 문서를 다시 확인해 주세요. 웹은 새로고침하고 앱은 최신 버전에서 다시 진행해 주세요.", code: "SIGNUP_CONSENT_VERSION_REQUIRED" }, { status: 409 });
      }
      return NextResponse.json(
        {
          error: "이용약관과 개인정보 처리방침에 동의해야 가입할 수 있어요.",
          code: "SIGNUP_CONSENT_REQUIRED",
        },
        { status: 400 },
      );
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

    // Caller-controlled client headers are not attestation. Web and native
    // clients without an ambient session must present a server-verifiable
    // Turnstile token. The IP limiter runs first so invalid traffic cannot
    // consume an unbounded number of verification-provider calls.
    const turnstile = await verifyTurnstile(
      typeof body.turnstileToken === "string" ? body.turnstileToken : undefined,
      getClientIp(request),
      "signup",
    );
    if (!turnstile.ok) {
      return NextResponse.json(
        { error: "봇 확인에 실패했습니다. 페이지를 새로고침하고 다시 시도해주세요." },
        { status: 400 }
      );
    }

    const emailLimited = await checkRateLimitPersistent(
      rateLimitSubjectKey("signup-email", normalizeEmailForRateLimit(email)),
      {
        maxRequests: 3,
        windowMs: 60 * 60 * 1000,
      },
    );
    if (emailLimited) return emailLimited;

    const supabase = getAdminSupabase();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://hanbang.ai";
    // 사용자가 보낸 값이다. 메일에 싣기 전에 같은 출처·허용 경로인지 거른다.
    const safeRedirect = requestedRedirect
      ? getRequestedAuthRedirectPath(
          `?${new URLSearchParams({ redirect: requestedRedirect })}`,
          siteUrl,
        )
      : null;
    const consentRecord = buildSignupConsentRecord(consent, new Date().toISOString());
    // 계정과 서버 수신 증거를 함께 생성한다. createUser는 미인증 기존 계정도
    // 중복으로 거절하므로 공개 재가입 요청이 기존 동의를 바꾸지 못한다.
    let createdUserId: string;
    try {
      const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: false,
        user_metadata: { name, ...consentRecord },
        app_metadata: { signup_consent: buildSignupConsentServerEvidence(consent, consentRecord.consent_agreed_at) },
      });
      if (createError) {
        if (createError.code === "email_exists" || createError.message.includes("already been registered") || createError.message.includes("already registered")) {
          // 신규/기존 응답은 같게 유지하고 소유자에게 로그인·복구 경로만 보낸다.
          await sendExistingAccountNotice({ email, name, siteUrl, supabase });
          return NextResponse.json({ success: true, message: "인증 이메일을 발송했습니다." });
        }
        throw new Error("SIGNUP_ACCOUNT_CREATE_FAILED");
      }
      if (!created.user?.id || normalizeEmail(created.user.email) !== email) throw new Error("SIGNUP_ACCOUNT_CREATE_FAILED");
      createdUserId = created.user.id;
    } catch {
      log.error("api/auth/signup", new Error("SIGNUP_ACCOUNT_CREATE_FAILED"));
      return NextResponse.json({ error: "가입 동의를 저장하지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 503 });
    }

    // 생성 이후 링크·메일 실패는 계정을 지우거나 증거를 덮지 않는다.
    // 재시도는 위의 기존 계정 복구 안내를 이용한다.
    let data: Awaited<ReturnType<typeof supabase.auth.admin.generateLink>>["data"];
    try {
      const generated = await supabase.auth.admin.generateLink({ type: "signup", email, password });
      if (generated.error) throw new Error("SIGNUP_LINK_CREATE_FAILED");
      data = generated.data;
    } catch {
      log.error("api/auth/signup", new Error("SIGNUP_LINK_CREATE_FAILED"));
      return NextResponse.json({ error: "인증 링크를 준비하지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 503 });
    }

    if (!data?.properties?.hashed_token) {
      return NextResponse.json({ error: "인증 링크 생성에 실패했습니다." }, { status: 500 });
    }

    if (data.user?.id !== createdUserId || normalizeEmail(data.user.email) !== email) {
      return NextResponse.json({ error: "가입 동의 기록을 확인하지 못했어요. 다시 시도해 주세요." }, { status: 503 });
    }

    // 링크는 우리 라우트를 가리킨다. Supabase 의 action_link 는 결과를 해시로
    // 돌려주는데 해시는 서버에 오지 않아, 그 링크를 누른 사람은 전원
    // `/login?error=no_code` 로 떨어졌다(2026-08-22 실측).
    const confirmLink = buildEmailConfirmUrl({
      siteUrl,
      tokenHash: data.properties.hashed_token,
      type: "signup",
      redirectPath: safeRedirect,
    });
    const resend = new Resend(process.env.RESEND_API_KEY);
    const safeName = escapeHtml(name);

    // Resend는 발송 실패를 예외가 아니라 반환값으로 준다. 결과를 버리면
    // 메일이 안 갔는데도 "인증 이메일을 발송했습니다"라고 답하게 되고,
    // 사용자는 오지 않는 메일을 기다린다.
    const sendResult = await resend.emails.send({
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

    if (sendResult.error || !sendResult.data?.id) {
      console.error("Signup verification email send failed:", sendResult.error);
      return NextResponse.json(
        {
          error:
            "인증 메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, message: "인증 이메일을 발송했습니다." });
  } catch (err) {
    log.error("api/auth/signup", err);
    console.error("Signup API error:", err);
    return NextResponse.json(
      { error: "회원가입 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
