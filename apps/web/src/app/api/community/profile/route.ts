import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { sanitizeText } from "@/utils/sanitize";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

// post_count 정확도 위해 캐시 차단 — 매 요청마다 actualPostCount 재계산
export const dynamic = "force-dynamic";
export const revalidate = 0;

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 커뮤니티 프로필 조회
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

    const { data: profile, error } = await supabase
      .from("community_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Get community profile error:", error);
      return NextResponse.json(
        { error: "프로필을 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    // 실제 작성 글 수 — service client로 COUNT (RLS 우회)
    // user 클라이언트로 count하면 visibility/RLS 정책에 따라 0 반환 가능.
    // 도구 잠금 해제용 카운트는 "정상 발행된" 글만 인정:
    //   - visibility ∈ {public, members}  → draft(=관리자 숨김 처리 포함) 제외
    //   - under_review = false             → 3+ 신고로 자동 검토 들어간 글 제외
    // 강제 삭제된 글은 row 자체가 없어서 자동으로 제외됨.
    const serviceClientForCount = getServiceClient();
    const { count: actualPostCount } = await serviceClientForCount
      .from("community_posts")
      .select("id", { count: "exact", head: true })
      .eq("author_id", user.id)
      .in("visibility", ["public", "members"])
      .eq("under_review", false);

    // 프로필이 없으면 자동 생성 — 단 historical 글이 있을 수 있으므로
    // post_count 초기값을 actualPostCount로 동기화
    if (!profile) {
      const { data: userProfile } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", user.id)
        .single();

      const serviceClient = getServiceClient();
      const { data: newProfile, error: createError } = await serviceClient
        .from("community_profiles")
        .insert({
          user_id: user.id,
          nickname: userProfile?.name ?? "익명",
          badge: "member",
          post_count: actualPostCount ?? 0,
          comment_count: 0,
          total_upvotes_received: 0,
        })
        .select("*")
        .single();

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

// 닉네임 수정
export async function PATCH(req: NextRequest) {
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

    // Rate limit: 5 profile updates per hour per user
    const rlResult = checkRateLimit(
      rateLimitKey("community:profile:update", req, user.id),
      { maxRequests: 5, windowMs: 60 * 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const { nickname: rawNickname, avatar_url: rawAvatarUrl } = (await req.json()) as {
      nickname?: string;
      avatar_url?: string | null;
    };

    // 닉네임 정화 및 검증
    const nickname = sanitizeText(rawNickname ?? "").slice(0, 20);

    if (!nickname || nickname.trim().length === 0) {
      return NextResponse.json(
        { error: "닉네임을 입력해주세요." },
        { status: 400 }
      );
    }

    // 공백만 포함되거나 제어 문자가 있는 닉네임 거부
    if (/^\s+$/.test(nickname) || /[\x00-\x1F\x7F]/.test(nickname)) {
      return NextResponse.json(
        { error: "사용할 수 없는 닉네임입니다." },
        { status: 400 }
      );
    }

    if (nickname.trim().length > 20) {
      return NextResponse.json(
        { error: "닉네임은 20자 이내로 입력해주세요." },
        { status: 400 }
      );
    }

    let avatarUrl: string | null | undefined;
    if (rawAvatarUrl !== undefined) {
      const normalizedAvatar = sanitizeText(rawAvatarUrl ?? "").slice(0, 160);
      const isEmojiAvatar = /\p{Emoji}/u.test(normalizedAvatar) && normalizedAvatar.length <= 4;
      const isImageUrl = /^https?:\/\//i.test(normalizedAvatar) || normalizedAvatar.startsWith("/");
      if (normalizedAvatar && !isEmojiAvatar && !isImageUrl) {
        return NextResponse.json(
          { error: "프로필 이미지는 이모지나 안전한 이미지 URL만 사용할 수 있습니다." },
          { status: 400 }
        );
      }
      avatarUrl = normalizedAvatar || null;
    }

    const serviceClient = getServiceClient();

    // 닉네임 중복 확인
    const { data: existingNickname } = await serviceClient
      .from("community_profiles")
      .select("user_id")
      .eq("nickname", nickname.trim())
      .neq("user_id", user.id)
      .maybeSingle();

    if (existingNickname) {
      return NextResponse.json(
        { error: "이미 사용 중인 닉네임입니다." },
        { status: 409 }
      );
    }

    const updatePayload: { nickname: string; avatar_url?: string | null } = { nickname: nickname.trim() };
    if (avatarUrl !== undefined) updatePayload.avatar_url = avatarUrl;

    const { data: updatedProfile, error } = await serviceClient
      .from("community_profiles")
      .update(updatePayload)
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (error) {
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
