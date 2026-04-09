import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { sanitizeHtml, sanitizeText } from "@/utils/sanitize";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import type {
  CommunityCategory,
  PostSort,
  TimePeriod,
  PostVisibility,
  CostShareData,
  AdDisclosure,
  PriceData,
  AiComment,
} from "@/types/community.types";
import Anthropic from "@anthropic-ai/sdk";

const AI_PRICE_SYSTEM_PROMPT = `You are the wedding hanbang AI 아모라 price analyzer. Given a vendor price, compare to Korean wedding industry averages and write a SHORT 1-2 sentence Korean comment.

References (기재부 2024.11):
- 스튜디오/드레스/메이크업 기본금 평균: 346만원
- 평균 추가금: 174만원

Output JSON only:
{
  "text": "1-2문장 한국어 코멘트",
  "comparison": "below|average|above",
  "percentage": <int 평균 대비 %>,
  "reference": "기재부 2024.11 기준 평균 346만원"
}`;

async function generateAiPriceComment(priceData: PriceData): Promise<AiComment | null> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const userContent = `카테고리: ${priceData.vendor_category}
기본금: ${priceData.base_price}만원
추가금: ${priceData.extra_price ?? 0}만원
업체명: ${priceData.vendor_name ?? "미상"}
지역: ${priceData.region ?? "미상"}
상세: ${priceData.details ?? "없음"}`;

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: AI_PRICE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });
    const firstBlock = message.content[0];
    const text = firstBlock && firstBlock.type === "text" ? firstBlock.text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as Omit<AiComment, "generated_at">;
    return {
      text: parsed.text,
      comparison: parsed.comparison,
      percentage: parsed.percentage,
      reference: parsed.reference,
      generated_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error("AI price comment inline error:", err);
    return null;
  }
}

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 게시글 목록 조회
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(req.url);

    const category = searchParams.get("category") as CommunityCategory | null;
    const sort = (searchParams.get("sort") ?? "hot") as PostSort;
    const period = (searchParams.get("period") ?? "week") as TimePeriod;
    const page = parseInt(searchParams.get("page") ?? "1");
    const limit = parseInt(searchParams.get("limit") ?? "20");
    const tag = searchParams.get("tag");
    const authorId = searchParams.get("author_id");
    const offset = (page - 1) * limit;

    // 현재 사용자 확인 (선택적)
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // 기본 쿼리
    let query = supabase
      .from("community_posts")
      .select(
        "*, author:community_profiles!community_posts_author_id_fkey(*)",
        { count: "exact" }
      );

    // 카테고리 필터
    if (category) {
      query = query.eq("category", category);
    }

    // 태그 필터
    if (tag) {
      query = query.contains("tags", [tag]);
    }

    // 작성자 필터
    if (authorId) {
      query = query.eq("author_id", authorId);
    }

    // visibility 필터: public은 항상, members는 인증 시, draft는 본인만
    if (user) {
      query = query.or(
        `visibility.eq.public,visibility.eq.members,and(visibility.eq.draft,author_id.eq.${user.id})`
      );
    } else {
      query = query.eq("visibility", "public");
    }

    // 정렬
    if (sort === "new") {
      query = query.order("created_at", { ascending: false });
    } else if (sort === "top") {
      // 기간 필터
      if (period !== "all") {
        const now = new Date();
        if (period === "week") {
          now.setDate(now.getDate() - 7);
        } else if (period === "month") {
          now.setMonth(now.getMonth() - 1);
        }
        query = query.gte("created_at", now.toISOString());
      }
      query = query.order("upvote_count", { ascending: false });
    } else {
      // hot: 인기 정렬 - Supabase에서 복합 정렬이 어려우므로 클라이언트 정렬 or RPC 사용
      // 기본적으로 upvote_count로 정렬 후 클라이언트에서 재정렬
      query = query.order("upvote_count", { ascending: false });
    }

    // 페이지네이션
    query = query.range(offset, offset + limit - 1);

    const { data: posts, count, error } = await query;

    if (error) {
      console.error("Community posts list error:", error);
      return NextResponse.json(
        { error: "게시글을 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    // hot 정렬의 경우 스코어 기반 재정렬
    let sortedPosts = posts ?? [];
    if (sort === "hot") {
      const now = Date.now();
      sortedPosts = [...sortedPosts].sort((a, b) => {
        const ageA =
          (now - new Date(a.created_at).getTime()) / (1000 * 60 * 60);
        const ageB =
          (now - new Date(b.created_at).getTime()) / (1000 * 60 * 60);
        const scoreA =
          a.upvote_count * 2 + a.comment_count * 3 - ageA * 0.5;
        const scoreB =
          b.upvote_count * 2 + b.comment_count * 3 - ageB * 0.5;
        return scoreB - scoreA;
      });
    }

    // 인증 사용자의 투표 상태 조회
    let userVotesMap: Record<string, number> = {};
    if (user && sortedPosts.length > 0) {
      const postIds = sortedPosts.map((p) => p.id);
      const { data: votes } = await supabase
        .from("community_votes")
        .select("target_id, vote_type")
        .eq("user_id", user.id)
        .eq("target_type", "post")
        .in("target_id", postIds);

      if (votes) {
        userVotesMap = Object.fromEntries(
          votes.map((v) => [v.target_id, v.vote_type])
        );
      }
    }

    // 응답 데이터 조합
    const postsWithVotes = sortedPosts.map((post) => ({
      ...post,
      user_vote: userVotesMap[post.id] ?? null,
    }));

    const total = count ?? 0;
    const hasMore = offset + limit < total;

    return NextResponse.json({ posts: postsWithVotes, total, hasMore });
  } catch (err) {
    console.error("Community posts error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// 게시글 생성
export async function POST(req: NextRequest) {
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

    // Rate limit: 10 posts per 10 minutes per user
    const rlResult = checkRateLimit(
      rateLimitKey("community:post:create", req, user.id),
      { maxRequests: 10, windowMs: 10 * 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const body = await req.json();
    const {
      category,
      title: rawTitle,
      content: rawContent,
      images: rawImages,
      visibility,
      vendor_tags: rawVendorTags,
      tags: rawTags,
      cost_data,
      ad_disclosure: rawAdDisclosure,
      sponsorship_detail: rawSponsorshipDetail,
      price_data: rawPriceData,
      is_quick_review,
      rating,
    } = body as {
      category: CommunityCategory;
      title: string;
      content: string;
      images?: string[];
      visibility: PostVisibility;
      vendor_tags?: string[];
      tags?: string[];
      cost_data?: CostShareData;
      ad_disclosure?: AdDisclosure;
      sponsorship_detail?: string;
      price_data?: PriceData;
      is_quick_review?: boolean;
      rating?: number;
    };

    // 광고 표시 필수 검증
    const validAdDisclosures: AdDisclosure[] = ["general", "sponsored", "ad"];
    if (!rawAdDisclosure || !validAdDisclosures.includes(rawAdDisclosure)) {
      return NextResponse.json(
        { error: "광고 표시 유형을 선택해주세요." },
        { status: 400 }
      );
    }
    const adDisclosure: AdDisclosure = rawAdDisclosure;
    let sponsorshipDetail: string | null = null;
    if (adDisclosure === "sponsored") {
      const d = (rawSponsorshipDetail ?? "").trim();
      if (!d || d.length < 5) {
        return NextResponse.json(
          { error: "협찬 내용을 5자 이상 입력해주세요." },
          { status: 400 }
        );
      }
      sponsorshipDetail = d.slice(0, 500);
    }

    // price_data 검증
    let priceData: PriceData | null = null;
    if (rawPriceData && typeof rawPriceData.base_price === "number" && rawPriceData.base_price > 0) {
      priceData = {
        vendor_category: rawPriceData.vendor_category,
        base_price: rawPriceData.base_price,
        extra_price: rawPriceData.extra_price,
        vendor_name: rawPriceData.vendor_name?.slice(0, 100),
        region: rawPriceData.region?.slice(0, 100),
        details: rawPriceData.details?.slice(0, 1000),
      };
    }

    // 입력 검증 및 정화
    const title = rawTitle?.trim().slice(0, 200);
    if (!title || title.length === 0) {
      return NextResponse.json(
        { error: "제목을 입력해주세요." },
        { status: 400 }
      );
    }

    const content = sanitizeHtml(rawContent ?? "").slice(0, 50000);
    if (!content || content.trim().length === 0) {
      return NextResponse.json(
        { error: "내용을 입력해주세요." },
        { status: 400 }
      );
    }

    // 태그 검증: 최대 10개, 각 최대 30자
    const tags = (rawTags ?? [])
      .slice(0, 10)
      .map((t: string) => sanitizeText(t).slice(0, 30))
      .filter((t: string) => t.length > 0);

    // vendor_tags 검증: 최대 5개
    const vendor_tags = (rawVendorTags ?? []).slice(0, 5);

    // 이미지 검증: 최대 10개, 각 URL은 https://로 시작
    const images = (rawImages ?? [])
      .slice(0, 10)
      .filter((url: string) => typeof url === "string" && url.startsWith("https://"));

    if (!category || !visibility) {
      return NextResponse.json(
        { error: "필수 항목을 입력해주세요." },
        { status: 400 }
      );
    }

    const serviceClient = getServiceClient();

    // 커뮤니티 프로필 자동 생성 (없으면)
    const { data: existingProfile } = await serviceClient
      .from("community_profiles")
      .select("user_id")
      .eq("user_id", user.id)
      .single();

    if (!existingProfile) {
      // profiles 테이블에서 이름 가져오기
      const { data: userProfile } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", user.id)
        .single();

      const nickname = userProfile?.name ?? "익명";

      await serviceClient.from("community_profiles").insert({
        user_id: user.id,
        nickname,
        badge: "member",
        post_count: 0,
        comment_count: 0,
        total_upvotes_received: 0,
      });
    }

    // 게시글 생성
    const { data: post, error } = await serviceClient
      .from("community_posts")
      .insert({
        author_id: user.id,
        category,
        title,
        content,
        images: images ?? [],
        visibility,
        vendor_tags: vendor_tags ?? [],
        tags: tags ?? [],
        cost_data: cost_data ?? null,
        ad_disclosure: adDisclosure,
        sponsorship_detail: sponsorshipDetail,
        price_data: priceData,
        is_quick_review: is_quick_review ?? false,
        rating: typeof rating === "number" ? rating : null,
        upvote_count: 0,
        downvote_count: 0,
        comment_count: 0,
        view_count: 0,
        bookmark_count: 0,
        is_pinned: false,
        is_weekly_best: false,
      })
      .select("*")
      .single();

    if (error) {
      console.error("Create post error:", error);
      return NextResponse.json(
        { error: "게시글 작성에 실패했습니다." },
        { status: 500 }
      );
    }

    // post_count 증가
    await serviceClient.rpc("community_increment_profile_count", {
      p_user_id: user.id,
      p_field: "post_count",
    }).then(({ error: rpcError }) => {
      // RPC 없으면 직접 업데이트
      if (rpcError) {
        return serviceClient
          .from("community_profiles")
          .update({
            post_count: (existingProfile as Record<string, number>)
              ?.post_count
              ? (existingProfile as Record<string, number>).post_count + 1
              : 1,
          })
          .eq("user_id", user.id);
      }
    });

    // 게이미피케이션: XP 지급 및 업적 확인 (비차단)
    try {
      void serviceClient
        .rpc("community_award_xp", {
          p_user_id: user.id,
          p_action: "post_create",
          p_xp: 50,
          p_reference_id: post.id,
        })
        .then(() => {}, () => {});

      // 업적 확인
      const { data: profileData } = await serviceClient
        .from("community_profiles")
        .select("post_count")
        .eq("user_id", user.id)
        .single();

      if (profileData) {
        const count = profileData.post_count;
        if (count === 1)
          void serviceClient
            .rpc("community_unlock_achievement", { p_user_id: user.id, p_key: "first_post" })
            .then(() => {}, () => {});
        if (count === 5)
          void serviceClient
            .rpc("community_unlock_achievement", { p_user_id: user.id, p_key: "posts_5" })
            .then(() => {}, () => {});
        if (count === 20)
          void serviceClient
            .rpc("community_unlock_achievement", { p_user_id: user.id, p_key: "posts_20" })
            .then(() => {}, () => {});
        if (count === 50)
          void serviceClient
            .rpc("community_unlock_achievement", { p_user_id: user.id, p_key: "posts_50" })
            .then(() => {}, () => {});
      }

      // 새벽 3시 비밀 업적
      const hour = new Date().getHours();
      if (hour >= 3 && hour < 4) {
        void serviceClient
          .rpc("community_unlock_achievement", { p_user_id: user.id, p_key: "night_owl" })
          .then(() => {}, () => {});
      }
    } catch {
      // 게이미피케이션 오류는 무시
    }

    // is_normal + price_data: AI 코멘트 생성 (비차단 실패)
    let finalPost = post;
    if (category === "is_normal" && priceData) {
      try {
        const aiComment = await generateAiPriceComment(priceData);
        if (aiComment) {
          const { data: updated } = await serviceClient
            .from("community_posts")
            .update({ ai_comment: aiComment })
            .eq("id", post.id)
            .select("*")
            .single();
          if (updated) finalPost = updated;
        }
      } catch (aiErr) {
        console.error("AI comment generation failed:", aiErr);
      }
    }

    return NextResponse.json({ post: finalPost }, { status: 201 });
  } catch (err) {
    console.error("Create post error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
