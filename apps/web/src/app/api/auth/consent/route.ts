import { NextResponse } from "next/server";
import { log } from "@/utils/log";

import {
  buildSignupConsentRecord,
  parseSignupConsent,
} from "@hanbang/shared";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const MAX_BODY_BYTES = 4 * 1024;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

/**
 * 이미 있는 계정에 필수 동의를 기록한다.
 *
 * 왜 별도 라우트인가: 이메일 가입은 /api/auth/signup 이 계정을 만들면서 함께
 * 기록하지만, **소셜 로그인은 Supabase 가 계정을 직접 만든다.** 그 경로로
 * 들어온 사람은 동의 화면을 본 적도 없고 기록도 없다. 계정이 이미 존재하는
 * 상태에서 동의만 받아 붙여야 한다.
 *
 * 세션이 있어야 한다 — 누구의 계정에 붙일지는 요청 본문이 아니라 세션이
 * 정한다. 본문으로 사용자를 지목하게 두면 남의 계정에 동의를 심을 수 있다.
 */
export async function POST(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json(
        { error: "잘못된 요청 출처입니다." },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json(
        { error: "요청 데이터가 너무 큽니다." },
        { status: 413, headers: NO_STORE_HEADERS },
      );
    }

    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("auth:consent", request, user.id),
      { maxRequests: 10, windowMs: 60 * 60 * 1000 },
    );
    if (limited) return limited;

    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    if (!isRecord(body)) {
      return NextResponse.json(
        { error: "잘못된 요청입니다." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const consent = parseSignupConsent(body);
    if (!consent) {
      return NextResponse.json(
        {
          error: "이용약관과 개인정보 처리방침에 동의해야 계속할 수 있어요.",
          code: "SIGNUP_CONSENT_REQUIRED",
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    // 기존 메타데이터를 덮어쓰지 않는다. 이름·마케팅 동의 같은 것이 이미
    // 들어 있고, updateUserById 는 user_metadata 를 통째로 교체한다.
    const admin = createAdminClient();
    const record = buildSignupConsentRecord(consent, new Date().toISOString());
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...(user.user_metadata ?? {}), ...record },
    });

    if (error) {
      // 내부 오류 원문을 사용자에게 돌려주지 않는다.
      console.error("[auth/consent] 동의 기록 실패", { code: error.status ?? "unknown" });
      return NextResponse.json(
        { error: "동의를 저장하지 못했어요. 잠시 후 다시 시도해 주세요." },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    log.error("api/auth/consent", err);
    console.error("[auth/consent] 예외", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "동의 처리 중 오류가 발생했습니다." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
