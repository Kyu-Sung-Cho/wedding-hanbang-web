import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const MAX_BODY_BYTES = 4 * 1024;

interface ResetBody {
  confirmText?: string;
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

    const body = (await request.json().catch(() => ({}))) as ResetBody;
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
      const status = resetError.code === "P0002" ? 404 : 500;
      return NextResponse.json(
        { error: status === 404 ? "프로필을 찾을 수 없습니다." : "초기화에 실패했습니다." },
        { status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[couple/reset] error:", err);
    return NextResponse.json({ error: "초기화에 실패했습니다." }, { status: 500 });
  }
}
