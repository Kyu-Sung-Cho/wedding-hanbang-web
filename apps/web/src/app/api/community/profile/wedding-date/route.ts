import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { PrivateNextResponse as NextResponse } from "@/lib/http/privateResponse";
import { monthToQuarter, quarterToMonth } from "@/utils/quarter";
import { isRecord, isUuid, readBoundedJsonValue } from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import {
  COMMUNITY_WRITE_DENIED_MESSAGE,
  isCommunityActorWriteDenied,
} from "@/lib/community/actorWriteGate";

const MAX_BODY_BYTES = 2 * 1024;

function getServiceClient() {
  return createAdminClient();
}

export async function POST(req: NextRequest) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "허용되지 않은 요청 출처입니다." },
      { status: 403 },
    );
  }

  try {
    const authClient = await createClientFromRequest(req);
    const {
      data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:cohort:assign", req, user.id),
      { maxRequests: 10, windowMs: 10 * 60 * 1000 },
      { failClosed: true },
    );
    if (limited) return limited;

    const bodyResult = await readBoundedJsonValue(req, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: bodyResult.reason === "too_large" ? "요청 본문이 너무 큽니다." : "잘못된 요청입니다." },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }
    const body = bodyResult.value;
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    const { year, month } = body;

    if (
      typeof year !== "number" ||
      typeof month !== "number" ||
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12 ||
      year < 2020 ||
      year > 2100
    ) {
      return NextResponse.json(
        { error: "올바른 결혼 시기를 입력해주세요." },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();
    const quarter = monthToQuarter(month);
    const normalizedMonth = quarterToMonth(quarter);

    const { data: roomId, error: assignmentError } = await supabase.rpc(
      "community_assign_cohort",
      {
        p_user_id: user.id,
        p_year: year,
        p_month: normalizedMonth,
      },
    );

    if (assignmentError && isCommunityActorWriteDenied(assignmentError)) {
      return NextResponse.json(
        { error: COMMUNITY_WRITE_DENIED_MESSAGE },
        { status: 403 },
      );
    }

    if (assignmentError || typeof roomId !== "string" || !isUuid(roomId)) {
      console.error(
        "Cohort assignment RPC error:",
        safeErrorDiagnostic(assignmentError ?? new Error("invalid cohort room id")),
      );
      return NextResponse.json(
        { error: "동기방 입장에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      room_id: roomId,
      year,
      quarter,
      month: normalizedMonth,
    });
  } catch (err) {
    console.error("wedding-date POST error:", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
