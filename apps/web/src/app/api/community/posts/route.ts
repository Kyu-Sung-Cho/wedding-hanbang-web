import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { buildSourceBackedPriceComment } from "@/lib/community/priceComment";
import {
  validateCommunityAttachmentUrl,
  validateCommunityHtmlImageSources,
  validateCommunityMediaUrl,
} from "@/lib/community/mediaUrls";
import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
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
  CreatePollInput,
  PollSummary,
} from "@/types/community.types";

async function generateAiPriceComment(priceData: PriceData): Promise<AiComment | null> {
  try {
    return buildSourceBackedPriceComment(priceData);
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

function cleanOptionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = sanitizeText(value).slice(0, maxLength);
  return cleaned.length > 0 ? cleaned : undefined;
}

function invalidCommunityMediaResponse() {
  return NextResponse.json(
    { error: "커뮤니티 업로드로 등록된 이미지와 영상만 첨부할 수 있습니다." },
    { status: 400 }
  );
}

// 게시글 목록 조회
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const { searchParams } = new URL(req.url);

    const category = searchParams.get("category") as CommunityCategory | null;
    const sort = (searchParams.get("sort") ?? "hot") as PostSort;
    const period = (searchParams.get("period") ?? "week") as TimePeriod;
    const page = Math.max(1, Math.min(1000, parseInt(searchParams.get("page") ?? "1") || 1));
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") ?? "20") || 20));
    const tag = searchParams.get("tag");
    const authorId = searchParams.get("author_id");
    const bookmarkedOnly = searchParams.get("bookmarked") === "true";
    const offset = (page - 1) * limit;

    // 현재 사용자 확인 (선택적)
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const isPersonalizedFeed = Boolean(user) || bookmarkedOnly || sort === "my_cohort" || sort === "my_posts";
    const feedCacheControl = isPersonalizedFeed
      ? "private, no-store, max-age=0"
      : "public, s-maxage=10, stale-while-revalidate=30";
    const feedResponse = (payload: unknown, status = 200) =>
      NextResponse.json(payload, {
        status,
        headers: { "Cache-Control": feedCacheControl },
      });

    // bookmarked=true는 로그인 필수 — 비로그인이면 빈 결과
    if (bookmarkedOnly && !user) {
      return feedResponse({ posts: [], total: 0, hasMore: false, page, limit });
    }

    // 기본 쿼리
    let query = supabase
      .from("community_posts")
      .select(
        COMMUNITY_POST_PUBLIC_SELECT,
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

    // 북마크 필터 — 본인이 북마크한 글의 id만 통과
    if (bookmarkedOnly && user) {
      const { data: bookmarks } = await supabase
        .from("community_bookmarks")
        .select("post_id")
        .eq("user_id", user.id);
      const bookmarkedIds = (bookmarks ?? []).map((b) => b.post_id as string);
      if (bookmarkedIds.length === 0) {
        return feedResponse({ posts: [], total: 0, hasMore: false, page, limit });
      }
      query = query.in("id", bookmarkedIds);
    }

    // visibility 필터: public은 항상, members는 인증 시, draft는 본인만
    if (user) {
      query = query.or(
        `visibility.eq.public,visibility.eq.members,and(visibility.eq.draft,author_id.eq.${user.id})`
      );
    } else {
      query = query.eq("visibility", "public");
    }

    // 정렬 + my_cohort / my_posts 필터
    if (sort === "my_cohort") {
      // 비로그인은 빈 결과
      if (!user) {
        return feedResponse({ posts: [], total: 0, hasMore: false, page, limit });
      }
      // 1. 본인이 속한 cohort room ids
      const { data: myRooms } = await supabase
        .from("cohort_members")
        .select("room_id")
        .eq("user_id", user.id)
        .eq("is_active", true);
      const roomIds = (myRooms ?? []).map((r) => r.room_id as string);
      if (roomIds.length === 0) {
        // 동기방 미가입 → 빈 결과 (UI에서 가입 유도)
        return feedResponse({ posts: [], total: 0, hasMore: false, page, limit });
      }
      // 2. 같은 cohort room의 다른 멤버 user_ids — 본인 제외
      const { data: cohortMembers } = await supabase
        .from("cohort_members")
        .select("user_id")
        .in("room_id", roomIds)
        .eq("is_active", true);
      const memberIds = [
        ...new Set((cohortMembers ?? []).map((m) => m.user_id as string)),
      ].filter((id) => id !== user.id);
      if (memberIds.length === 0) {
        // 동기방에 나밖에 없음 → 빈 결과
        return feedResponse({ posts: [], total: 0, hasMore: false, page, limit });
      }
      // 3. 동기들이 작성한 글만 + 최신순
      query = query.in("author_id", memberIds).order("created_at", { ascending: false });
    } else if (sort === "my_posts") {
      // 비로그인은 빈 결과
      if (!user) {
        return feedResponse({ posts: [], total: 0, hasMore: false, page, limit });
      }
      // 본인 글만 + 최신순 (본인 글이라 visibility 무관 — RLS는 위에서 이미 적용됨)
      query = query.eq("author_id", user.id).order("created_at", { ascending: false });
    } else if (sort === "new") {
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
        .select("post_id, vote_type")
        .eq("user_id", user.id)
        .in("post_id", postIds);

      if (votes) {
        userVotesMap = Object.fromEntries(
          votes.map((v) => [v.post_id, v.vote_type])
        );
      }
    }

    // author 프로필 조회
    const authorIds = [...new Set(sortedPosts.map((p) => p.author_id))];
    let authorMap: Record<string, { nickname: string; avatar_url: string | null; rank: string; wedding_year: number | null; wedding_month: number | null }> = {};
    if (authorIds.length > 0) {
      const { data: profiles } = await supabase
        .from("community_profiles")
        .select("user_id, nickname, avatar_url, rank, wedding_year, wedding_month")
        .in("user_id", authorIds);
      if (profiles) {
        authorMap = Object.fromEntries(
          profiles.map((p) => [p.user_id, { nickname: p.nickname, avatar_url: p.avatar_url, rank: p.rank, wedding_year: p.wedding_year, wedding_month: p.wedding_month }])
        );
      }
    }

    // 폴 summary 조회 (목록 카드 배지용)
    let pollSummaryMap: Record<string, PollSummary> = {};
    if (sortedPosts.length > 0) {
      const postIds = sortedPosts.map((p) => p.id);
      const { data: polls } = await supabase
        .from("community_polls")
        .select("id, post_id, question, total_voters, closes_at")
        .in("post_id", postIds);
      if (polls) {
        pollSummaryMap = Object.fromEntries(
          polls.map((p: { id: string; post_id: string; question: string; total_voters: number; closes_at: string | null }) => [
            p.post_id,
            {
              id: p.id,
              question: p.question,
              total_voters: p.total_voters,
              closes_at: p.closes_at,
            } satisfies PollSummary,
          ])
        );
      }
    }

    // 응답 데이터 조합
    const postsWithVotes = sortedPosts.map((post) => ({
      ...post,
      author: authorMap[post.author_id] ?? { nickname: "익명", avatar_url: null, rank: "sprout", wedding_year: null, wedding_month: null },
      user_vote: userVotesMap[post.id] ?? null,
      poll: pollSummaryMap[post.id] ?? null,
    }));

    const total = count ?? 0;
    const hasMore = offset + limit < total;

    return feedResponse({ posts: postsWithVotes, total, hasMore });
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
      slides: rawSlides,
      visibility,
      vendor_tags: rawVendorTags,
      tags: rawTags,
      cost_data,
      ad_disclosure: rawAdDisclosure,
      sponsorship_detail: rawSponsorshipDetail,
      price_data: rawPriceData,
      is_quick_review,
      rating,
      poll: rawPoll,
    } = body as {
      category: CommunityCategory;
      title: string;
      content: string;
      images?: string[];
      slides?: Array<{ type?: string; url?: string; width?: number; height?: number; thumbnail_url?: string }> | null;
      visibility: PostVisibility;
      vendor_tags?: string[];
      tags?: string[];
      cost_data?: CostShareData;
      ad_disclosure?: AdDisclosure;
      sponsorship_detail?: string;
      price_data?: PriceData;
      is_quick_review?: boolean;
      rating?: number;
      poll?: CreatePollInput | null;
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
      const d = cleanOptionalText(rawSponsorshipDetail, 500) ?? "";
      if (!d || d.length < 5) {
        return NextResponse.json(
          { error: "협찬 내용을 5자 이상 입력해주세요." },
          { status: 400 }
        );
      }
      sponsorshipDetail = d;
    }

    // price_data 검증
    let priceData: PriceData | null = null;
    if (rawPriceData && typeof rawPriceData.base_price === "number" && rawPriceData.base_price > 0) {
      priceData = {
        vendor_category: rawPriceData.vendor_category,
        base_price: rawPriceData.base_price,
        extra_price: rawPriceData.extra_price,
        vendor_name: cleanOptionalText(rawPriceData.vendor_name, 100),
        region: cleanOptionalText(rawPriceData.region, 100),
        details: cleanOptionalText(rawPriceData.details, 1000),
      };
    }

    // 입력 검증 및 정화
    const title = cleanOptionalText(rawTitle, 200);
    if (!title || title.length === 0) {
      return NextResponse.json(
        { error: "제목을 입력해주세요." },
        { status: 400 }
      );
    }

    const content = sanitizeHtml(typeof rawContent === "string" ? rawContent : "").slice(0, 50000);
    const contentImagesResult = validateCommunityHtmlImageSources(content, {
      ownerIds: user.id,
    });
    if (!contentImagesResult.ok) return invalidCommunityMediaResponse();

    // 카드 게시물(슬라이드)이면 캡션이 비어도 허용 — 슬라이드 자체가 본문 역할.
    const hasSlides = Array.isArray(rawSlides) && rawSlides.length > 0;
    if (!hasSlides && (!content || content.trim().length === 0)) {
      return NextResponse.json(
        { error: "내용을 입력해주세요." },
        { status: 400 }
      );
    }

    // 태그 검증: 최대 10개, 각 최대 30자
    const tags = (Array.isArray(rawTags) ? rawTags : [])
      .slice(0, 10)
      .map((t: string) => sanitizeText(typeof t === "string" ? t : "").slice(0, 30))
      .filter((t: string) => t.length > 0);

    // vendor_tags 검증: 최대 5개
    const vendor_tags = (Array.isArray(rawVendorTags) ? rawVendorTags : [])
      .filter((tag): tag is string => typeof tag === "string")
      .slice(0, 5);

    // 이미지 검증: 최대 10개, 각 URL은 https://로 시작
    const images: string[] = [];
    for (const rawImageUrl of (Array.isArray(rawImages) ? rawImages : []).slice(0, 10)) {
      const mediaResult = validateCommunityAttachmentUrl(rawImageUrl, {
        ownerIds: user.id,
      });
      if (!mediaResult.ok) return invalidCommunityMediaResponse();
      images.push(mediaResult.url);
    }

    // 카드 게시물(인스타 캐러셀) 슬라이드 검증.
    // 최대 10장, 각 슬라이드는 { type: 'image'|'video', url: https:// } 필수.
    // 잘못된 형식은 자동으로 제거. 결과 배열이 비면 null로 저장 (일반 글로 처리).
    let slides: Array<{ type: "image" | "video"; url: string; width?: number; height?: number; thumbnail_url?: string }> | null = null;
    if (Array.isArray(rawSlides) && rawSlides.length > 0) {
      const cleaned: Array<{ type: "image" | "video"; url: string; width?: number; height?: number; thumbnail_url?: string }> = [];
      for (const s of rawSlides.slice(0, 10)) {
        const type: "image" | "video" = s?.type === "video" ? "video" : "image";
        const mediaResult = validateCommunityMediaUrl(s?.url, {
          kind: type,
          ownerIds: user.id,
        });
        if (!mediaResult.ok) return invalidCommunityMediaResponse();

        const out: { type: "image" | "video"; url: string; width?: number; height?: number; thumbnail_url?: string } = {
          type,
          url: mediaResult.url,
        };
        if (typeof s.width === "number" && s.width > 0) out.width = Math.min(8192, Math.round(s.width));
        if (typeof s.height === "number" && s.height > 0) out.height = Math.min(8192, Math.round(s.height));
        if (typeof s.thumbnail_url === "string" && s.thumbnail_url.trim().length > 0) {
          const thumbnailResult = validateCommunityMediaUrl(s.thumbnail_url, {
            kind: "image",
            ownerIds: user.id,
          });
          if (!thumbnailResult.ok) return invalidCommunityMediaResponse();
          out.thumbnail_url = thumbnailResult.url;
        }
        cleaned.push(out);
      }
      if (cleaned.length > 0) slides = cleaned;
    }

    if (!category || !visibility) {
      return NextResponse.json(
        { error: "필수 항목을 입력해주세요." },
        { status: 400 }
      );
    }

    let pollDraft: {
      question: string;
      options: Array<{ position: number; label: string; image_url: string | null }>;
      allow_multiple: boolean;
      is_anonymous: boolean;
      hide_results_until_voted: boolean;
      closes_at: string | null;
    } | null = null;
    if (rawPoll && typeof rawPoll === "object") {
      const question = cleanOptionalText(rawPoll.question, 200) ?? "";
      const rawOptions = Array.isArray(rawPoll.options) ? rawPoll.options : [];
      const cleanOptions: Array<{ position: number; label: string; image_url: string | null }> = [];

      for (const [idx, option] of rawOptions.slice(0, 10).entries()) {
        const label = cleanOptionalText(option?.label, 100) ?? "";
        if (!label) continue;

        let imageUrl: string | null = null;
        if (typeof option?.image_url === "string" && option.image_url.trim().length > 0) {
          const imageResult = validateCommunityMediaUrl(option.image_url, {
            kind: "image",
            ownerIds: user.id,
          });
          if (!imageResult.ok) return invalidCommunityMediaResponse();
          imageUrl = imageResult.url;
        }

        cleanOptions.push({ position: idx, label, image_url: imageUrl });
      }

      if (question.length > 0 && cleanOptions.length >= 2) {
        let closesAt: string | null = null;
        if (rawPoll.closes_at && typeof rawPoll.closes_at === "string") {
          const t = Date.parse(rawPoll.closes_at);
          if (!isNaN(t) && t > Date.now()) closesAt = new Date(t).toISOString();
        }

        pollDraft = {
          question,
          options: cleanOptions,
          allow_multiple: !!rawPoll.allow_multiple,
          is_anonymous: !!rawPoll.is_anonymous,
          hide_results_until_voted: !!rawPoll.hide_results_until_voted,
          closes_at: closesAt,
        };
      }
    }

    const serviceClient = getServiceClient();

    // 커뮤니티 프로필 자동 생성 (없으면)
    const { data: existingProfile } = await serviceClient
      .from("community_profiles")
      .select("user_id, post_count")
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
        slides,
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

    // ─────── 폴 생성 (있을 경우) ───────
    // 폴 INSERT 실패 시 게시글 자체를 롤백하여 고아 글 방지
    if (pollDraft) {
      const question = pollDraft.question;
      const cleanOptions = pollDraft.options;

      // 질문/옵션이 모두 충족된 경우에만 생성. 부분 입력이면 폴 없이 진행 (UX 친화적)
      if (question.length > 0 && cleanOptions.length >= 2) {
        // 마감일 검증 (미래여야 함)
        const { data: pollRow, error: pollErr } = await serviceClient
          .from("community_polls")
          .insert({
            post_id: post.id,
            question,
            allow_multiple: pollDraft.allow_multiple,
            is_anonymous: pollDraft.is_anonymous,
            hide_results_until_voted: pollDraft.hide_results_until_voted,
            closes_at: pollDraft.closes_at,
          })
          .select("id")
          .single();

        if (pollErr || !pollRow) {
          console.error("[posts.POST] poll insert failed, rolling back post:", pollErr);
          await serviceClient.from("community_posts").delete().eq("id", post.id);
          return NextResponse.json(
            { error: "투표 생성에 실패했습니다." },
            { status: 500 }
          );
        }

        const optionsPayload = cleanOptions.map((o) => ({
          poll_id: pollRow.id,
          position: o.position,
          label: o.label,
          image_url: o.image_url,
        }));

        const { error: optErr } = await serviceClient
          .from("community_poll_options")
          .insert(optionsPayload);

        if (optErr) {
          console.error("[posts.POST] poll options insert failed, rolling back:", optErr);
          await serviceClient.from("community_polls").delete().eq("id", pollRow.id);
          await serviceClient.from("community_posts").delete().eq("id", post.id);
          return NextResponse.json(
            { error: "투표 선택지 생성에 실패했습니다." },
            { status: 500 }
          );
        }
      }
    }

    // post_count 증가 — 실패해도 INSERT 응답에 영향 없도록 격리
    try {
      await serviceClient
        .rpc("community_increment_profile_count", {
          p_user_id: user.id,
          p_field: "post_count",
        })
        .then(({ error: rpcError }) => {
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
    } catch (e) {
      console.error("[posts.POST] post_count increment failed (non-fatal):", e);
    }

    // 새 글이 랜딩 / 커뮤니티 ISR 캐시에 즉시 반영되도록 — 실패해도 응답은 성공
    try {
      revalidatePath("/");
      revalidatePath("/community");
    } catch (e) {
      console.error("[posts.POST] revalidatePath failed (non-fatal):", e);
    }

    // price_data가 있으면 카테고리 무관 AI 코멘트 생성 — fire-and-forget
    // (코멘트는 결정론적 시세 벤치마크라 비용 부담 없음. 응답을 막지 않게 백그라운드 처리)
    if (priceData) {
      void (async () => {
        try {
          const aiComment = await generateAiPriceComment(priceData);
          if (aiComment) {
            await serviceClient
              .from("community_posts")
              .update({ ai_comment: aiComment })
              .eq("id", post.id);
          }
        } catch (aiErr) {
          console.error("AI comment generation failed:", aiErr);
        }
      })();
    }

    return NextResponse.json({ post }, { status: 201 });
  } catch (err) {
    console.error("Create post error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
