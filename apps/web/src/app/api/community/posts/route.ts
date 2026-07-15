import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  CommunityAuthorProfileUnavailableError,
  getCommunityAuthorMap,
  requireCommunityAuthor,
} from "@/lib/community/authorProfiles";
import { getCommunityActorIdForUser } from "@/lib/community/actorIdentity";
import {
  getCommunityNicknameFallback,
  getSafeDefaultCommunityNickname,
  isCommunityNicknameUniqueViolation,
} from "@/lib/community/nickname";
import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import { getMutedActorIds, mutedActorFilterValue } from "@/lib/community/mutes";
import {
  PUBLIC_COMMUNITY_POST_QUERY_FILTERS,
} from "@/lib/community/publicPostRules";
import { isCommunityCategory } from "@/lib/community/routes";
import { sanitizeHtml, sanitizeText } from "@/utils/sanitize";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord } from "@/utils/requestValidation";
import type {
  CommunityCategory,
  PostSort,
  TimePeriod,
  PostVisibility,
  AdDisclosure,
  PollSummary,
} from "@/types/community.types";

const MAX_POST_BODY_BYTES = 256 * 1024;
const ALLOWED_CREATE_POST_FIELDS = new Set([
  "category",
  "title",
  "content",
  "visibility",
  "tags",
  "ad_disclosure",
  "sponsorship_detail",
]);

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

