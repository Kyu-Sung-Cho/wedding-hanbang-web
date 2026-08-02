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
import { getTurnstileRequestHostname } from "@/lib/turnstileRequestHostname";
import {
  cleanOptionalText,
  isRecord,
  isUuid,
  normalizeEmail,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { isStrongUserPassword } from "@hanbang/shared/security/password-policy";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@hanbang/shared/constants";
import { escapeHtmlAttribute } from "@/lib/auth/passwordRecoveryLink";
import {
  getSignupSiteOrigin,
  normalizeSignupConfirmationLink,
} from "@/lib/auth/signupConfirmationLink";
import { createTrustedSignupConsentMetadata } from "@/lib/compliance/policyConsent";
import {
  createSignupConsentIntentToken,
  REVOKE_SIGNUP_CONSENT_INTENT_RPC,
  SIGNUP_CONSENT_INTENT_METADATA_KEY,
  SIGNUP_CONSENT_INTENT_RPC,
} from "@/lib/auth/signupConsentIntent";

const MAX_BODY_BYTES = 16 * 1024;

function getAdminSupabase() {
  return createAdminClient();
}

async function rollbackGeneratedSignupUser(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<void> {
  try {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) {
      console.error("Generated signup user rollback failed", safeErrorDiagnostic(error));
    }
  } catch (error) {
    console.error("Generated signup user rollback failed", safeErrorDiagnostic(error));
  }
}

async function revokeSignupConsentIntent(
  supabase: ReturnType<typeof createAdminClient>,
  token: string,
): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.rpc(
      REVOKE_SIGNUP_CONSENT_INTENT_RPC,
      { p_token: token },
    );
    if (error || typeof data !== "boolean") {
      console.error(
        "Signup consent intent revocation failed",
        safeErrorDiagnostic(error ?? new Error("Revocation response failed contract")),
      );
      return null;
    }
    return data;
  } catch (error) {
    console.error(
      "Signup consent intent revocation failed",
      safeErrorDiagnostic(error),
    );
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const ingressLimited = await checkRateLimitPersistent(
      rateLimitKey("signup:ingress", request),
      { maxRequests: 20, windowMs: 10 * 60 * 1000 },
    );
    if (ingressLimited) return ingressLimited;

    const boundedBody = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
    if (!boundedBody.ok) {
      return NextResponse.json(
        { error: boundedBody.reason === "too_large" ? "요청 본문이 너무 큽니다." : "잘못된 요청입니다." },
        { status: boundedBody.reason === "too_large" ? 413 : 400 },
      );
    }
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(boundedBody.text);
    } catch {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    if (!isRecord(parsedBody)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    const {
      email: rawEmail,
      password,
      name: rawName,
      turnstileToken,
      termsAgreed,
      privacyAgreed,
      termsVersion,
      privacyVersion,
      marketingAgreed,
    } = parsedBody;
    const email = normalizeEmail(rawEmail);
    const name = cleanOptionalText(rawName, 60);
    // 마케팅 수신 동의 기록 — 명시적 true만 동의로 저장 (미전달=false, 웹 폼은 현재 미수집)
    const marketingConsent = marketingAgreed === true;

    if (!email || !password || !name) {
      return NextResponse.json({ error: "모든 필드를 입력해주세요." }, { status: 400 });
    }
    if (
      termsAgreed !== true
      || privacyAgreed !== true
      || termsVersion !== CURRENT_TERMS_VERSION
      || privacyVersion !== CURRENT_PRIVACY_VERSION
    ) {
      return NextResponse.json(
        { error: "현재 약관을 확인하고 다시 동의해주세요." },
        { status: 400 },
      );
    }
    if (!isStrongUserPassword(password)) {
      return NextResponse.json(
        { error: "비밀번호는 8자 이상이며 대문자, 소문자, 숫자, 특수문자를 포함해야 합니다." },
        { status: 400 }
      );
    }

    // Caller-controlled client headers are not attestation. Web and mobile
    // must both present a server-verifiable Turnstile token before any admin
    // link generation or email-provider call can occur.
    const turnstile = await verifyTurnstile(
      typeof turnstileToken === "string" ? turnstileToken : undefined,
      getClientIp(request),
      "signup",
      getTurnstileRequestHostname(request),
    );
    if (!turnstile.ok) {
      return NextResponse.json(
        { error: "봇 확인에 실패했습니다. 페이지를 새로고침하고 다시 시도해주세요." },
        { status: 400 }
      );
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

    const production = process.env.NODE_ENV === "production"
      || process.env.VERCEL_ENV === "production";
    const localSiteUrl = production ? undefined : "http://localhost:3000";
    const siteOrigin = getSignupSiteOrigin(
      process.env.NEXT_PUBLIC_SITE_URL ?? localSiteUrl,
      production,
    );
    if (!siteOrigin) {
      console.error("Signup site origin is not safely configured");
      return NextResponse.json(
        { error: "회원가입 처리 중 오류가 발생했습니다." },
        { status: 500 },
      );
    }
    const callbackUrl = `${siteOrigin}/api/auth/callback`;

    const supabase = getAdminSupabase();
    const trustedConsentMetadata = createTrustedSignupConsentMetadata(marketingConsent);
    const consentIntentToken = createSignupConsentIntentToken();
    let consentIntentFailure: unknown = null;
    try {
      const { data: issued, error: issueError } = await supabase.rpc(
        SIGNUP_CONSENT_INTENT_RPC,
        {
          p_email: email,
          p_token: consentIntentToken,
          p_terms_version: CURRENT_TERMS_VERSION,
          p_privacy_version: CURRENT_PRIVACY_VERSION,
          p_marketing_agreed: marketingConsent,
        },
      );
      if (issueError || issued !== true) {
        consentIntentFailure = issueError
          ?? new Error("Signup consent intent provider response failed contract");
      }
    } catch (error) {
      consentIntentFailure = error;
    }

    if (consentIntentFailure) {
      console.error(
        "Signup consent intent issuance failed",
        safeErrorDiagnostic(consentIntentFailure),
      );
      return NextResponse.json(
        { error: "회원가입 처리 중 오류가 발생했습니다." },
        { status: 500 },
      );
    }

    let generatedLink: Awaited<ReturnType<typeof supabase.auth.admin.generateLink>>;
    try {
      generatedLink = await supabase.auth.admin.generateLink({
        type: "signup",
        email,
        password,
        options: {
          data: {
            name,
            [SIGNUP_CONSENT_INTENT_METADATA_KEY]: consentIntentToken,
          },
          redirectTo: callbackUrl,
        },
      });
    } catch (generateError) {
      await revokeSignupConsentIntent(supabase, consentIntentToken);
      console.error("generateLink error", safeErrorDiagnostic(generateError));
      return NextResponse.json(
        { error: "회원가입 처리 중 오류가 발생했습니다." },
        { status: 500 },
      );
    }

    const { data, error } = generatedLink;

    if (error) {
      await revokeSignupConsentIntent(supabase, consentIntentToken);
      // Never derive a rollback target from an error response. In particular,
      // an already-registered address belongs to an existing account.
      if (
        error.message.includes("already been registered") ||
        error.message.includes("already registered")
      ) {
        return NextResponse.json({ success: true, message: "인증 이메일을 발송했습니다." });
      }
      console.error("generateLink error", safeErrorDiagnostic(error));
      return NextResponse.json(
        { error: "회원가입 처리 중 오류가 발생했습니다." },
        { status: 400 }
      );
    }

    // Supabase documents a successful signup-link response as the user-creation
    // path. Only that success response can supply the UUID eligible for
    // compensating deletion if a later step fails.
    const generatedUser = data?.user;
    const generatedUserId = isUuid(generatedUser?.id) ? generatedUser.id : null;
    if (!generatedUser || !generatedUserId) {
      await revokeSignupConsentIntent(supabase, consentIntentToken);
      console.error("Generated signup user failed the provider contract");
      return NextResponse.json(
        { error: "회원가입 처리 중 오류가 발생했습니다." },
        { status: 500 },
      );
    }

    // A successful Before User Created hook has already deleted the intent.
    // A true result means Auth created a user without invoking/accepting the
    // hook, so delete that user and fail closed. Null means the route cannot
    // prove consumption and is treated the same way.
    const unusedIntentRevoked = await revokeSignupConsentIntent(
      supabase,
      consentIntentToken,
    );
    if (unusedIntentRevoked !== false) {
      console.error("Signup consent hook consumption could not be proven");
      await rollbackGeneratedSignupUser(supabase, generatedUserId);
      return NextResponse.json(
        { error: "회원가입 처리 중 오류가 발생했습니다." },
        { status: 500 },
      );
    }

    const existingAppMetadata = isRecord(generatedUser.app_metadata)
      ? generatedUser.app_metadata
      : {};
    let consentPersistenceFailure: unknown = null;
    try {
      const { data: consentData, error: consentError } =
        await supabase.auth.admin.updateUserById(generatedUserId, {
          // Supabase merges user metadata. A null value is the documented
          // deletion tombstone; omitting the key would retain the one-time
          // consent token in auth.users and future JWT user_metadata.
          user_metadata: {
            name,
            [SIGNUP_CONSENT_INTENT_METADATA_KEY]: null,
          },
          app_metadata: {
            ...existingAppMetadata,
            ...trustedConsentMetadata,
          },
        });
      const persistedUserMetadata = consentData.user?.user_metadata;
      const tokenRemovalProven = isRecord(persistedUserMetadata)
        && !Object.prototype.hasOwnProperty.call(
          persistedUserMetadata,
          SIGNUP_CONSENT_INTENT_METADATA_KEY,
        );
      if (consentError || !consentData.user || !tokenRemovalProven) {
        consentPersistenceFailure = consentError
          ?? new Error("Consent metadata provider response failed contract");
      }
    } catch (error) {
      consentPersistenceFailure = error;
    }

    if (consentPersistenceFailure) {
      console.error(
        "Signup consent metadata persistence failed",
        safeErrorDiagnostic(consentPersistenceFailure),
      );
      await rollbackGeneratedSignupUser(supabase, generatedUserId);
      return NextResponse.json(
        { error: "회원가입 처리 중 오류가 발생했습니다." },
        { status: 500 },
      );
    }

    const confirmLink = normalizeSignupConfirmationLink(
      data?.properties?.action_link,
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      callbackUrl,
    );
    if (!confirmLink) {
      console.error("Generated signup confirmation link failed the provider contract");
      await rollbackGeneratedSignupUser(supabase, generatedUserId);
      return NextResponse.json({ error: "인증 링크 생성에 실패했습니다." }, { status: 500 });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const safeName = escapeHtmlAttribute(name);
    const escapedConfirmLink = escapeHtmlAttribute(confirmLink);

    let resendFailure: unknown = null;
    try {
      const delivery = await resend.emails.send({
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
            <a href="${escapedConfirmLink}" style="display: inline-block; padding: 14px 40px; background: #1A1A1F; color: white; border-radius: 24px; text-decoration: none; font-size: 14px; font-weight: 500;">
              이메일 인증하기
            </a>
          </div>
          <p style="font-size: 13px; color: #928980; text-align: center; margin-bottom: 24px;">
            버튼이 작동하지 않으면 아래 링크를 복사해 브라우저에 붙여넣어주세요:
          </p>
          <p style="font-size: 12px; color: #B5ADA3; word-break: break-all; text-align: center; margin-bottom: 32px; padding: 16px; background: #FAF7F2; border-radius: 12px;">
            ${escapedConfirmLink}
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
      if (delivery.error || typeof delivery.data?.id !== "string" || !delivery.data.id.trim()) {
        resendFailure = delivery.error ?? new Error("Email provider response failed contract");
      }
    } catch (error) {
      resendFailure = error;
    }

    if (resendFailure) {
      console.error("Signup confirmation email failed", safeErrorDiagnostic(resendFailure));
      await rollbackGeneratedSignupUser(supabase, generatedUserId);
      return NextResponse.json(
        { error: "회원가입 처리 중 오류가 발생했습니다." },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, message: "인증 이메일을 발송했습니다." });
  } catch (err) {
    console.error("Signup API error", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "회원가입 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
