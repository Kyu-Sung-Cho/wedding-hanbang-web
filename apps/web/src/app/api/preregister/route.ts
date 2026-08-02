import { NextRequest, NextResponse } from "next/server";

import { CURRENT_PRIVACY_VERSION } from "@hanbang/shared/constants";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTurnstile, normalizeEmailForRateLimit } from "@/lib/turnstile";
import { getTurnstileRequestHostname } from "@/lib/turnstileRequestHostname";
import {
  buildPreregistrationConfirmationLink,
  createPreregistrationIntentToken,
  digestPreregistrationEmail,
  digestPreregistrationIntentToken,
  encryptPreregistrationPayload,
  PREREGISTRATION_INTENT_RPC,
  REVOKE_PREREGISTRATION_INTENT_RPC,
  type PreregistrationIntentPayload,
} from "@/lib/preregistration/preregistrationIntent";
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
  readBoundedJsonValue,
} from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { sanitizeCampaignAttribution } from "@/utils/campaignAttribution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const ROLE_VALUES = ["bride", "groom"] as const;
const ALLOWED_BODY_KEYS = new Set([
  "email",
  "name",
  "weddingDate",
  "role",
  "message",
  "isBetaCandidate",
  "turnstileToken",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "privacyAgreed",
  "privacyVersion",
]);

function getServiceClient() {
  return createAdminClient();
}

function acceptedResponse() {
  // Do not disclose whether an address already has a confirmed or pending row.
  return NextResponse.json({ success: true }, {
    status: 202,
    headers: { "Cache-Control": "no-store" },
  });
}

