import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord, readBoundedJsonValue } from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

const MAX_BODY_BYTES = 4 * 1024;

interface ResetBody {
  confirmText?: string;
}

export async function POST(request: Request) {
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

    const limited = await checkRateLimitPersistent(rateLimitKey("couple:reset", request, user.id), {
      maxRequests: 5,
      windowMs: 10 * 60 * 1000,
    });
    if (limited) return limited;

    const bodyResult = await readBoundedJsonValue(request, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: bodyResult.reason === "too_large" ? "요청 데이터가 너무 큽니다." : "요청 형식이 올바르지 않습니다." },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }
    const body: ResetBody = isRecord(bodyResult.value)
      ? { confirmText: typeof bodyResult.value.confirmText === "string" ? bodyResult.value.confirmText : undefined }
      : {};
    if (body.confirmText !== "초기화합니다") {
      return NextResponse.json({ error: "확인 문구가 일치하지 않습니다." }, { status: 400 });
    }

    const { error: resetError } = await supabase.rpc(
      "reset_current_couple_membership"
    );

    if (resetError) {
      console.error("[couple/reset] atomic RPC failed", {
        code: resetError.code,
      });
      const status = resetError.code === "P0001" ? 429 : resetError.code === "P0002" ? 404 : 500;
      return NextResponse.json(
        {
          error:
            status === 429
              ? "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."
              : status === 404
                ? "프로필을 찾을 수 없습니다."
                : "초기화에 실패했습니다.",
        },
        { status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[couple/reset] error", safeErrorDiagnostic(err));
    return NextResponse.json({ error: "초기화에 실패했습니다." }, { status: 500 });
  }
}
