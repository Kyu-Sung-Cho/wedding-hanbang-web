import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  getCommunityNicknameFallback,
  isCommunityNicknameUniqueViolation,
  normalizeCommunityNickname,
  validateCommunityNickname,
} from "@/lib/community/nickname";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import {
  cleanOptionalKoreanMobile,
  cleanOptionalText,
  isBodyTooLarge,
  isRecord,
} from "@/utils/requestValidation";

const MAX_BODY_BYTES = 8 * 1024;

function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type AdminClient = ReturnType<typeof getAdminClient>;
type CommunityNicknameSyncResult =
  | { synced: boolean }
  | { error: { message: string; status: number } };

async function hasDuplicateCommunityNickname(
  admin: AdminClient,
  userId: string,
  nickname: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("community_profiles")
    .select("user_id")
    .eq("nickname", nickname)
    .neq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("Community nickname duplicate lookup failed; relying on DB constraint:", error);
    return false;
  }

  return Boolean(data);
}

async function countVisibleCommunityPosts(admin: AdminClient, userId: string): Promise<number> {
  const { count, error } = await admin
    .from("community_posts")
    .select("id", { count: "exact", head: true })
    .eq("author_id", userId)
    .in("visibility", ["public", "members"])
    .eq("under_review", false);

  if (error) {
    console.warn("Community post count lookup failed during profile sync:", error);
  }

  return count ?? 0;
}

async function countActiveCommunityComments(admin: AdminClient, userId: string): Promise<number> {
  const { count, error } = await admin
    .from("community_comments")
    .select("id", { count: "exact", head: true })
    .eq("author_id", userId)
    .eq("is_deleted", false);

  if (error) {
    console.warn("Community comment count lookup failed during profile sync:", error);
  }

  return count ?? 0;
}

async function createCommunityProfileForSync(
  admin: AdminClient,
  userId: string,
  nickname: string
): Promise<CommunityNicknameSyncResult> {
  const [postCount, commentCount] = await Promise.all([
    countVisibleCommunityPosts(admin, userId),
    countActiveCommunityComments(admin, userId),
  ]);

  const { error } = await admin.from("community_profiles").insert({
    user_id: userId,
    nickname,
    badge: "member",
    post_count: postCount,
    comment_count: commentCount,
    total_upvotes_received: 0,
  });

  if (error) {
    if (isCommunityNicknameUniqueViolation(error)) {
      return { error: { message: "이미 사용 중인 닉네임입니다.", status: 409 } };
    }

    console.warn("Community profile create failed during profile sync:", error);
    return { error: { message: "커뮤니티 프로필 저장에 실패했습니다.", status: 500 } };
  }

  return { synced: true };
}

async function syncCommunityNicknameIfDefault(
  admin: AdminClient,
  userId: string,
  nextName: string,
  previousName: string | null,
  forceSync: boolean
): Promise<CommunityNicknameSyncResult> {
  const { data: communityProfile, error: communityProfileError } = await admin
    .from("community_profiles")
    .select("nickname")
    .eq("user_id", userId)
    .maybeSingle();

  if (communityProfileError) {
    console.warn("Community profile lookup failed during profile sync:", communityProfileError);
    return { synced: false };
  }

  const currentNickname =
    typeof communityProfile?.nickname === "string"
      ? communityProfile.nickname.trim()
      : null;

  if (!currentNickname && !forceSync) return { synced: false };

  const nicknameValidation = validateCommunityNickname(nextName);
  if (!nicknameValidation.ok) {
    return { error: { message: nicknameValidation.message, status: 400 } };
  }

  const previousNickname = normalizeCommunityNickname(previousName);
  const isDefaultNickname =
    currentNickname === previousName?.trim() ||
    currentNickname === previousNickname ||
    currentNickname === "익명" ||
    currentNickname === getCommunityNicknameFallback(userId);

  if ((!forceSync && !isDefaultNickname) || currentNickname === nicknameValidation.nickname) {
    return { synced: false };
  }

  if (await hasDuplicateCommunityNickname(admin, userId, nicknameValidation.nickname)) {
    return { error: { message: "이미 사용 중인 닉네임입니다.", status: 409 } };
  }

  if (!currentNickname) {
    return createCommunityProfileForSync(admin, userId, nicknameValidation.nickname);
  }

  const { error: updateError } = await admin
    .from("community_profiles")
    .update({ nickname: nicknameValidation.nickname })
    .eq("user_id", userId);

  if (updateError) {
    if (isCommunityNicknameUniqueViolation(updateError)) {
      return { error: { message: "이미 사용 중인 닉네임입니다.", status: 409 } };
    }

    console.warn("Community nickname sync failed:", updateError);
    return { error: { message: "커뮤니티 닉네임 저장에 실패했습니다.", status: 500 } };
  }

  return { synced: true };
}

