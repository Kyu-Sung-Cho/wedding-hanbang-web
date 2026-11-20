import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { loadCoupleContext, type CoupleContext } from "./coupleContext";
import { AUTH_REQUIRED, UNTRUSTED_ORIGIN, apiError, withPrivateHeaders } from "./http";

/**
 * 커플 경로의 앞부분: 출처 확인(쓰기), 로그인, 요청 제한(쓰기), 커플 회원 확인.
 * 회원이 아니면 어떤 커플 정보도 읽지 않고 멈춘다.
 */

export type CoupleRequest =
  | { ok: true; supabase: SupabaseClient; context: CoupleContext }
  | { ok: false; response: NextResponse | Response };

export async function openCoupleRequest(
  request: Request,
  options: { mutation?: { key: string; perMinute: number }; journey?: boolean } = {},
): Promise<CoupleRequest> {
  if (options.mutation && !isTrustedMutationRequest(request)) return { ok: false, response: UNTRUSTED_ORIGIN() };

  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: AUTH_REQUIRED() };

  if (options.mutation) {
    const limited = await checkRateLimitPersistent(
      rateLimitKey(`invitation:${options.mutation.key}`, request, user.id),
      { maxRequests: options.mutation.perMinute, windowMs: 60_000 },
      { failClosed: true },
    );
    if (limited) return { ok: false, response: withPrivateHeaders(limited) };
  }

  const loaded = await loadCoupleContext(supabase, user.id, { journey: options.journey });
  if (!loaded.ok) return { ok: false, response: apiError(loaded.status, loaded.code, loaded.error) };
  return { ok: true, supabase, context: loaded.context };
}