function errorResponse(publicErrorMessage: string, status: number) {
  return NextResponse.json({ error: publicErrorMessage }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function revokeIntent(
  supabase: ReturnType<typeof createAdminClient>,
  tokenDigest: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc(
      REVOKE_PREREGISTRATION_INTENT_RPC,
      { p_token_digest_hex: tokenDigest },
    );
    if (error || typeof data !== "boolean") {
      console.error(
        "Preregistration intent revocation failed",
        safeErrorDiagnostic(error ?? new Error("Revocation response failed contract")),
      );
      return false;
    }
    return data;
  } catch (error) {
    console.error("Preregistration intent revocation failed", safeErrorDiagnostic(error));
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return errorResponse("요청 데이터가 너무 큽니다.", 413);
    }

    const ingressLimited = await checkRateLimitPersistent(
      rateLimitKey("preregister:ingress", request),
      { maxRequests: 20, windowMs: 60 * 60 * 1000 },
    );
    if (ingressLimited) return ingressLimited;

    const bodyResult = await readBoundedJsonValue(request, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      return errorResponse(
        bodyResult.reason === "too_large" ? "요청 데이터가 너무 큽니다." : "잘못된 요청입니다.",
        bodyResult.reason === "too_large" ? 413 : 400,
      );
    }
    const body = bodyResult.value;
    if (
      !isRecord(body)
      || Object.keys(body).some((key) => !ALLOWED_BODY_KEYS.has(key))
    ) {
      return errorResponse("잘못된 요청입니다.", 400);
    }

    const email = normalizeEmailForRateLimit(normalizeEmail(body.email) ?? "");
    const name = cleanOptionalText(body.name, 60);
    const weddingDate = cleanOptionalIsoDate(body.weddingDate);
    const role = cleanOptionalEnum(body.role, ROLE_VALUES);
    const message = cleanOptionalText(body.message, 500);
    const isBetaCandidate = cleanOptionalBoolean(body.isBetaCandidate);

    if (!email) {
      return errorResponse("유효한 이메일을 입력해주세요.", 400);
    }
    if (!role) {
      return errorResponse("역할을 선택해주세요.", 400);
    }
    if (body.weddingDate !== undefined && weddingDate === undefined) {
      return errorResponse("결혼 예정일 형식이 올바르지 않습니다.", 400);
    }
    if (
      body.privacyAgreed !== true
      || body.privacyVersion !== CURRENT_PRIVACY_VERSION
    ) {
      return errorResponse("현재 개인정보 수집·이용 내용을 확인하고 동의해주세요.", 400);
    }

    const turnstile = await verifyTurnstile(
      typeof body.turnstileToken === "string" ? body.turnstileToken : null,
      getClientIp(request),
      "preregister",
      getTurnstileRequestHostname(request),
    );
    if (!turnstile.ok) {
      return errorResponse(
        "봇 확인에 실패했습니다. 새로고침 후 다시 시도해주세요.",
        400,
      );
    }

    const ipLimited = await checkRateLimitPersistent(
      rateLimitKey("preregister", request),
      { maxRequests: 10, windowMs: 60 * 60 * 1000 },
    );
    if (ipLimited) return ipLimited;

    const emailLimited = await checkRateLimitPersistent(
      rateLimitSubjectKey("preregister-email", email),
      { maxRequests: 3, windowMs: 24 * 60 * 60 * 1000 },
    );
    if (emailLimited) return emailLimited;

    const url = new URL(request.url);
    const payload: PreregistrationIntentPayload = {
      email,
      name,
      weddingDate: weddingDate ?? null,
      role,
      message,
      isBetaCandidate,
      utmSource:
        sanitizeCampaignAttribution(body.utmSource, 80)
        ?? sanitizeCampaignAttribution(url.searchParams.get("utm_source"), 80),
      utmMedium:
        sanitizeCampaignAttribution(body.utmMedium, 80)
        ?? sanitizeCampaignAttribution(url.searchParams.get("utm_medium"), 80),
      utmCampaign:
        sanitizeCampaignAttribution(body.utmCampaign, 120)
        ?? sanitizeCampaignAttribution(url.searchParams.get("utm_campaign"), 120),
      privacyVersion: CURRENT_PRIVACY_VERSION,
    };

    const rawToken = createPreregistrationIntentToken();
    const tokenDigest = digestPreregistrationIntentToken(rawToken);
    const emailLookupDigest = digestPreregistrationEmail(email);
    const payloadEnvelope = encryptPreregistrationPayload(payload);
    const confirmationLink = buildPreregistrationConfirmationLink(rawToken);
    if (!tokenDigest || !emailLookupDigest || !payloadEnvelope || !confirmationLink) {
      console.error("Preregistration intent secrets are not safely configured");
      return errorResponse("인증 메일을 준비하지 못했습니다. 잠시 후 다시 시도해주세요.", 503);
    }

    const supabase = getServiceClient();
    let issueFailure: unknown = null;
    try {
      const { data, error } = await supabase.rpc(PREREGISTRATION_INTENT_RPC, {
        p_token_digest_hex: tokenDigest,
        p_email_lookup_digest_hex: emailLookupDigest,
        p_payload_envelope: payloadEnvelope,
        p_privacy_version: CURRENT_PRIVACY_VERSION,
        p_consent_confirmed: true,
      });
      if (error || data !== true) {
        issueFailure = error ?? new Error("Intent issuance response failed contract");
      }
    } catch (error) {
      issueFailure = error;
    }
    if (issueFailure) {
      console.error("Preregistration intent issuance failed", safeErrorDiagnostic(issueFailure));
      return errorResponse("인증 메일을 준비하지 못했습니다. 잠시 후 다시 시도해주세요.", 503);
    }

    const { sendPreregistrationConfirmationEmail } = await import("@/lib/resend");
    const delivered = await sendPreregistrationConfirmationEmail(email, confirmationLink);
    if (!delivered) {
      await revokeIntent(supabase, tokenDigest);
      return errorResponse("인증 메일을 보내지 못했습니다. 잠시 후 다시 시도해주세요.", 503);
    }

    return acceptedResponse();
  } catch (error) {
    console.error("Preregistration API error", safeErrorDiagnostic(error));
    return errorResponse("서버 오류가 발생했습니다.", 500);
  }
}