export async function PATCH(request: Request) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const limited = checkRateLimit(rateLimitKey("profile:update", request, user.id), {
      maxRequests: 30,
      windowMs: 60 * 1000,
    });
    if (limited) return limited;

    const body = await request.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    const forceCommunityNicknameSync = body.sync_community_nickname === true;

    if (body.name !== undefined) {
      const name = cleanOptionalText(body.name, 80);
      if (!name) {
        return NextResponse.json({ error: "이름 형식이 올바르지 않습니다." }, { status: 400 });
      }
      updates.name = name;
    }

    // 선제 아웃바운드는 동의 원장·철회·중복방지 E2E가 끝날 때까지 하드 비활성이다.
    // 오래된 클라이언트가 남긴 opt-in도 서버에서 다시 켜지 못하게 막는다.
    if (body.care_notifications_enabled !== undefined) {
      if (typeof body.care_notifications_enabled !== "boolean") {
        return NextResponse.json({ error: "알림 설정 값이 올바르지 않습니다." }, { status: 400 });
      }
      if (body.care_notifications_enabled) {
        return NextResponse.json(
          { error: "아모라 선제 알림은 아직 준비 중입니다." },
          { status: 409 }
        );
      }
      updates.care_notifications_enabled = false;
    }

    // 휴대폰 번호 — 선택 입력 프로필 정보. 업체 연결 비활성 중에는 전송하지 않는다.
    if (body.phone !== undefined) {
      const phone = cleanOptionalKoreanMobile(body.phone);
      if (phone === undefined) {
        return NextResponse.json(
          { error: "휴대폰 번호 형식이 올바르지 않습니다. (예: 010-1234-5678)" },
          { status: 400 }
        );
      }
      updates.phone = phone;
      // A booking contact edit never implies outbound-message consent.
      updates.phone_care_consented_at = null;
    }

    // 과거 클라이언트 호환 입력은 받되, 새 수신 동의는 기능 출시 전까지 거부한다.
    if (body.phone_care_consent !== undefined) {
      if (typeof body.phone_care_consent !== "boolean") {
        return NextResponse.json({ error: "동의 값이 올바르지 않습니다." }, { status: 400 });
      }
      if (body.phone_care_consent) {
        return NextResponse.json(
          { error: "문자·알림톡 자동 알림은 아직 준비 중입니다." },
          { status: 409 }
        );
      } else {
        updates.phone_care_consented_at = null;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "수정할 항목이 없습니다." }, { status: 400 });
    }

    const admin = getAdminClient();
    let previousName: string | null = null;

    if (typeof updates.name === "string") {
      const { data: previousProfile, error: previousProfileError } = await admin
        .from("profiles")
        .select("name")
        .eq("id", user.id)
        .maybeSingle();

      if (previousProfileError) {
        console.warn("Previous profile name lookup failed; continuing profile update:", previousProfileError);
      }
      previousName = typeof previousProfile?.name === "string" ? previousProfile.name : null;
    }

    let communityProfileSynced = false;
    if (typeof updates.name === "string") {
      const syncResult = await syncCommunityNicknameIfDefault(
        admin,
        user.id,
        updates.name,
        previousName,
        forceCommunityNicknameSync
      );

      if ("error" in syncResult) {
        return NextResponse.json(
          { error: syncResult.error.message },
          { status: syncResult.error.status }
        );
      }

      communityProfileSynced = syncResult.synced;
    }

    const { data: profile, error } = await admin
      .from("profiles")
      .update(updates)
      .eq("id", user.id)
      .select()
      .single();

    if (error) {
      console.error("Profile update error:", error);
      return NextResponse.json({ error: "업데이트에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ profile, communityProfileSynced });
  } catch (err) {
    console.error("Profile API error:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
