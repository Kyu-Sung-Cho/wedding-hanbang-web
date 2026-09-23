import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { PRIVACY_CONFIRMATION_CHANGED, readPrivacyConfirmationTarget } from "@hanbang/shared";
import { readOwnPrivacyConfirmationTarget } from "@/lib/privacy/confirmationTarget";
import { log } from "@/utils/log";

const MAX_BODY_BYTES = 4 * 1024;
const RESET_RESULT_UNKNOWN = "초기화 결과를 확인하지 못했어요. 현재 연결 상태를 다시 확인해 주세요.";

export async function GET(request: Request) {
  try {
    const client = await createClientFromRequest(request);
    const { data: { user } } = await client.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    const { data: profile, error } = await client.from("profiles").select("couple_id").eq("id", user.id).single();
    if (error || !profile?.couple_id) return NextResponse.json({ error: PRIVACY_CONFIRMATION_CHANGED }, { status: 409 });
    const confirmationTarget = await readOwnPrivacyConfirmationTarget(client, user.id, profile.couple_id);
    return NextResponse.json({ confirmationTarget }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    log.error("api/couple/reset", new Error("RESET_CONFIRMATION_UNAVAILABLE"));
    return NextResponse.json({ error: "안전한 초기화 대상을 확인하지 못했어요. 잠시 후 화면을 다시 열어 주세요." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
    }
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const limited = checkRateLimit(rateLimitKey("couple:reset", request, user.id), {
      maxRequests: 5,
      windowMs: 10 * 60 * 1000,
    });
    if (limited) return limited;

    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "잘못된 초기화 요청입니다." }, { status: 400 });
    }
    const record = body as Record<string, unknown>;
    if (record.confirmText !== "초기화합니다") {
      return NextResponse.json({ error: "확인 문구가 일치하지 않습니다." }, { status: 400 });
    }
    if (!Object.prototype.hasOwnProperty.call(record, "confirmationTarget")) {
      return NextResponse.json({
        error: "이 요청에는 확인한 초기화 대상 정보가 없어 초기화하지 않았어요. 앱을 업데이트하거나 https://hanbang.ai/settings 에 같은 계정으로 로그인해 현재 커플과 초기화 대상을 다시 확인한 뒤 진행해 주세요.",
        reason: "confirmation_required",
      }, { status: 409 });
    }
    const target = readPrivacyConfirmationTarget(record.confirmationTarget);
    if (!target || target.ownerId !== user.id) {
      return NextResponse.json({
        error: target ? PRIVACY_CONFIRMATION_CHANGED
          : "확인 대상 정보의 형식이 올바르지 않아 초기화하지 않았어요. 현재 화면을 새로 열어 초기화 대상을 다시 확인해 주세요.",
        reason: target ? "confirmation_changed" : "confirmation_invalid",
      }, { status: 409 });
    }

    const { data: receipt, error: resetError } = await supabase.rpc(
      "reset_current_couple_membership", {
        p_expected_user_id: target.ownerId,
        p_expected_couple_id: target.coupleId,
        p_expected_privacy_epoch: target.privacyEpoch,
      },
    );

    if (resetError) {
      if (resetError.code === "40001" || resetError.code === "42501") {
        return NextResponse.json({ error: PRIVACY_CONFIRMATION_CHANGED }, { status: 409 });
      }
      const status = resetError.code === "P0002" ? 404 : 503;
      if (status === 503) log.error("api/couple/reset", new Error("RESET_RPC_OUTCOME_UNKNOWN"));
      return NextResponse.json(
        { error: status === 404 ? "프로필을 찾을 수 없습니다." : RESET_RESULT_UNKNOWN },
        { status }
      );
    }

    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || receipt.success !== true || receipt.previous_couple_id !== target.coupleId) {
      log.error("api/couple/reset", new Error("RESET_RECEIPT_UNVERIFIED"));
      return NextResponse.json({ error: RESET_RESULT_UNKNOWN }, { status: 503 });
    }

    return NextResponse.json({ success: true });
  } catch {
    log.error("api/couple/reset", new Error("RESET_RESULT_UNKNOWN"));
    return NextResponse.json({ error: RESET_RESULT_UNKNOWN }, { status: 503 });
  }
}
