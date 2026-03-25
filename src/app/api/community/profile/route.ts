import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { sanitizeText } from "@/utils/sanitize";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 커뮤니티 프로필 조회
export async function GET() {
  try {
    const supabase = await createClient();
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

    // 프로필이 없으면 자동 생성
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
          post_count: 0,
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

      return NextResponse.json({ profile: newProfile });
    }

    return NextResponse.json({ profile });
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
    const supabase = await createClient();
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

    const { nickname: rawNickname } = (await req.json()) as { nickname: string };

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

    const { data: updatedProfile, error } = await serviceClient
      .from("community_profiles")
      .update({ nickname: nickname.trim() })
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
