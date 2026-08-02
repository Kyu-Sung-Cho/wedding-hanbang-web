import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest } from "next/server";
import { PrivateNextResponse as NextResponse } from "@/lib/http/privateResponse";
import type { CohortEventType } from "@/types/community.types";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, isUuid, readBoundedJsonValue } from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import {
  COMMUNITY_WRITE_DENIED_MESSAGE,
  isCommunityActorWriteDenied,
} from "@/lib/community/actorWriteGate";

const MAX_BODY_BYTES = 4 * 1024;
const COHORT_EVENT_TYPES = new Set<CohortEventType>([
  "venue_booked",
  "studio_booked",
  "dress_booked",
  "makeup_booked",
  "tour_done",
  "contract_done",
  "invitation_sent",
  "progress_update",
  "wedding_done",
]);
const TIMELINE_SELECT =
  "id, room_id, user_id, event_type, description, metadata, created_at";

async function ensureActiveMember(
  supabase: Awaited<ReturnType<typeof createClientFromRequest>>,
  roomId: string,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("cohort_members")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  return !!data;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: roomId } = await params;
    if (!isUuid(roomId)) {
      return NextResponse.json({ error: "잘못된 동기방 ID입니다." }, { status: 400 });
    }
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("cohort:timeline:list", req, user.id),
      { maxRequests: 120, windowMs: 60 * 1000 },
    );
    if (limited) return limited;

    const member = await ensureActiveMember(supabase, roomId, user.id);
    if (!member) {
      return NextResponse.json(
        { error: "해당 동기방의 활성 멤버만 이용할 수 있습니다." },
        { status: 403 }
      );
    }

    const { data, error } = await supabase
      .from("cohort_timeline_events")
      .select(TIMELINE_SELECT)
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      console.error("Events GET error:", safeErrorDiagnostic(error));
      return NextResponse.json(
        { error: "이벤트를 불러오지 못했습니다." },
        { status: 500 }
      );
    }

    const events = data ?? [];
    const userIds = [...new Set(events.map((event) => event.user_id as string))];
    let userMap: Record<
      string,
      { user_id: string; nickname: string; avatar_url: string | null; rank: string }
    > = {};

    if (userIds.length > 0) {
      const { data: profiles } = await createAdminClient()
        .from("community_profiles")
        .select("user_id, nickname, avatar_url, rank")
        .in("user_id", userIds);

      if (profiles) {
        userMap = Object.fromEntries(
          profiles.map((profile) => [profile.user_id as string, profile])
        );
      }
    }

    const eventsWithUser = events.map((event) => ({
      ...event,
      user: userMap[event.user_id as string] ?? {
        user_id: event.user_id,
        nickname: "익명",
        avatar_url: null,
        rank: "sprout",
      },
    }));

    return NextResponse.json({ events: eventsWithUser });
  } catch (err) {
    console.error("Events GET error:", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!isTrustedMutationRequest(req)) {
      return NextResponse.json({ error: "허용되지 않은 요청 출처입니다." }, { status: 403 });
    }

    const { id: roomId } = await params;
    if (!isUuid(roomId)) {
      return NextResponse.json({ error: "잘못된 동기방 ID입니다." }, { status: 400 });
    }
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("cohort:timeline:create", req, user.id),
      { maxRequests: 30, windowMs: 60 * 60 * 1000 },
    );
    if (limited) return limited;

    const member = await ensureActiveMember(supabase, roomId, user.id);
    if (!member) {
      return NextResponse.json(
        { error: "해당 동기방의 활성 멤버만 이용할 수 있습니다." },
        { status: 403 }
      );
    }

    const bodyResult = await readBoundedJsonValue(req, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: bodyResult.reason === "too_large" ? "요청 본문이 너무 큽니다." : "잘못된 요청입니다." },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }
    if (!isRecord(bodyResult.value)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    const body = bodyResult.value;
    if (Object.keys(body).some((key) => key !== "event_type" && key !== "description")) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    const eventType = typeof body.event_type === "string"
      && COHORT_EVENT_TYPES.has(body.event_type as CohortEventType)
      ? body.event_type as CohortEventType
      : null;
    if (!eventType) {
      return NextResponse.json(
        { error: "올바른 이벤트 유형을 선택해주세요." },
        { status: 400 }
      );
    }

    if (
      body.description !== undefined
      && body.description !== null
      && typeof body.description !== "string"
    ) {
      return NextResponse.json({ error: "설명 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const description = typeof body.description === "string"
      ? body.description.replace(/\0/g, "").trim().slice(0, 500) || null
      : null;

    const { data, error } = await createAdminClient()
      .rpc("community_create_cohort_timeline_event_for_actor", {
        p_actor_id: user.id,
        p_room_id: roomId,
        p_event_type: eventType,
        p_description: description,
      })
      .select(TIMELINE_SELECT)
      .single();

    if (error) {
      if (isCommunityActorWriteDenied(error)) {
        return NextResponse.json(
          { error: COMMUNITY_WRITE_DENIED_MESSAGE },
          { status: 403 },
        );
      }
      console.error("Event insert error:", safeErrorDiagnostic(error));
      return NextResponse.json(
        { error: "이벤트 등록에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ event: data }, { status: 201 });
  } catch (err) {
    console.error("Event POST error:", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
