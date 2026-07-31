import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isRecord, isUuid, readBoundedUtf8Text } from "@/utils/requestValidation";

export const PAYMENT_API_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};

export const PAYMENT_API_MAX_BODY_BYTES = 8 * 1024;
export const PAYMENT_API_MAX_ENTRIES = 200;

export type PaymentScope = {
  userId: string;
  coupleId: string;
  userClient: Awaited<ReturnType<typeof createClientFromRequest>>;
  admin: ReturnType<typeof createAdminClient>;
};

export type PaymentScopeResult =
  | { ok: true; scope: PaymentScope }
  | { ok: false; response: NextResponse };

export function paymentJson(
  body: unknown,
  init: { status?: number } = {},
): NextResponse {
  return NextResponse.json(body, {
    status: init.status,
    headers: PAYMENT_API_HEADERS,
  });
}

export async function readPaymentJson(
  request: Request,
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse }
> {
  const result = await readBoundedUtf8Text(
    request,
    PAYMENT_API_MAX_BODY_BYTES,
  );
  if (!result.ok) {
    return {
      ok: false,
      response: paymentJson(
        {
          error: result.reason === "too_large"
            ? "요청 데이터가 너무 큽니다."
            : "요청 데이터를 읽지 못했습니다.",
        },
        { status: result.reason === "too_large" ? 413 : 400 },
      ),
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(result.text) as unknown;
  } catch {
    body = null;
  }
  if (!isRecord(body)) {
    return {
      ok: false,
      response: paymentJson(
        { error: "요청 형식이 올바르지 않습니다." },
        { status: 400 },
      ),
    };
  }
  return { ok: true, body };
}

/**
 * Profile pointer alone is not accepted as membership evidence. The
 * authenticated user's profile and the authoritative couple member slots must
 * agree before a service-role client is returned.
 */
export async function resolvePaymentScope(
  request: Request,
): Promise<PaymentScopeResult> {
  const userClient = await createClientFromRequest(request);
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();
  if (authError || !user) {
    return {
      ok: false,
      response: paymentJson(
        { error: "인증이 필요합니다." },
        { status: 401 },
      ),
    };
  }

  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("couple_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    return {
      ok: false,
      response: paymentJson(
        { error: "커플 연결 정보를 확인하지 못했습니다." },
        { status: 503 },
      ),
    };
  }
  if (!isRecord(profile) || !isUuid(profile.couple_id)) {
    return {
      ok: false,
      response: paymentJson(
        { error: "커플 연결 후 기록할 수 있어요." },
        { status: 409 },
      ),
    };
  }

  const admin = createAdminClient();
  const { data: couple, error: coupleError } = await admin
    .from("couples")
    .select("id, bride_id, groom_id")
    .eq("id", profile.couple_id)
    .maybeSingle();
  if (coupleError) {
    return {
      ok: false,
      response: paymentJson(
        { error: "커플 연결 정보를 확인하지 못했습니다." },
        { status: 503 },
      ),
    };
  }
  if (
    !isRecord(couple)
    || couple.id !== profile.couple_id
    || (couple.bride_id !== user.id && couple.groom_id !== user.id)
  ) {
    return {
      ok: false,
      response: paymentJson(
        { error: "현재 커플의 기록을 볼 권한이 없습니다." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    scope: {
      userId: user.id,
      coupleId: profile.couple_id,
      userClient,
      admin,
    },
  };
}
