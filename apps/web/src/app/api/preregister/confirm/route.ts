import { NextResponse } from "next/server";

import { CURRENT_PRIVACY_VERSION } from "@hanbang/shared/constants";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  CONFIRM_PREREGISTRATION_INTENT_RPC,
  decryptPreregistrationPayload,
  digestPreregistrationEmail,
  digestPreregistrationIntentToken,
  isPreregistrationIntentEncryptionConfigured,
  READ_PREREGISTRATION_INTENT_RPC,
  REVOKE_PREREGISTRATION_INTENT_RPC,
} from "@/lib/preregistration/preregistrationIntent";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import {
  isRecord,
  readBoundedJsonValue,
} from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2 * 1024;
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  Vary: "Origin, Sec-Fetch-Site",
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function isSameOriginBrowserMutation(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }
  return fetchSite === "same-origin";
}

export async function POST(request: Request) {
  if (!isSameOriginBrowserMutation(request)) {
    return json({ error: "허용되지 않은 요청 출처입니다." }, 403);
  }

  const limited = await checkRateLimitPersistent(
    rateLimitKey("preregister-confirm", request),
    { maxRequests: 30, windowMs: 60 * 60 * 1000 },
  );
  if (limited) {
    for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
      limited.headers.set(name, value);
    }
    return limited;
  }

  const bodyResult = await readBoundedJsonValue(request, MAX_BODY_BYTES);
  if (!bodyResult.ok || !isRecord(bodyResult.value)) {
    const status = !bodyResult.ok && bodyResult.reason === "too_large" ? 413 : 400;
    return json({ error: "잘못된 요청입니다." }, status);
  }
  const body = bodyResult.value;
  if (
    Object.keys(body).some((key) => key !== "token" && key !== "action")
    || (body.action !== "confirm" && body.action !== "cancel")
  ) {
    return json({ error: "잘못된 요청입니다." }, 400);
  }

  const tokenDigest = digestPreregistrationIntentToken(body.token);
  if (!tokenDigest) {
    return json({ error: "확인 링크가 유효하지 않거나 만료되었습니다." }, 410);
  }

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch (error) {
    console.error("Preregistration confirmation client failed", safeErrorDiagnostic(error));
    return json({ error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요." }, 503);
  }

  if (body.action === "cancel") {
    try {
      const { data, error } = await supabase.rpc(
        REVOKE_PREREGISTRATION_INTENT_RPC,
        { p_token_digest_hex: tokenDigest },
      );
      if (error || typeof data !== "boolean") {
        console.error(
          "Preregistration cancellation failed",
          safeErrorDiagnostic(error ?? new Error("Cancellation response failed contract")),
        );
        return json({ error: "취소 요청을 처리하지 못했습니다." }, 503);
      }
      // Idempotent and deliberately non-enumerating.
      return json({ success: true, status: "cancelled" });
    } catch (error) {
      console.error("Preregistration cancellation failed", safeErrorDiagnostic(error));
      return json({ error: "취소 요청을 처리하지 못했습니다." }, 503);
    }
  }

  if (!isPreregistrationIntentEncryptionConfigured()) {
    console.error("Preregistration intent encryption is not safely configured");
    return json({ error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요." }, 503);
  }

  try {
    const { data: envelope, error: readError } = await supabase.rpc(
      READ_PREREGISTRATION_INTENT_RPC,
      { p_token_digest_hex: tokenDigest },
    );
    if (readError) {
      console.error("Preregistration intent read failed", safeErrorDiagnostic(readError));
      return json({ error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요." }, 503);
    }
    if (typeof envelope !== "string") {
      return json({ error: "확인 링크가 유효하지 않거나 만료되었습니다." }, 410);
    }

    const payload = decryptPreregistrationPayload(envelope);
    if (!payload) {
      console.error("Preregistration intent envelope failed authentication");
      return json({ error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요." }, 503);
    }
    const emailLookupDigest = digestPreregistrationEmail(payload.email);
    if (!emailLookupDigest) {
      console.error("Preregistration email ownership digest failed");
      return json({ error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요." }, 503);
    }

    const { data: result, error: confirmError } = await supabase.rpc(
      CONFIRM_PREREGISTRATION_INTENT_RPC,
      {
        p_token_digest_hex: tokenDigest,
        p_email_lookup_digest_hex: emailLookupDigest,
        p_email: payload.email,
        p_name: payload.name,
        p_wedding_date: payload.weddingDate,
        p_role: payload.role,
        p_message: payload.message,
        p_is_beta_candidate: payload.isBetaCandidate,
        p_utm_source: payload.utmSource,
        p_utm_medium: payload.utmMedium,
        p_utm_campaign: payload.utmCampaign,
        p_privacy_version: CURRENT_PRIVACY_VERSION,
      },
    );
    if (confirmError) {
      console.error("Preregistration promotion failed", safeErrorDiagnostic(confirmError));
      return json({ error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요." }, 503);
    }
    if (result === "invalid") {
      return json({ error: "확인 링크가 유효하지 않거나 만료되었습니다." }, 410);
    }
    if (result !== "confirmed" && result !== "already_registered") {
      console.error("Preregistration promotion response failed contract");
      return json({ error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요." }, 503);
    }

    return json({ success: true, status: "confirmed" });
  } catch (error) {
    console.error("Preregistration confirmation failed", safeErrorDiagnostic(error));
    return json({ error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요." }, 503);
  }
}
