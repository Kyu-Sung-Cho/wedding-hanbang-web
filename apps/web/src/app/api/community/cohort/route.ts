import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import { readCohortAssignmentBody } from "@/lib/community/cohortAssignment";
import { cohortRoomName, monthToQuarter, quarterToMonth } from "@/utils/quarter";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";

function getServiceClient() {
  return createAdminClient();
}

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  try {
    const authClient = await createClientFromRequest(request);
    const {
      data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { room: null },
        { status: 200, headers: PRIVATE_NO_STORE },
      );
    }

    const supabase = getServiceClient();

    const { data: memberships } = await supabase
      .from("cohort_members")
      .select("room_id, joined_at")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("joined_at", { ascending: false });

    if (!memberships || memberships.length === 0) {
      return NextResponse.json(
        { room: null },
        { status: 200, headers: PRIVATE_NO_STORE },
      );
    }

    if (memberships.length !== 1) {
      return NextResponse.json(
        {
          room: null,
          error: "동기방 연결이 여러 개라 안전하게 하나를 고를 수 없어요. 다시 배정해 주세요.",
          code: "COHORT_MEMBERSHIP_CONFLICT",
        },
        {
          status: 409,
          headers: { "Cache-Control": "private, no-store, max-age=0" },
        },
      );
    }

    const roomIds = [...new Set(memberships.map((m) => m.room_id as string))];
    const { data: rooms } = await supabase
      .from("cohort_rooms")
      .select("*")
      .in("id", roomIds)
      .eq("is_active", true);

    if (!rooms || rooms.length === 0) {
      return NextResponse.json(
        { room: null },
        { status: 200, headers: PRIVATE_NO_STORE },
      );
    }

    const { data: profile } = await supabase
      .from("community_profiles")
      .select("wedding_year, wedding_month")
      .eq("user_id", user.id)
      .maybeSingle();

    const desiredMonth = profile?.wedding_month
      ? quarterToMonth(monthToQuarter(profile.wedding_month as number))
      : null;

    const selectedRoom =
      profile?.wedding_year && desiredMonth
        ? rooms.find(
            (room) =>
              room.year === profile.wedding_year && room.month === desiredMonth
          ) ?? rooms[0]
        : rooms[0];

    const normalizedRoom = {
      ...selectedRoom,
      name: cohortRoomName(
        selectedRoom.year as number,
        selectedRoom.month as number,
        selectedRoom.room_number as number
      ),
    };

    const { data: memberRows } = await supabase
      .from("cohort_members")
      .select("id, user_id, joined_at")
      .eq("room_id", selectedRoom.id)
      .eq("is_active", true)
      .order("joined_at", { ascending: false })
      .limit(8);

    const memberUserIds = (memberRows ?? []).map((m) => m.user_id as string);
    let memberProfiles: Record<
      string,
      { user_id: string; nickname: string; avatar_url: string | null; rank: string }
    > = {};

    if (memberUserIds.length > 0) {
      const { data: profiles } = await supabase
        .from("community_profiles")
        .select("user_id, nickname, avatar_url, rank")
        .in("user_id", memberUserIds);

      if (profiles) {
        memberProfiles = Object.fromEntries(
          profiles.map((profileRow) => [profileRow.user_id as string, profileRow])
        );
      }
    }

    const members = (memberRows ?? []).map((member) => ({
      ...member,
      profile: memberProfiles[member.user_id as string] ?? null,
    }));

    const { data: lastMsg } = await supabase
      .from("cohort_messages")
      .select("id, content, created_at, author_id")
      .eq("room_id", selectedRoom.id)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json(
      {
        room: normalizedRoom,
        recentMembers: members,
        lastMessage: lastMsg?.content ?? null,
      },
      { headers: PRIVATE_NO_STORE },
    );
  } catch (err) {
    console.error("Cohort GET error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500, headers: PRIVATE_NO_STORE },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "올바르지 않은 요청 출처입니다." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
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
      { maxRequests: 10, windowMs: 60_000 },
    );
    if (limited) return limited;

    const writeAccess = await checkCommunityWriteAccess(authClient, user.id);
    if (!writeAccess.allowed) {
      return NextResponse.json(
        { error: writeAccess.message, code: writeAccess.code },
        { status: writeAccess.status }
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
      console.error("Atomic cohort assignment error:", assignmentError);
      return NextResponse.json(
        { error: "동기방을 안전하게 배정하지 못했습니다. 잠시 후 다시 시도해 주세요." },
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
    console.error("Cohort POST error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
