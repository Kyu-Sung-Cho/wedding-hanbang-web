import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { PrivateNextResponse as NextResponse } from "@/lib/http/privateResponse";
import {
  getCommunityNicknameFallback,
  getSafeDefaultCommunityNickname,
  isCommunityNicknameUniqueViolation,
  validateCommunityNickname,
} from "@/lib/community/nickname";
import { normalizeCommunityAvatar } from "@/lib/community/avatar";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { isRecord, readBoundedJsonValue } from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import {
  COMMUNITY_WRITE_DENIED_MESSAGE,
  isCommunityActorWriteDenied,
} from "@/lib/community/actorWriteGate";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const MAX_BODY_BYTES = 4 * 1024;
const COMMUNITY_PROFILE_RESPONSE_COLUMNS =
  "user_id:community_public_id, nickname, avatar_url, badge, post_count, comment_count, total_upvotes_received, created_at, rank, wedding_year, wedding_month, wedding_completed, progress_percent, region, warning_count, is_suspended";

function getServiceClient() {
  return createAdminClient();
}

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
    .select(COMMUNITY_PROFILE_RESPONSE_COLUMNS)
    .single();

  if (
    result.error &&
    isCommunityNicknameUniqueViolation(result.error) &&
    initialNickname !== fallbackNickname
  ) {
    result = await serviceClient
      .from("community_profiles")
      .insert({ ...createPayload, nickname: fallbackNickname })
      .select(COMMUNITY_PROFILE_RESPONSE_COLUMNS)
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
        { status: 401 }
      );
    }

    const serviceClient = getServiceClient();
    const { data: profile, error } = await serviceClient
      .from("community_profiles")
      .select(COMMUNITY_PROFILE_RESPONSE_COLUMNS)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Get community profile error:", safeErrorDiagnostic(error));
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

    return NextResponse.json({
      profile,
      actualPostCount: actualPostCount ?? 0,
    });
  } catch (err) {
    console.error("Get community profile error:", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!isTrustedMutationRequest(req)) {
      return NextResponse.json({ error: "허용되지 않은 요청 출처입니다." }, { status: 403 });
    }

    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const serviceClient = getServiceClient();
    const [{ data: existingProfile, error: profileError }, { count: actualPostCount }] =
      await Promise.all([
        serviceClient
          .from("community_profiles")
          .select(COMMUNITY_PROFILE_RESPONSE_COLUMNS)
          .eq("user_id", user.id)
          .maybeSingle(),
        serviceClient
          .from("community_posts")
          .select("id", { count: "exact", head: true })
          .eq("author_id", user.id)
          .in("visibility", ["public", "members"])
          .eq("under_review", false),
      ]);

    if (profileError) {
      return NextResponse.json({ error: "프로필을 확인하지 못했습니다." }, { status: 500 });
    }
    if (existingProfile) {
      return NextResponse.json({
        profile: existingProfile,
        actualPostCount: actualPostCount ?? 0,
      });
    }

    const { data: userProfile } = await serviceClient
      .from("profiles")
      .select("name")
      .eq("id", user.id)
      .maybeSingle();
    const { data: newProfile, error: createError } = await createCommunityProfile(
      serviceClient,
      user.id,
      getSafeDefaultCommunityNickname(userProfile?.name, user.id),
      actualPostCount ?? 0,
    );

    if (createError) {
      // Two same-user initialization requests can race. Return the canonical
      // row only after re-reading it; every other persistence error is fatal.
      const { data: racedProfile } = await serviceClient
        .from("community_profiles")
        .select(COMMUNITY_PROFILE_RESPONSE_COLUMNS)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!racedProfile) {
        console.error("Create community profile error:", safeErrorDiagnostic(createError));
        return NextResponse.json({ error: "프로필 생성에 실패했습니다." }, { status: 500 });
      }
      return NextResponse.json({
        profile: racedProfile,
        actualPostCount: actualPostCount ?? 0,
      });
    }

    return NextResponse.json({
      profile: newProfile,
      actualPostCount: actualPostCount ?? 0,
    }, { status: 201 });
  } catch (err) {
    console.error("Create community profile error:", safeErrorDiagnostic(err));
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    if (!isTrustedMutationRequest(req)) {
      return NextResponse.json({ error: "허용되지 않은 요청 출처입니다." }, { status: 403 });
    }
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

    const rlResult = await checkRateLimitPersistent(
      rateLimitKey("community:profile:update", req, user.id),
      { maxRequests: 5, windowMs: 60 * 60 * 1000 }
    );
    if (rlResult) return rlResult;

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
    const { nickname: rawNickname, avatar_url: rawAvatarUrl } = bodyResult.value;

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
      const normalizedAvatar = normalizeCommunityAvatar(rawAvatarUrl);
      if (rawAvatarUrl !== null && rawAvatarUrl !== "" && normalizedAvatar === null) {
        return NextResponse.json(
          { error: "프로필 아바타는 제공된 이모지만 사용할 수 있습니다." },
          { status: 400 }
        );
      }
      avatarUrl = normalizedAvatar;
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

    const { data: updatedProfile, error } = await serviceClient
      .rpc("community_update_profile_for_actor", {
        p_actor_id: user.id,
        p_nickname: nickname,
        p_avatar_url: avatarUrl ?? null,
        p_update_avatar: avatarUrl !== undefined,
      })
      .select(COMMUNITY_PROFILE_RESPONSE_COLUMNS)
      .single();

    if (error) {
      if (isCommunityActorWriteDenied(error)) {
        return NextResponse.json(
          { error: COMMUNITY_WRITE_DENIED_MESSAGE },
          { status: 403 },
        );
      }
      if (isCommunityNicknameUniqueViolation(error)) {
        return NextResponse.json(
          { error: "이미 사용 중인 닉네임입니다." },
          { status: 409 }
        );
      }

      console.error("Update nickname error:", safeErrorDiagnostic(error));
      return NextResponse.json(
        { error: "닉네임 수정에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ profile: updatedProfile });
  } catch (err) {
    console.error("Update nickname error:", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
