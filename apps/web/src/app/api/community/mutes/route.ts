import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { getCommunityUserIdForActor } from "@/lib/community/actorIdentity";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord, isUuid } from "@/utils/requestValidation";

const MAX_MUTE_BODY_BYTES = 4 * 1024;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

async function authenticatedUser(req: NextRequest) {
  const supabase = await createClientFromRequest(req);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) return { user: null, response: NextResponse.json(
    { error: "로그인 상태를 확인하지 못했습니다." },
    { status: 503, headers: NO_STORE_HEADERS },
  ) };
  if (!user) return { user: null, response: NextResponse.json(
    { error: "인증이 필요합니다." },
    { status: 401, headers: NO_STORE_HEADERS },
  ) };
  return { user, response: null };
}

type TargetUserIdResult =
  | { ok: true; userId: string }
  | { ok: false; status: 400 | 413 };

async function parseTargetActorId(req: NextRequest): Promise<TargetUserIdResult> {
  if (isBodyTooLarge(req, MAX_MUTE_BODY_BYTES)) return { ok: false, status: 413 };
  const body = await req.json().catch(() => null);
  if (
    !isRecord(body) ||
    !isUuid(body.userId) ||
    Object.keys(body).some((key) => key !== "userId")
  ) {
    return { ok: false, status: 400 };
  }
  return { ok: true, userId: body.userId };
}

async function resolveTargetUserId(publicActorId: string) {
  try {
    return { userId: await getCommunityUserIdForActor(publicActorId), unavailable: false };
  } catch {
    return { userId: null, unavailable: true };
  }
}

export async function GET(req: NextRequest) {
  const { user, response } = await authenticatedUser(req);
  if (!user) return response!;

  const limited = await checkRateLimitPersistent(
    rateLimitKey("community:mutes:read", req, user.id),
    { maxRequests: 60, windowMs: 60 * 1000 },
    user.id,
  );
  if (limited) return limited;

  const admin = createAdminClient();
  const { data: muteRows, error: muteError } = await admin
    .from("community_user_mutes")
    .select("muted_user_id, created_at")
    .eq("muter_id", user.id)
    .order("created_at", { ascending: false });
  if (muteError) {
    return NextResponse.json(
      { error: "숨긴 작성자 목록을 불러오지 못했습니다." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const ids = (muteRows ?? []).map((row) => row.muted_user_id as string);
  const { data: profiles, error: profileError } = ids.length > 0
    ? await admin
        .from("community_profiles")
        .select("user_id, public_actor_id, nickname")
        .in("user_id", ids)
    : { data: [], error: null };
  if (profileError) {
    return NextResponse.json(
      { error: "숨긴 작성자 목록을 불러오지 못했습니다." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const profileByInternalId = new Map(
    (profiles ?? []).map((profile) => [profile.user_id as string, profile]),
  );
  if (
    profileByInternalId.size !== ids.length ||
    ids.some((id) => typeof profileByInternalId.get(id)?.public_actor_id !== "string")
  ) {
    return NextResponse.json(
      { error: "숨긴 작성자 목록을 불러오지 못했습니다." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  const users = (muteRows ?? []).map((row) => {
    const profile = profileByInternalId.get(row.muted_user_id as string);
    return {
      id: profile!.public_actor_id as string,
      nickname: profile!.nickname as string,
      mutedAt: row.created_at as string,
    };
  });

  return NextResponse.json({ users }, { headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  const { user, response } = await authenticatedUser(req);
  if (!user) return response!;

  const limited = await checkRateLimitPersistent(
    rateLimitKey("community:mutes:create", req, user.id),
    { maxRequests: 20, windowMs: 60 * 60 * 1000 },
    user.id,
  );
  if (limited) return limited;

  const target = await parseTargetActorId(req);
  if (!target.ok) {
    return NextResponse.json(
      { error: target.status === 413 ? "요청 데이터가 너무 큽니다." : "숨길 작성자를 확인해주세요." },
      { status: target.status, headers: NO_STORE_HEADERS },
    );
  }
  const resolvedTarget = await resolveTargetUserId(target.userId);
  if (resolvedTarget.unavailable) {
    return NextResponse.json(
      { error: "작성자 상태를 확인하지 못했습니다." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  const targetUserId = resolvedTarget.userId;
  if (!targetUserId) {
    return NextResponse.json(
      { error: "작성자를 찾을 수 없습니다." },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  if (targetUserId === user.id) {
    return NextResponse.json(
      { error: "본인은 숨길 수 없습니다." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const { error } = await createAdminClient()
    .from("community_user_mutes")
    .insert({ muter_id: user.id, muted_user_id: targetUserId });
  if (error && error.code !== "23505") {
    const status = error.code === "23503" ? 404 : 503;
    return NextResponse.json(
      { error: status === 404 ? "작성자를 찾을 수 없습니다." : "작성자를 숨기지 못했습니다." },
      { status, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json({ muted: true }, { headers: NO_STORE_HEADERS });
}

export async function DELETE(req: NextRequest) {
  const { user, response } = await authenticatedUser(req);
  if (!user) return response!;

  const limited = await checkRateLimitPersistent(
    rateLimitKey("community:mutes:delete", req, user.id),
    { maxRequests: 30, windowMs: 60 * 60 * 1000 },
    user.id,
  );
  if (limited) return limited;

  const target = await parseTargetActorId(req);
  if (!target.ok) {
    return NextResponse.json(
      {
        error:
          target.status === 413
            ? "요청 데이터가 너무 큽니다."
            : "숨김을 해제할 작성자를 확인해주세요.",
      },
      { status: target.status, headers: NO_STORE_HEADERS },
    );
  }
  const resolvedTarget = await resolveTargetUserId(target.userId);
  if (resolvedTarget.unavailable) {
    return NextResponse.json(
      { error: "작성자 상태를 확인하지 못했습니다." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  const targetUserId = resolvedTarget.userId;
  if (!targetUserId) {
    return NextResponse.json(
      { error: "작성자를 찾을 수 없습니다." },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  const { error } = await createAdminClient()
    .from("community_user_mutes")
    .delete()
    .eq("muter_id", user.id)
    .eq("muted_user_id", targetUserId);
  if (error) {
    return NextResponse.json(
      { error: "작성자 숨김을 해제하지 못했습니다." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json({ muted: false }, { headers: NO_STORE_HEADERS });
}
