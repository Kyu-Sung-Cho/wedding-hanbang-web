import { NextResponse } from "next/server";

import {
  parseMembershipRpcResponse,
  type CoupleRole,
} from "@/lib/couples/membershipRpc";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, readBoundedJsonValue } from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

const COUPLE_LINK_RATE = { maxRequests: 10, windowMs: 10 * 60 * 1000 };
const MAX_BODY_BYTES = 2 * 1024;

export async function POST(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple_link", request, user.id),
      COUPLE_LINK_RATE,
    );
    if (limited) return limited;

    const bodyResult = await readBoundedJsonValue(request, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: bodyResult.reason === "too_large" ? "요청 데이터가 너무 큽니다." : "요청 형식이 올바르지 않습니다." },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }
    if (!isRecord(bodyResult.value)) {
      return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const inviteCode = bodyResult.value.inviteCode;
    const normalizedInviteCode =
      typeof inviteCode === "string" ? inviteCode.trim().toUpperCase() : "";

    if (!/^WH-[A-Z0-9]{6,12}$/.test(normalizedInviteCode)) {
      return NextResponse.json(
        { error: "초대 코드 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError) {
      console.error("[couple link] profile lookup failed", safeErrorDiagnostic(profileError));
      return NextResponse.json(
        { error: "프로필을 확인하지 못했습니다. 잠시 후 다시 시도해주세요." },
        { status: 500 },
      );
    }

    if (profile?.role !== "bride" && profile?.role !== "groom") {
      return NextResponse.json(
        { error: "프로필 설정을 먼저 완료해주세요." },
        { status: 400 },
      );
    }
    const role: CoupleRole = profile.role;

    const { data: joinResult, error: joinError } = await supabase.rpc("join_couple", {
      p_invite_code: normalizedInviteCode,
      p_role: role,
    });

    if (joinError) {
      console.error("[couple link] membership RPC failed", safeErrorDiagnostic(joinError));
      return NextResponse.json(
        { error: "커플 연결을 완료하지 못했습니다. 잠시 후 다시 시도해주세요." },
        { status: 500 },
      );
    }

    const membership = parseMembershipRpcResponse(joinResult, role, "join");
    if (!membership.ok) {
      console.warn("[couple link] membership rejected", { code: membership.errorCode });
      return NextResponse.json({ error: membership.message }, { status: membership.status });
    }

    return NextResponse.json({
      success: true,
      coupleId: membership.coupleId,
      inviteCode: membership.inviteCode,
      joined: membership.changed,
      idempotent: membership.idempotent,
    });
  } catch (error) {
    console.error("[couple link] unexpected error", safeErrorDiagnostic(error));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 },
    );
  }
}
