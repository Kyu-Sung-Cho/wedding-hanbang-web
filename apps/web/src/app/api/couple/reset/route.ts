import { createClientFromRequest } from "@/lib/supabase/server";
import { log } from "@/utils/log";
import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord, readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { isConfirmedSignedOut } from "@/lib/auth/sessionFailure";

const MAX_BODY_BYTES = 4 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });

export async function POST(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return json({ error: "잘못된 요청 출처입니다." }, 403);
    }
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return json({ error: "요청 데이터가 너무 큽니다." }, 413);
    }

    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError && !isConfirmedSignedOut(authError)) return json({ error: "로그인 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
    if (!user || authError) return json({ error: "인증이 필요합니다." }, 401);

    const limited = checkRateLimit(rateLimitKey("couple:reset", request, user.id), {
      maxRequests: 5,
      windowMs: 10 * 60 * 1000,
    });
    if (limited) return limited;

    const rawBody = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
    if (!rawBody.ok) {
      return json({ error: rawBody.reason === "too_large" ? "요청 데이터가 너무 큽니다." : "요청 데이터를 읽지 못했습니다." }, rawBody.reason === "too_large" ? 413 : 400);
    }
    let body: unknown;
    try { body = JSON.parse(rawBody.text); } catch { body = null; }
    if (!isRecord(body) || body.confirmText !== "초기화합니다") {
      return json({ error: "확인 문구가 일치하지 않습니다." }, 400);
    }
    if (!Object.hasOwn(body, "expectedUserId") || !Object.hasOwn(body, "expectedCoupleId")) {
      return json({ error: "초기화를 계속하려면 웹에서는 페이지를 새로고침하고, 앱에서는 최신 버전으로 업데이트해 주세요." }, 409);
    }
    if (body.expectedUserId !== user.id || !UUID_RE.test(user.id)
      || !(body.expectedCoupleId === null || (typeof body.expectedCoupleId === "string" && UUID_RE.test(body.expectedCoupleId)))) {
      return json({ error: "계정 또는 커플 연결이 바뀌었어요. 설정 화면을 다시 열고 확인해 주세요." }, 409);
    }
    const expectedCoupleId = typeof body.expectedCoupleId === "string"
      ? body.expectedCoupleId.toLowerCase() : null;

    const { data: resetResult, error: resetError } = await supabase.rpc(
      "reset_expected_couple_membership",
      { p_expected_user_id: body.expectedUserId, p_expected_couple_id: expectedCoupleId },
    );

    if (resetError) {
      console.error("[couple/reset] atomic RPC failed", {
        code: resetError.code,
      });
      const status = resetError.code === "P0002" ? 404 : resetError.code === "P0001" ? 409 : 503;
      return json({ error: status === 404 ? "프로필을 찾을 수 없습니다." : status === 409
        ? "계정 또는 커플 연결이 바뀌었어요. 설정 화면을 다시 열고 확인해 주세요."
        : "초기화를 완료하지 못했어요. 잠시 후 다시 시도해 주세요." }, status);
    }

    if (!isRecord(resetResult) || resetResult.success !== true || resetResult.previous_couple_id !== expectedCoupleId) {
      return json({ error: "초기화 결과를 확인하지 못했어요. 설정 화면을 다시 열어 주세요." }, 503);
    }
    return json({ success: true });
  } catch (err) {
    log.error("api/couple/reset", err);
    console.error("[couple/reset] error:", err);
    return json({ error: "초기화에 실패했습니다." }, 503);
  }
}
