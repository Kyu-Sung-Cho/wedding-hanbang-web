import { NextResponse } from "next/server";

import { verifyMutationActorFence } from "@/lib/auth/mutationActorFence";
import { createClientFromRequest } from "@/lib/supabase/server";
import { parseAuthorizationHeader } from "@/utils/bearerAuthorization";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const MAX_BODY_BYTES = 2 * 1024;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function validPassword(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value) return false;
  const length = Array.from(value).length;
  return length >= 6
    && length <= 128
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

export async function PATCH(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return response({ error: "잘못된 요청 출처입니다." }, 403);
    }
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return response({ error: "요청 데이터가 너무 큽니다." }, 413);
    }

    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return response({ error: "인증이 필요합니다." }, 401);

    const actorFence = verifyMutationActorFence(request.headers, user.id, {
      allowLegacy: false,
    });
    if (!actorFence.ok) {
      return response({
        error: actorFence.message,
        code: actorFence.code,
      }, actorFence.status);
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("auth:password", request, user.id),
      { maxRequests: 5, windowMs: 60 * 60 * 1000 },
      { failClosed: true },
    );
    if (limited) {
      limited.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
      return limited;
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return response({ error: "요청 데이터가 너무 큽니다." }, 413);
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return response({ error: "잘못된 JSON 요청입니다." }, 400);
    }
    if (
      !isRecord(body)
      || Object.keys(body).some((key) => key !== "password" && key !== "nonce")
      || !validPassword(body.password)
      || !(
        body.nonce === undefined
        || (
          typeof body.nonce === "string"
          && body.nonce.trim() === body.nonce
          && body.nonce.length >= 1
          && body.nonce.length <= 128
          && !/[\u0000-\u001f\u007f-\u009f]/u.test(body.nonce)
        )
      )
    ) {
      return response({ error: "비밀번호는 6자 이상 128자 이하로 입력해 주세요." }, 400);
    }

    const authorization = parseAuthorizationHeader(request.headers.get("authorization"));
    if (authorization.kind !== "bearer") {
      return response({
        error: "비밀번호 변경 세션을 다시 확인해 주세요.",
        code: "PASSWORD_BEARER_REQUIRED",
      }, 400);
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return response({ error: "비밀번호를 변경하지 못했습니다." }, 503);
    }

    const authResponse = await fetch(
      new URL("/auth/v1/user", supabaseUrl).toString(),
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${authorization.token}`,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          password: body.password,
          ...(typeof body.nonce === "string" ? { nonce: body.nonce } : {}),
        }),
        cache: "no-store",
      },
    );
    const authPayload: unknown = await authResponse.json().catch(() => null);
    if (!authResponse.ok) {
      const authCode = isRecord(authPayload) && typeof authPayload.code === "string"
        ? authPayload.code
        : "unknown";
      if (authCode === "reauth_nonce_missing" || authCode === "reauthentication_needed") {
        return response({
          error: "보안을 위해 다시 로그인한 뒤 비밀번호를 변경해 주세요.",
          code: "PASSWORD_REAUTH_REQUIRED",
        }, 409);
      }
      if (authCode === "weak_password") {
        return response({ error: "더 안전한 비밀번호를 입력해 주세요." }, 400);
      }
      console.error("[auth/password] user-scoped credential update failed", {
        code: authCode,
      });
      return response({ error: "비밀번호를 변경하지 못했습니다." }, 503);
    }
    if (!isRecord(authPayload) || authPayload.id !== user.id) {
      return response({ error: "비밀번호를 변경하지 못했습니다." }, 503);
    }

    return response({ success: true });
  } catch {
    return response({ error: "비밀번호를 변경하지 못했습니다." }, 503);
  }
}
