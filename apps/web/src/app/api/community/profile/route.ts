import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  getCommunityNicknameFallback,
  getSafeDefaultCommunityNickname,
  isCommunityNicknameUniqueViolation,
  validateCommunityNickname,
} from "@/lib/community/nickname";
import { sanitizeText } from "@/utils/sanitize";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { normalizeCommunityAvatar } from "@/lib/community/avatar";
import { COMMUNITY_PROFILE_OWNER_SELECT } from "@/lib/community/profileSelect";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type ServiceClient = ReturnType<typeof getServiceClient>;

async function createCommunityProfile(
  serviceClient: ServiceClient,
  userId: string,
  initialNickname: string,
  postCount: number
) {
  const createPayload = {
    user_id: userId,
    badge: "member",
    post_count: postCount,
    comment_count: 0,
    total_upvotes_received: 0,
  };

  let result = await serviceClient
    .from("community_profiles")
    .insert({ ...createPayload, nickname: initialNickname })
    .select(COMMUNITY_PROFILE_OWNER_SELECT)
    .single();

  for (let attempt = 1; attempt < 5; attempt += 1) {
    if (!result.error || !isCommunityNicknameUniqueViolation(result.error)) break;
    result = await serviceClient
      .from("community_profiles")
      .insert({ ...createPayload, nickname: getCommunityNicknameFallback() })
      .select(COMMUNITY_PROFILE_OWNER_SELECT)
      .single();
  }

  return result;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      return NextResponse.json(
        { error: "로그인 상태를 확인하지 못했습니다." },
        { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } },
      );
    }

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const serviceClient = getServiceClient();

    const { data: profile, error } = await serviceClient
      .from("community_profiles")
      .select(COMMUNITY_PROFILE_OWNER_SELECT)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Get community profile error:", error);
      return NextResponse.json(
        { error: "프로필을 불러오지 못했습니다." },
        { status: 500 }
      );
    }

    const { count: actualPostCount } = await serviceClient
      .from("community_posts")
      .select("id", { count: "exact", head: true })
      .eq("author_id", user.id)
      .in("visibility", ["public", "members"])
      .eq("under_review", false);

    if (!profile) {
      const { data: newProfile, error: createError } = await createCommunityProfile(
        serviceClient,
        user.id,
        getSafeDefaultCommunityNickname(null, user.id),
        actualPostCount ?? 0
      );

      if (createError) {
        console.error("Create community profile error:", createError);
        return NextResponse.json(
          { error: "프로필 생성에 실패했습니다." },
          { status: 500 }
        );
      }

      return NextResponse.json({
        profile: newProfile,
        actualPostCount: actualPostCount ?? 0,
      });
    }

    return NextResponse.json({
      profile,
      actualPostCount: actualPostCount ?? 0,
    });
  } catch (err) {
    console.error("Get community profile error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      return NextResponse.json(
        { error: "로그인 상태를 확인하지 못했습니다." },
        { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } },
      );
    }

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const rlResult = await checkRateLimitPersistent(
      rateLimitKey("community:profile:update", req, user.id),
      { maxRequests: 5, windowMs: 60 * 60 * 1000 },
      user.id,
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
      const safeAvatar = normalizeCommunityAvatar(normalizedAvatar);
      if (normalizedAvatar && !safeAvatar) {
        return NextResponse.json(
          { error: "공개 아바타는 이모지만 사용할 수 있습니다." },
          { status: 400 }
        );
      }
      avatarUrl = safeAvatar;
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
      .select(COMMUNITY_PROFILE_OWNER_SELECT)
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