// 게시글 목록 조회
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const { searchParams } = new URL(req.url);

    const categoryParam = searchParams.get("category");
    const category = isCommunityCategory(categoryParam) ? categoryParam : null;
    const sortParam = searchParams.get("sort") ?? "hot";
    if (sortParam === "my_cohort") {
      return NextResponse.json(
        {
          error: "동기방 게시글 모아보기는 현재 베타에서 제공하지 않습니다.",
          code: "community_cohort_feed_retired",
        },
        { status: 410, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!["hot", "new", "top", "my_posts"].includes(sortParam)) {
      return NextResponse.json(
        { error: "지원하지 않는 게시글 정렬 방식입니다." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const sort = sortParam as PostSort;
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
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      return NextResponse.json(
        { error: "로그인 상태를 확인하지 못했습니다." },
        {
          status: 503,
          headers: { "Cache-Control": "private, no-store, max-age=0" },
        },
      );
    }

    const viewerActorId = await getCommunityActorIdForUser(user?.id);
    const mutedActorIds = await getMutedActorIds(user?.id);
    const mutedActors = mutedActorFilterValue(mutedActorIds);

    const isLatestFeed = sort === "new";
    const isPersonalizedFeed = Boolean(user) || bookmarkedOnly || sort === "my_posts";
    const feedCacheControl = isPersonalizedFeed
      ? "private, no-store, max-age=0"
      : isLatestFeed
        ? "no-store, max-age=0"
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
      query = query.eq("author_public_id", authorId);
    }

    // 북마크 필터 — 본인이 북마크한 글의 id만 통과
    if (bookmarkedOnly && user) {
      const { data: bookmarks, error: bookmarksError } = await supabase
        .from("community_bookmarks")
        .select("post_id")
        .eq("user_id", user.id);
      if (bookmarksError) {
        return feedResponse(
          { error: "저장한 글을 불러오지 못했습니다. 잠시 후 다시 시도해주세요." },
          503,
        );
      }
      const bookmarkedIds = (bookmarks ?? []).map((b) => b.post_id as string);
      if (bookmarkedIds.length === 0) {
        return feedResponse({ posts: [], total: 0, hasMore: false, page, limit });
      }
      query = query.in("id", bookmarkedIds);
    }

    // 일반 피드에는 발행된 글만 표시한다. 본인의 임시저장/검토 중 글은
    // 상태가 명확한 `my_posts`에서만 조회한다.
    if (sort !== "my_posts") {
      query = user
        ? query
            .in("visibility", ["public", "members"])
            .eq("under_review", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.underReview)
        : query
            .eq("visibility", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.visibility)
            .eq("under_review", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.underReview);
    }

    // A mute is private to the signed-in reader and must be enforced by the
    // server before counting or paginating the feed.
    if (mutedActors) {
      query = query.not("author_public_id", "in", mutedActors);
    }

    // 정렬 + 내 글 필터
    if (sort === "my_posts") {
      // 비로그인은 빈 결과
      if (!user) {
        return feedResponse({ posts: [], total: 0, hasMore: false, page, limit });
      }
      // 본인 글만 + 최신순 (본인 글이라 visibility 무관 — RLS는 위에서 이미 적용됨)
      if (!viewerActorId) {
        return feedResponse({ posts: [], total: 0, hasMore: false, page, limit });
      }
      query = query.eq("author_public_id", viewerActorId).order("created_at", { ascending: false });
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
    if (
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      return feedResponse({ error: "게시글 수를 확인하지 못했습니다." }, 503);
    }

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
      const { data: votes, error: votesError } = await supabase
        .from("community_votes")
        .select("post_id, vote_type")
        .eq("user_id", user.id)
        .in("post_id", postIds);

      if (votesError) {
        return feedResponse({ error: "내 좋아요 상태를 불러오지 못했습니다." }, 503);
      }

      if (votes) {
        userVotesMap = Object.fromEntries(
          votes.map((v) => [v.post_id, v.vote_type])
        );
      }
    }

    // author 프로필 조회
    const authorIds = [...new Set(sortedPosts.map((p) => p.author_id))];
    const authorMap = await getCommunityAuthorMap(supabase, authorIds);

    // 폴 summary 조회 (목록 카드 배지용)
    let pollSummaryMap: Record<string, PollSummary> = {};
    if (sortedPosts.length > 0) {
      const postIds = sortedPosts.map((p) => p.id);
      const { data: polls, error: pollsError } = await supabase
        .from("community_polls")
        .select("id, post_id, question, total_voters, closes_at")
        .in("post_id", postIds);
      if (pollsError) {
        return feedResponse({ error: "게시글 투표 정보를 불러오지 못했습니다." }, 503);
      }
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
      author: requireCommunityAuthor(authorMap, post.author_id),
      viewer_is_author: Boolean(viewerActorId && post.author_id === viewerActorId),
      user_vote: userVotesMap[post.id] ?? null,
      poll: pollSummaryMap[post.id] ?? null,
    }));

    const total = count;
    const hasMore = offset + limit < total;

    return feedResponse({ posts: postsWithVotes, total, hasMore });
  } catch (err) {
    console.error("Community posts error:", err);
    if (err instanceof CommunityAuthorProfileUnavailableError) {
      return NextResponse.json(
        { error: "작성자 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// 게시글 생성
export async function POST(req: NextRequest) {
  try {
    if (isBodyTooLarge(req, MAX_POST_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      return NextResponse.json(
        { error: "로그인 상태를 확인하지 못했습니다." },
        { status: 503 },
      );
    }

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // Rate limit: 10 posts per 10 minutes per user
    const rlResult = await checkRateLimitPersistent(
      rateLimitKey("community:post:create", req, user.id),
      { maxRequests: 10, windowMs: 10 * 60 * 1000 },
      user.id,
    );
    if (rlResult) return rlResult;

    const rawBody = await req.text().catch(() => null);
    if (rawBody === null) {
      return NextResponse.json(
        { error: "게시글 요청을 읽지 못했습니다." },
        { status: 400 },
      );
    }
    if (new TextEncoder().encode(rawBody).byteLength > MAX_POST_BODY_BYTES) {
      return NextResponse.json(
        { error: "요청 데이터가 너무 큽니다." },
        { status: 413 },
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = null;
    }
    if (!isRecord(body)) {
      return NextResponse.json(
        { error: "잘못된 게시글 요청입니다." },
        { status: 400 },
      );
    }
    if (Object.prototype.hasOwnProperty.call(body, "poll")) {
      return NextResponse.json(
        {
          error: "새 투표 작성은 종료되었습니다. 기존 투표는 읽을 수 있습니다.",
          code: "community_poll_writes_retired",
        },
        { status: 410 },
      );
    }
    if (Object.prototype.hasOwnProperty.call(body, "price_data")) {
      return NextResponse.json(
        {
          error:
            "커뮤니티의 구조화 가격 입력은 중단되었습니다. 개인정보를 가린 실제 문서 문구와 확인할 질문은 본문에 적어주세요.",
          code: "community_structured_fields_retired",
          field: "price_data",
        },
        { status: 410 },
      );
    }
    const retiredFields = [
      "images",
      "slides",
      "cost_data",
      "ai_comment",
      "cohort_room_id",
      "is_quick_review",
      "is_verified_review",
      "verification_doc_url",
      "rating",
      "vendor_tags",
    ] as const;
    const retiredField = retiredFields.find((field) =>
      Object.prototype.hasOwnProperty.call(body, field),
    );
    if (retiredField) {
      return NextResponse.json(
        {
          error: "사진·업체 태그·평점·구조화 금액 입력은 현재 커뮤니티에서 제공하지 않습니다.",
          code: "community_structured_fields_retired",
          field: retiredField,
        },
        { status: 410 },
      );
    }
    const unknownField = Object.keys(body).find(
      (field) => !ALLOWED_CREATE_POST_FIELDS.has(field),
    );
    if (unknownField) {
      return NextResponse.json(
        { error: "지원하지 않는 게시글 입력 항목입니다.", field: unknownField },
        { status: 400 },
      );
    }
    const {
      category,
      title: rawTitle,
      content: rawContent,
      visibility,
      tags: rawTags,
      ad_disclosure: rawAdDisclosure,
      sponsorship_detail: rawSponsorshipDetail,
    } = body as {
      category: CommunityCategory;
      title: string;
      content: string;
      visibility: PostVisibility;
      tags?: string[];
      ad_disclosure?: AdDisclosure;
      sponsorship_detail?: string;
    };

    if (
      typeof rawTitle !== "string" ||
      rawTitle.length > 200 ||
      typeof rawContent !== "string" ||
      rawContent.length > 50_000 ||
      (rawSponsorshipDetail !== undefined &&
        (typeof rawSponsorshipDetail !== "string" ||
          rawSponsorshipDetail.length > 500)) ||
      (rawTags !== undefined &&
        (!Array.isArray(rawTags) ||
          rawTags.length > 10 ||
          rawTags.some((tag) => typeof tag !== "string" || tag.length > 30)))
    ) {
      return NextResponse.json(
        { error: "게시글 입력 형식이나 길이를 확인해주세요." },
        { status: 400 },
      );
    }

    // 광고 표시 필수 검증
    const validAdDisclosures: AdDisclosure[] = ["general", "sponsored", "ad"];
    if (!rawAdDisclosure || !validAdDisclosures.includes(rawAdDisclosure)) {
      return NextResponse.json(
        { error: "광고 표시 유형을 선택해주세요." },
        { status: 400 }
      );
    }
    const adDisclosure: AdDisclosure = rawAdDisclosure;
    if (adDisclosure !== "sponsored" && rawSponsorshipDetail !== undefined) {
      return NextResponse.json(
        { error: "협찬 내용은 협찬 포함 글에만 입력할 수 있습니다." },
        { status: 400 },
      );
    }
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

    // 입력 검증 및 정화
    const title = cleanOptionalText(rawTitle, 200);
    if (!title || title.length === 0) {
      return NextResponse.json(
        { error: "제목을 입력해주세요." },
        { status: 400 }
      );
    }

    if (/<\s*img\b/i.test(rawContent)) {
      return NextResponse.json(
        {
          error: "커뮤니티 미디어는 안전한 보관·삭제 수명주기가 검증될 때까지 제공하지 않습니다.",
          code: "community_media_retired",
        },
        { status: 410 },
      );
    }
    const content = sanitizeHtml(rawContent);
    if (!content || content.trim().length === 0) {
      return NextResponse.json(
        { error: "내용을 입력해주세요." },
        { status: 400 }
      );
    }
    // 태그 검증: 최대 10개, 각 최대 30자
    const tags = (rawTags ?? []).map((tag) => sanitizeText(tag));
    if (tags.some((tag) => tag.length === 0)) {
      return NextResponse.json(
        { error: "빈 태그는 저장할 수 없습니다." },
        { status: 400 },
      );
    }

    if (!isCommunityCategory(category) || !["public", "members", "draft"].includes(visibility)) {
      return NextResponse.json(
        { error: "카테고리와 공개 범위를 확인해주세요." },
        { status: 400 }
      );
    }

    const serviceClient = getServiceClient();

    // 커뮤니티 프로필 자동 생성 (없으면)
    const { data: existingProfile, error: existingProfileError } = await serviceClient
      .from("community_profiles")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingProfileError) {
      return NextResponse.json(
        { error: "작성자 프로필 상태를 확인하지 못했습니다." },
        { status: 503 },
      );
    }

    if (!existingProfile) {
      const nickname = getSafeDefaultCommunityNickname(null, user.id);
      const createProfilePayload = {
        user_id: user.id,
        badge: "member",
        post_count: 0,
        comment_count: 0,
        total_upvotes_received: 0,
      };

      let { error: profileInsertError } = await serviceClient
        .from("community_profiles")
        .insert({ ...createProfilePayload, nickname });

      for (let attempt = 1; attempt < 5; attempt += 1) {
        if (!profileInsertError || !isCommunityNicknameUniqueViolation(profileInsertError)) {
          break;
        }
        const retryResult = await serviceClient
          .from("community_profiles")
          .insert({
            ...createProfilePayload,
            nickname: getCommunityNicknameFallback(),
          });
        profileInsertError = retryResult.error;
      }

      if (profileInsertError) {
        return NextResponse.json(
          { error: "작성자 프로필을 만들지 못했습니다." },
          { status: 503 },
        );
      }
    }

    const authorActorId = await getCommunityActorIdForUser(user.id);
    if (!authorActorId) {
      return NextResponse.json(
        { error: "작성자 프로필을 확인하지 못했습니다." },
        { status: 503 },
      );
    }
    const authorMap = await getCommunityAuthorMap(serviceClient, [authorActorId]);
    const publicAuthor = requireCommunityAuthor(authorMap, authorActorId);

    // 게시글 생성
    const { data: post, error } = await serviceClient
      .from("community_posts")
      .insert({
        author_id: user.id,
        category,
        title,
        content,
        visibility,
        tags: tags ?? [],
        ad_disclosure: adDisclosure,
        sponsorship_detail: sponsorshipDetail,
        upvote_count: 0,
        downvote_count: 0,
        comment_count: 0,
        view_count: 0,
        bookmark_count: 0,
        is_pinned: false,
        is_weekly_best: false,
      })
      .select(COMMUNITY_POST_PUBLIC_SELECT)
      .single();

    if (error) {
      console.error("Create post error:", error);
      return NextResponse.json(
        { error: "게시글 작성에 실패했습니다." },
        { status: 500 }
      );
    }

    // 새 글이 랜딩 / 커뮤니티 ISR 캐시에 즉시 반영되도록 — 실패해도 응답은 성공
    try {
      revalidatePath("/");
      revalidatePath("/wedding");
      revalidatePath("/community");
    } catch (e) {
      console.error("[posts.POST] revalidatePath failed (non-fatal):", e);
    }

    return NextResponse.json(
      {
        post: {
          ...post,
          author: publicAuthor,
          viewer_is_author: true,
          user_vote: null,
          user_bookmarked: false,
          poll: null,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("Create post error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
