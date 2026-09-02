import { NextResponse } from "next/server";
import { log } from "@/utils/log";
import { Resend } from "resend";
import { buildSignupConsentRecord, parseSignupConsent } from "@hanbang/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  checkRateLimitPersistent,
  getClientIp,
  rateLimitKey,
  rateLimitSubjectKey,
} from "@/utils/rateLimit";
import { verifyTurnstile, normalizeEmailForRateLimit } from "@/lib/turnstile";
import {
  classifyEmailDeliveryFailure,
  emailDeliveryLogLine,
  emailDeliveryMissingReceiptFailure,
  findEmailDeliveryConfigFailure,
  redactProviderDetail,
  type EmailDeliveryFailure,
} from "@/lib/email/deliveryFailure";
import { ACCOUNT_EMAIL_SENDER } from "@/lib/email/sender";
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
 * 밖에서 보는 응답은 신규 가입과 완전히 같아야 한다 — 계정 존재 여부가 새면 안 된다.
 * 그래서 링크를 못 만들었거나 예상 못 한 예외가 났으면 조용히 끝낸다.
 *
 * **발송 실패만은 올린다.** 예전에는 그것까지 삼켜서, 제공자가 죽어 있는 동안
 * 신규 주소는 502 를 받고 기존 주소는 "인증 이메일을 발송했습니다"를 받았다.
 * 그 차이 자체가 계정 존재 여부를 알려 주는 신호였고, 동시에 아무것도 오지 않을
 * 사람에게 왔다고 말하는 거짓말이었다. 지금은 두 경로가 같은 실패 객체를 돌려주므로
 * 응답이 갈라지지 않는다 — 판정이 제공자 오류만 보고 계정은 보지 않기 때문이다.
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
}): Promise<EmailDeliveryFailure | null> {
  try {
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

    const sendResult = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: ACCOUNT_EMAIL_SENDER,
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

    if (sendResult.error || !sendResult.data?.id) {
      const failure = sendResult.error
        ? classifyEmailDeliveryFailure(sendResult.error)
        : emailDeliveryMissingReceiptFailure();
      log.error(
        emailDeliveryLogLine("api/auth/signup#existing", failure, sendResult.error),
        redactProviderDetail(sendResult.error),
      );
      return failure;
    }

    return null;
  } catch (sendError) {
    // 발송 실패가 아닌 사고(링크 생성·SDK 구성 등)는 여기서 끝낸다. 여기서 응답을
    // 바꾸면 계정이 있는 주소만 다르게 답하게 된다.
    console.error("existing account notice failed:", sendError);
    return null;
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

    // 계정을 만들기 **전에** 메일을 보낼 수 있는 배포인지 본다.
    //
    // 키가 없으면 `new Resend(undefined)` 가 생성자에서 던지는데, 그 자리는 이미
    // generateLink 가 계정을 만든 뒤다. 그러면 사용자는 "회원가입 처리 중 오류"라는
    // 엉뚱한 문장을 보고, 인증할 수단이 없는 계정만 남는다. 순서를 바꾸면 그 계정이
    // 아예 생기지 않는다.
    const configFailure = findEmailDeliveryConfigFailure();
    if (configFailure) {
      log.error(emailDeliveryLogLine("api/auth/signup", configFailure));
      return NextResponse.json(
        { error: configFailure.message, code: configFailure.code },
        { status: configFailure.status },
      );
    }

    const supabase = getAdminSupabase();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://hanbang.ai";
    // 사용자가 보낸 값이다. 메일에 싣기 전에 같은 출처·허용 경로인지 거른다.
    const safeRedirect = requestedRedirect
      ? getRequestedAuthRedirectPath(
          `?${new URLSearchParams({ redirect: requestedRedirect })}`,
          siteUrl,
        )
      : null;
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "signup",
      email,
      password,
      options: {
        // 무엇에, 어느 판에, 언제 동의했는지 남긴다. 동의를 받았다는 주장만
        // 있고 기록이 없으면 받지 않은 것과 같다. 기록의 모양은 공유 계약이
        // 만든다 — /api/auth/consent(소셜 경로)와 갈라지면 안 된다.
        data: {
          name,
          ...buildSignupConsentRecord(consent, new Date().toISOString()),
        },
      },
    });

    if (error) {
      if (
        error.message.includes("already been registered") ||
        error.message.includes("already registered")
      ) {
        // 응답은 신규 가입과 똑같이 유지한다 — 여기서 "이미 가입된 이메일"이라고 답하면
        // 어떤 주소가 우리 서비스에 있는지 밖에서 확인할 수 있게 된다.
        //
        // 그런데 예전에는 응답만 같고 메일을 **아무것도 보내지 않았다**. 예전에 가입한
        // 걸 잊고 다시 가입한 사람은 "가입 확인 이메일을 보냈어요"를 보고 받은편지함을
        // 계속 새로고침했고, 로그인하면 "이메일 인증이 완료되지 않았습니다" 한 줄만
        // 나왔다. 재발송 수단도 없어 가입도 로그인도 못 하는 상태에 갇혔다.
        //
        // 그래서 응답은 그대로 두고 계정 주인에게 실제로 길을 보낸다. 이 경로가
        // 곧 재발송 경로이기도 하다 — 같은 주소로 다시 가입을 시도하면 메일이 온다.
        const noticeFailure = await sendExistingAccountNotice({
          email,
          name,
          siteUrl,
          supabase,
        });
        if (noticeFailure) {
          return NextResponse.json(
            { error: noticeFailure.message, code: noticeFailure.code },
            { status: noticeFailure.status },
          );
        }
        return NextResponse.json({ success: true, message: "인증 이메일을 발송했습니다." });
      }
      console.error("generateLink error:", error);
      return NextResponse.json(
        { error: "회원가입 처리 중 오류가 발생했습니다." },
        { status: 400 }
      );
    }

    if (!data?.properties?.hashed_token) {
      return NextResponse.json({ error: "인증 링크 생성에 실패했습니다." }, { status: 500 });
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
      from: ACCOUNT_EMAIL_SENDER,
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
      // 무엇이 실패했는지에 따라 사용자가 할 수 있는 일이 다르다. 설정이 원인인데
      // "잠시 후 다시 시도해 주세요"라고 답하면, 그 사람은 될 리 없는 일을 반복한다.
      const failure = sendResult.error
        ? classifyEmailDeliveryFailure(sendResult.error)
        : emailDeliveryMissingReceiptFailure();
      log.error(
        emailDeliveryLogLine("api/auth/signup", failure, sendResult.error),
        redactProviderDetail(sendResult.error),
      );
      return NextResponse.json(
        { error: failure.message, code: failure.code },
        { status: failure.status },
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
