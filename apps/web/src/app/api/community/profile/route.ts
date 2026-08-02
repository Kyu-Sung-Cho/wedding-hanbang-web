import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  getCommunityNicknameFallback,
  getSafeDefaultCommunityNickname,
  isCommunityNicknameUniqueViolation,
  validateCommunityNickname,
} from "@/lib/community/nickname";
import { sanitizeText } from "@/utils/sanitize";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getServiceClient() {
  return createAdminClient();
}

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

type ServiceClient = ReturnType<typeof getServiceClient>;

async function createCommunityProfile(
  serviceClient: ServiceClient,
  userId: string,
  initialNickname: string,
  postCount: number
) {
  const fallbackNickname = getCommunityNicknameFallback(userId);
  const createPayload = {
    user_id: userId,
    nickname: initialNickname,
    badge: "member",
    post_count: postCount,
    comment_count: 0,
    total_upvotes_received: 0,
  };

  let result = await serviceClient
    .from("community_profiles")
    .insert(createPayload)
    .select("*")
    .single();

  if (
    result.error &&
    isCommunityNicknameUniqueViolation(result.error) &&
    initialNickname !== fallbackNickname
  ) {
    result = await serviceClient
      .from("community_profiles")
      .insert({ ...createPayload, nickname: fallbackNickname })
      .select("*")
      .single();
  }

  return result;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401, headers: PRIVATE_NO_STORE },
      );
    }

    const { data: profile, error } = await supabase
      .from("community_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Get community profile error:", error);
      return NextResponse.json(
        { error: "프로필을 불러오지 못했습니다." },
        { status: 500, headers: PRIVATE_NO_STORE },
      );
    }

    const serviceClient = getServiceClient();
    const { count: actualPostCount } = await serviceClient
      .from("community_posts")
      .select("id", { count: "exact", head: true })
      .eq("author_id", user.id)
      .in("visibility", ["public", "members"])
      .eq("under_review", false);

    if (!profile) {
      return NextResponse.json(
        {
          profile: null,
          actualPostCount: actualPostCount ?? 0,
        },
        { headers: PRIVATE_NO_STORE },
      );
    }

    return NextResponse.json(
      {
        profile,
        actualPostCount: actualPostCount ?? 0,
      },
      { headers: PRIVATE_NO_STORE },
    );
  } catch (err) {
    console.error("Get community profile error:", err);
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
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const limited = checkRateLimit(
      rateLimitKey("community:profile:create", req, user.id),
      { maxRequests: 5, windowMs: 60 * 60 * 1000 },
    );
    if (limited) return limited;

    const { data: existing, error: existingError } = await supabase
      .from("community_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (existingError) {
      return NextResponse.json(
        { error: "프로필 상태를 확인하지 못했습니다." },
        { status: 503 },
      );
    }

    const serviceClient = getServiceClient();
    const { count: actualPostCount } = await serviceClient
      .from("community_posts")
      .select("id", { count: "exact", head: true })
      .eq("author_id", user.id)
      .in("visibility", ["public", "members"])
      .eq("under_review", false);

    if (existing) {
      return NextResponse.json({
        profile: existing,
        actualPostCount: actualPostCount ?? 0,
      });
    }

    const { data: created, error: createError } = await createCommunityProfile(
      serviceClient,
      user.id,
      getSafeDefaultCommunityNickname(null, user.id),
      actualPostCount ?? 0,
    );
    if (createError || !created) {
      // Concurrent explicit initialization is idempotent: if another request
      // won the user_id uniqueness race, return that exact persisted profile.
      const { data: racedProfile } = await serviceClient
        .from("community_profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (racedProfile) {
        return NextResponse.json({
          profile: racedProfile,
          actualPostCount: actualPostCount ?? 0,
        });
      }
      return NextResponse.json(
        { error: "프로필 생성에 실패했습니다." },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { profile: created, actualPostCount: actualPostCount ?? 0 },
      { status: 201 },
    );
  } catch (error) {
    console.error("Create community profile error:", error);
    return NextResponse.json(
      { error: "프로필 생성 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "올바르지 않은 요청 출처입니다." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const rlResult = checkRateLimit(
      rateLimitKey("community:profile:update", req, user.id),
      { maxRequests: 5, windowMs: 60 * 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const { nickname: rawNickname, avatar_url: rawAvatarUrl } = (await req.json()) as {
      nickname?: string;
      avatar_url?: string | null;
    };

    const nicknameValidation = validateCommunityNickname(rawNickname);
    if (!nicknameValidation.ok) {
      return NextResponse.json(
        { error: nicknameValidation.message },
        { status: 400 }
      );
    }
    const nickname = nicknameValidation.nickname;

    let avatarUrl: string | null | undefined;
    if (rawAvatarUrl !== undefined) {
      const normalizedAvatar = sanitizeText(rawAvatarUrl ?? "").slice(0, 160);
      const isEmojiAvatar = /\p{Emoji}/u.test(normalizedAvatar) && normalizedAvatar.length <= 4;
      const isImageUrl = /^https?:\/\//i.test(normalizedAvatar) || normalizedAvatar.startsWith("/");
      if (normalizedAvatar && !isEmojiAvatar && !isImageUrl) {
        return NextResponse.json(
          { error: "프로필 이미지는 이모지 또는 안전한 이미지 URL만 사용할 수 있습니다." },
          { status: 400 }
        );
      }
      avatarUrl = normalizedAvatar || null;
    }

    const serviceClient = getServiceClient();

    const { data: existingNickname } = await serviceClient
      .from("community_profiles")
      .select("user_id")
      .eq("nickname", nickname)
      .neq("user_id", user.id)
      .maybeSingle();

    if (existingNickname) {
      return NextResponse.json(
        { error: "이미 사용 중인 닉네임입니다." },
        { status: 409 }
      );
    }

    const updatePayload: { nickname: string; avatar_url?: string | null } = { nickname };
    if (avatarUrl !== undefined) updatePayload.avatar_url = avatarUrl;

    const { data: updatedProfile, error } = await serviceClient
      .from("community_profiles")
      .update(updatePayload)
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (error) {
      if (isCommunityNicknameUniqueViolation(error)) {
        return NextResponse.json(
          { error: "이미 사용 중인 닉네임입니다." },
          { status: 409 }
        );
      }

      console.error("Update nickname error:", error);
      return NextResponse.json(
        { error: "닉네임 수정에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ profile: updatedProfile });
  } catch (err) {
    console.error("Update nickname error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
