import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { cleanOptionalText, isBodyTooLarge, isRecord } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 8 * 1024;

function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function DELETE(request: Request) {
  try {
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

    // 탈퇴 사유 파싱
    const limited = checkRateLimit(rateLimitKey("auth:delete", request, user.id), {
      maxRequests: 3,
      windowMs: 60 * 60 * 1000,
    });
    if (limited) return limited;

    let reason = "unknown";
    try {
      const body = await request.json();
      reason = isRecord(body) ? cleanOptionalText(body.reason, 500) ?? "unknown" : "unknown";
    } catch {
      // body가 없을 수 있음 (하위 호환)
    }

    const admin = getAdminClient();

    // Auth 삭제가 유일한 비가역 경계다. public 테이블의 CASCADE/SET NULL
    // 제약과 빈 커플 정리 트리거가 동일 DB 트랜잭션에서 파생 데이터를
    // 처리하므로, 여기서 선삭제를 하면 Auth 실패 시 부분 데이터 손실이 난다.
    const { error: authError } = await admin.auth.admin.deleteUser(user.id);
    if (authError) {
      console.error("[auth/delete] Auth user deletion failed", {
        code: authError.code,
      });
      return NextResponse.json({ error: "계정 삭제에 실패했습니다." }, { status: 500 });
    }

    // 성공한 탈퇴만 익명 집계한다. 이메일·사용자 UUID를 남기지 않아 삭제된
    // 고객을 다시 식별할 수 없게 하며, 분석 로그 실패는 탈퇴 성공을 되돌리지 않는다.
    const { error: auditError } = await admin.from("account_deletions").insert({
      reason,
      deleted_at: new Date().toISOString(),
    });
    if (auditError) {
      console.warn("[auth/delete] anonymous deletion audit insert failed", {
        code: auditError.code,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[auth/delete] unexpected error", err);
    return NextResponse.json({ error: "계정 삭제 중 오류가 발생했습니다." }, { status: 500 });
  }
}
