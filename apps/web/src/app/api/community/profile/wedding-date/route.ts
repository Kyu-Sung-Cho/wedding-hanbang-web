import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/utils/log";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import { readCohortAssignmentBody } from "@/lib/community/cohortAssignment";
import { monthToQuarter, quarterToMonth } from "@/utils/quarter";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";

function getServiceClient() {
  return createAdminClient();
}

export async function POST(req: NextRequest) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
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
      rateLimitKey("community:profile:wedding-date", req, user.id),
      { maxRequests: 10, windowMs: 60_000 },
    );
    if (limited) return limited;

    const writeAccess = await checkCommunityWriteAccess(authClient, user.id);
    if (!writeAccess.allowed) {
      return NextResponse.json(
        { error: writeAccess.message, code: writeAccess.code },
        { status: writeAccess.status },
      );
    }

    const body = await readCohortAssignmentBody(req);
    if (!body.ok) {
      return NextResponse.json(
        { error: "올바른 결혼 시기를 입력해주세요." },
        { status: body.status, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const supabase = getServiceClient();
    const { year, month } = body;
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
    if (assignmentError || typeof roomId !== "string") {
      console.error("Atomic wedding-date cohort assignment error:", assignmentError);
      return NextResponse.json(
        { error: "결혼 시기와 동기방을 안전하게 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    return NextResponse.json({
      room_id: roomId,
      year,
      quarter,
      month: normalizedMonth,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    log.error("api/community/profile/wedding-date", err);
    console.error("wedding-date POST error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
