import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { buildSourceBackedPriceComment } from "@/lib/community/priceComment";
import { fallbackCommunityAuthor, getCommunityAuthorMap } from "@/lib/community/authorProfiles";
import { getSafeDefaultCommunityNickname } from "@/lib/community/nickname";
import {
  validateCommunityAttachmentUrl,
  validateCommunityHtmlImageSources,
  validateCommunityMediaUrl,
} from "@/lib/community/mediaUrls";
import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import {
  PUBLIC_COMMUNITY_POST_QUERY_FILTERS,
  communityReadablePostOrFilter,
} from "@/lib/community/publicPostRules";
import {
  COMMUNITY_POLL_SERVER_SELECT,
  areCommunityPollResultsVisible,
} from "@/lib/community/pollVisibility";
import { isCommunityCategory } from "@/lib/community/routes";
import { requestMatchesExpectedCommunityActor } from "@/lib/community/actorFence";
import {
  getCommunityPublicIdForUser,
  getCommunityPublicIdsForUsers,
} from "@/lib/community/publicIdentity";
import { sanitizeHtmlWithInputLimit, sanitizeText } from "@/utils/sanitize";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, isUuid, readBoundedJsonValue } from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import type {
  PostSort,
  TimePeriod,
  PriceData,
  AiComment,
  PollSummary,
} from "@/types/community.types";

const MAX_BODY_BYTES = 512 * 1024;
const POST_SORTS = new Set<PostSort>(["hot", "new", "top", "my_cohort", "my_posts"]);
const TIME_PERIODS = new Set<TimePeriod>(["week", "month", "all"]);

async function generateAiPriceComment(priceData: PriceData): Promise<AiComment | null> {
  try {
    return buildSourceBackedPriceComment(priceData);
  } catch (err) {
    console.error("AI price comment inline error:", safeErrorDiagnostic(err));
    return null;
  }
}

function getServiceClient() {
  return createAdminClient();
}

function cleanOptionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = sanitizeText(value).slice(0, maxLength);
  return cleaned.length > 0 ? cleaned : undefined;
}

function invalidCommunityMediaResponse() {
  return NextResponse.json(
    { error: "커뮤니티 업로드로 등록된 이미지만 첨부할 수 있습니다." },
    { status: 400 }
  );
}

// 게시글 목록 조회
export async function GET(req: NextRequest) {
  try {
    const ingressLimited = await checkRateLimitPersistent(
      rateLimitKey("community:posts:list", req),
      { maxRequests: 180, windowMs: 60 * 1000 },
    );
    if (ingressLimited) return ingressLimited;

    const supabase = await createClientFromRequest(req);
    const { searchParams } = new URL(req.url);

    const categoryParam = searchParams.get("category");
    const category = isCommunityCategory(categoryParam) ? categoryParam : null;
    const requestedSort = searchParams.get("sort") as PostSort | null;
    const requestedPeriod = searchParams.get("period") as TimePeriod | null;
    const sort = requestedSort && POST_SORTS.has(requestedSort) ? requestedSort : "hot";
    const period = requestedPeriod && TIME_PERIODS.has(requestedPeriod) ? requestedPeriod : "week";
    const page = Math.max(1, Math.min(200, parseInt(searchParams.get("page") ?? "1") || 1));
    const limit = Math.max(1, Math.min(50, parseInt(searchParams.get("limit") ?? "20") || 20));
    const tag = cleanOptionalText(searchParams.get("tag"), 60) ?? null;
    const authorParam = searchParams.get("author_id");
    const authorId = isUuid(authorParam) ? authorParam : null;
    const bookmarkedOnly = searchParams.get("bookmarked") === "true";
    const offset = (page - 1) * limit;

    // 현재 사용자 확인 (선택적)
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const serviceClient = getServiceClient();
    const viewerPublicId = await getCommunityPublicIdForUser(
      serviceClient,
      user?.id,
    );

    const isLatestFeed = sort === "new";
    const isPersonalizedFeed = Boolean(user) || bookmarkedOnly || sort === "my_cohort" || sort === "my_posts";
    const feedCacheControl = isPersonalizedFeed
      ? "private, no-store, max-age=0"
      : isLatestFeed
        ? "no-store, max-age=0"
      : "public, s-maxage=10, stale-while-revalidate=30";
    const feedResponse = (payload: unknown, status = 200) =>
      NextResponse.json(payload, {
        status,
        headers: {
          "Cache-Control": feedCacheControl,
          Vary: "Cookie, Authorization",
        },
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

    // 공개/멤버/작성자 전용 visibility와 under_review 규칙은 단일 Module에서 관리한다.
    if (user && viewerPublicId) {
      query = query.or(communityReadablePostOrFilter(viewerPublicId));
    } else if (user) {
      // A missing pseudonym must not fall back to the Auth UUID. The account
      // can still read ordinary member content, but owner-only rows fail shut.
      query = query.or([
        "and(visibility.eq.public,under_review.eq.false)",
        "and(visibility.eq.members,under_review.eq.false)",
      ].join(","));
    } else {
      query = query
        .eq("visibility", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.visibility)
        .eq("under_review", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.underReview);
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
      const memberPublicIds = await getCommunityPublicIdsForUsers(
        serviceClient,
        memberIds,
      );
      if (memberPublicIds.length === 0) {
        // 동기방에 나밖에 없음 → 빈 결과
        return feedResponse({ posts: [], total: 0, hasMore: false, page, limit });
      }
      // 3. 동기들이 작성한 글만 + 최신순
      query = query.in("author_public_id", memberPublicIds).order("created_at", { ascending: false });
    } else if (sort === "my_posts") {
      // 비로그인은 빈 결과
      if (!user) {
        return feedResponse({ posts: [], total: 0, hasMore: false, page, limit });
      }
      if (!viewerPublicId) {
        return feedResponse({ posts: [], total: 0, hasMore: false, page, limit });
      }
      // 본인 글만 + 최신순 (본인 글이라 visibility 무관 — RLS는 위에서 이미 적용됨)
      query = query.eq("author_public_id", viewerPublicId).order("created_at", { ascending: false });
    } else if (sort === "new") {
      // 고정 글 우선(운영자 앵커) → 그 다음 최신순
      query = query.order("is_pinned", { ascending: false }).order("created_at", { ascending: false });
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
      console.error("Community posts list error:", safeErrorDiagnostic(error));
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
    const authorMap = await getCommunityAuthorMap(supabase, authorIds);

    // 폴 summary 조회 (목록 카드 배지용)
    let pollSummaryMap: Record<string, PollSummary> = {};
    if (sortedPosts.length > 0) {
      const postIds = sortedPosts.map((p) => p.id);
      const { data: polls } = await getServiceClient()
        .from("community_polls")
        .select(COMMUNITY_POLL_SERVER_SELECT)
        .in("post_id", postIds);
      if (polls) {
        const pollIds = polls.map((poll) => poll.id as string);
        let votedPollIds = new Set<string>();
        if (user && pollIds.length > 0) {
          const { data: pollVotes } = await supabase
            .from("community_poll_votes")
            .select("poll_id")
            .eq("user_id", user.id)
            .in("poll_id", pollIds);
          votedPollIds = new Set(
            (pollVotes ?? []).map((vote) => vote.poll_id as string),
          );
        }

        pollSummaryMap = Object.fromEntries(
          polls.map((poll) => [
            poll.post_id,
            {
              id: poll.id,
              question: poll.question,
              total_voters: areCommunityPollResultsVisible(
                poll,
                votedPollIds.has(poll.id as string),
              )
                ? poll.total_voters
                : 0,
              closes_at: poll.closes_at,
            } satisfies PollSummary,
          ])
        );
      }
    }

    // 응답 데이터 조합
    const postsWithVotes = sortedPosts.map((post) => ({
      ...post,
      author: authorMap[post.author_id] ?? fallbackCommunityAuthor(post.author_id),
      is_author: Boolean(viewerPublicId && post.author_id === viewerPublicId),
      user_vote: userVotesMap[post.id] ?? null,
      poll: pollSummaryMap[post.id] ?? null,
    }));

    const total = count ?? 0;
    const hasMore = offset + limit < total;

    return feedResponse({ posts: postsWithVotes, total, hasMore });
  } catch (err) {
    console.error("Community posts error:", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// 게시글 생성
function invalidPostInput(message = "입력값을 확인해 주세요.") {
  return NextResponse.json({ error: message }, { status: 400 });
}

function atomicPostErrorStatus(error: unknown): number {
  if (!isRecord(error) || typeof error.code !== "string") return 500;
  if (error.code === "P0002") return 404;
  if (error.code === "42501") return 403;
  if (
    error.code.startsWith("22")
    || ["23502", "23514"].includes(error.code)
  ) {
    return 400;
  }
  return 500;
}

// 게시글 작성
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 },
      );
    }

    if (!requestMatchesExpectedCommunityActor(req, user.id)) {
      return NextResponse.json(
        { error: "계정이 변경되어 글 작성을 중단했습니다. 다시 확인해 주세요." },
        { status: 409 },
      );
    }

    const rlResult = await checkRateLimitPersistent(
      rateLimitKey("community:post:create", req, user.id),
      { maxRequests: 10, windowMs: 10 * 60 * 1000 },
    );
    if (rlResult) return rlResult;

    const bodyResult = await readBoundedJsonValue(req, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      return NextResponse.json(
        {
          error:
            bodyResult.reason === "too_large"
              ? "요청 본문이 너무 큽니다."
              : "잘못된 요청입니다.",
        },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }
    if (!isRecord(bodyResult.value)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    const body = bodyResult.value;

    const category =
      typeof body.category === "string" && isCommunityCategory(body.category)
        ? body.category
        : null;
    const visibility =
      body.visibility === "public"
      || body.visibility === "members"
      || body.visibility === "draft"
        ? body.visibility
        : null;
    if (!category || !visibility) {
      return invalidPostInput("카테고리와 공개 범위를 확인해 주세요.");
    }

    const title = cleanOptionalText(body.title, 200);
    if (!title) {
      return invalidPostInput("제목을 입력해 주세요.");
    }

    const content = sanitizeHtmlWithInputLimit(
      typeof body.content === "string" ? body.content : "",
      50000,
    );
    const contentImagesResult = validateCommunityHtmlImageSources(content, {
      ownerIds: user.id,
    });
    if (!contentImagesResult.ok) return invalidCommunityMediaResponse();

    const rawImageValues = body.images === undefined ? [] : body.images;
    if (!Array.isArray(rawImageValues) || rawImageValues.length > 10) {
      return invalidPostInput("이미지는 최대 10개까지 등록할 수 있습니다.");
    }
    const images: string[] = [];
    for (const rawImageUrl of rawImageValues) {
      const mediaResult = validateCommunityAttachmentUrl(rawImageUrl, {
        ownerIds: user.id,
      });
      if (!mediaResult.ok) return invalidCommunityMediaResponse();
      images.push(mediaResult.url);
    }

    const rawSlideValues =
      body.slides === undefined || body.slides === null ? [] : body.slides;
    if (!Array.isArray(rawSlideValues) || rawSlideValues.length > 10) {
      return invalidPostInput("슬라이드는 최대 10개까지 등록할 수 있습니다.");
    }
    const cleanedSlides: Array<{
      type: "image";
      url: string;
      width?: number;
      height?: number;
      thumbnail_url?: string;
    }> = [];
    const allowedSlideKeys = new Set([
      "type",
      "url",
      "width",
      "height",
      "thumbnail_url",
    ]);
    for (const rawSlide of rawSlideValues) {
      if (
        !isRecord(rawSlide)
        || Object.keys(rawSlide).some((key) => !allowedSlideKeys.has(key))
        || rawSlide.type !== "image"
      ) {
        return invalidPostInput("슬라이드 형식을 확인해 주세요.");
      }

      const mediaResult = validateCommunityMediaUrl(rawSlide.url, {
        kind: "image",
        ownerIds: user.id,
        requireUploadSessionPath: true,
      });
      if (!mediaResult.ok) return invalidCommunityMediaResponse();

      const slide: {
        type: "image";
        url: string;
        width?: number;
        height?: number;
        thumbnail_url?: string;
      } = {
        type: "image",
        url: mediaResult.url,
      };

      if (rawSlide.width !== undefined && rawSlide.width !== null) {
        if (
          typeof rawSlide.width !== "number"
          || !Number.isSafeInteger(rawSlide.width)
          || rawSlide.width < 1
          || rawSlide.width > 8192
        ) {
          return invalidPostInput("슬라이드 너비를 확인해 주세요.");
        }
        slide.width = rawSlide.width;
      }
      if (rawSlide.height !== undefined && rawSlide.height !== null) {
        if (
          typeof rawSlide.height !== "number"
          || !Number.isSafeInteger(rawSlide.height)
          || rawSlide.height < 1
          || rawSlide.height > 8192
        ) {
          return invalidPostInput("슬라이드 높이를 확인해 주세요.");
        }
        slide.height = rawSlide.height;
      }
      if (
        rawSlide.thumbnail_url !== undefined
        && rawSlide.thumbnail_url !== null
      ) {
        if (typeof rawSlide.thumbnail_url !== "string") {
          return invalidPostInput("슬라이드 썸네일을 확인해 주세요.");
        }
        const thumbnailResult = validateCommunityMediaUrl(
          rawSlide.thumbnail_url,
          {
            kind: "image",
            ownerIds: user.id,
            requireUploadSessionPath: true,
          },
        );
        if (!thumbnailResult.ok) return invalidCommunityMediaResponse();
        slide.thumbnail_url = thumbnailResult.url;
      }
      cleanedSlides.push(slide);
    }
    const slides = cleanedSlides.length > 0 ? cleanedSlides : null;
    if (content.trim().length === 0 && !slides) {
      return invalidPostInput("내용을 입력해 주세요.");
    }

    const rawTagValues = body.tags === undefined ? [] : body.tags;
    if (
      !Array.isArray(rawTagValues)
      || rawTagValues.length > 10
      || rawTagValues.some((tag) => typeof tag !== "string")
    ) {
      return invalidPostInput("태그 형식을 확인해 주세요.");
    }
    const tags = rawTagValues.map((tag) =>
      sanitizeText(tag as string).slice(0, 30)
    );
    if (tags.some((tag) => tag.length === 0)) {
      return invalidPostInput("빈 태그는 등록할 수 없습니다.");
    }

    const rawVendorTagValues =
      body.vendor_tags === undefined ? [] : body.vendor_tags;
    if (
      !Array.isArray(rawVendorTagValues)
      || rawVendorTagValues.length > 5
      || rawVendorTagValues.some((tag) => !isUuid(tag))
    ) {
      return invalidPostInput("업체 태그 형식을 확인해 주세요.");
    }
    const vendorTags = rawVendorTagValues as string[];

    let costData: Record<string, unknown> | null = null;
    if (body.cost_data !== undefined && body.cost_data !== null) {
      if (!isRecord(body.cost_data)) {
        return invalidPostInput("비용 공유 데이터 형식을 확인해 주세요.");
      }
      const costDataBytes = new TextEncoder().encode(
        JSON.stringify(body.cost_data),
      ).byteLength;
      if (costDataBytes > 131072) {
        return invalidPostInput("비용 공유 데이터가 너무 큽니다.");
      }
      costData = body.cost_data;
    }

    const validAdDisclosures = new Set(["general", "sponsored", "ad"]);
    if (
      typeof body.ad_disclosure !== "string"
      || !validAdDisclosures.has(body.ad_disclosure)
    ) {
      return invalidPostInput("광고 표시 유형을 선택해 주세요.");
    }
    const adDisclosure = body.ad_disclosure;
    let sponsorshipDetail: string | null = null;
    if (adDisclosure === "sponsored") {
      sponsorshipDetail =
        cleanOptionalText(body.sponsorship_detail, 500) ?? null;
      if (!sponsorshipDetail || sponsorshipDetail.length < 5) {
        return invalidPostInput("협찬 내용을 5자 이상 입력해 주세요.");
      }
    } else if (
      body.sponsorship_detail !== undefined
      && body.sponsorship_detail !== null
      && cleanOptionalText(body.sponsorship_detail, 500)
    ) {
      return invalidPostInput("협찬 글에만 협찬 내용을 입력할 수 있습니다.");
    }

    let priceData: PriceData | null = null;
    if (body.price_data !== undefined && body.price_data !== null) {
      if (!isRecord(body.price_data)) {
        return invalidPostInput("가격 데이터 형식을 확인해 주세요.");
      }
      const rawPriceData = body.price_data;
      const allowedPriceKeys = new Set([
        "vendor_category",
        "base_price",
        "extra_price",
        "vendor_name",
        "region",
        "details",
      ]);
      const validPriceCategories = new Set([
        "venue",
        "studio",
        "dress",
        "makeup",
        "snap",
        "ring",
        "honeymoon",
        "other",
      ]);
      if (
        Object.keys(rawPriceData).some((key) => !allowedPriceKeys.has(key))
        || typeof rawPriceData.vendor_category !== "string"
        || !validPriceCategories.has(rawPriceData.vendor_category)
        || typeof rawPriceData.base_price !== "number"
        || !Number.isSafeInteger(rawPriceData.base_price)
        || rawPriceData.base_price < 1
        || rawPriceData.base_price > 1_000_000_000
      ) {
        return invalidPostInput("가격 데이터 값을 확인해 주세요.");
      }
      if (
        rawPriceData.extra_price !== undefined
        && rawPriceData.extra_price !== null
        && (
          typeof rawPriceData.extra_price !== "number"
          || !Number.isSafeInteger(rawPriceData.extra_price)
          || rawPriceData.extra_price < 0
          || rawPriceData.extra_price > 1_000_000_000
        )
      ) {
        return invalidPostInput("추가 비용 값을 확인해 주세요.");
      }

      for (const textField of ["vendor_name", "region", "details"] as const) {
        const value = rawPriceData[textField];
        if (value !== undefined && value !== null && typeof value !== "string") {
          return invalidPostInput("가격 데이터의 텍스트 값을 확인해 주세요.");
        }
      }

      priceData = {
        vendor_category:
          rawPriceData.vendor_category as PriceData["vendor_category"],
        base_price: rawPriceData.base_price,
      };
      if (typeof rawPriceData.extra_price === "number") {
        priceData.extra_price = rawPriceData.extra_price;
      }
      const vendorName = cleanOptionalText(rawPriceData.vendor_name, 100);
      const region = cleanOptionalText(rawPriceData.region, 100);
      const details = cleanOptionalText(rawPriceData.details, 1000);
      if (vendorName) priceData.vendor_name = vendorName;
      if (region) priceData.region = region;
      if (details) priceData.details = details;
    }

    const isQuickReview =
      body.is_quick_review === undefined ? false : body.is_quick_review;
    if (typeof isQuickReview !== "boolean") {
      return invalidPostInput("후기 유형 값을 확인해 주세요.");
    }

    let normalizedRating: number | null = null;
    if (body.rating !== undefined && body.rating !== null) {
      if (
        typeof body.rating !== "number"
        || !Number.isInteger(body.rating)
        || body.rating < 1
        || body.rating > 5
      ) {
        return invalidPostInput("별점은 1점부터 5점까지 입력해 주세요.");
      }
      normalizedRating = body.rating;
    }

    let pollDraft: {
      question: string;
      options: Array<{
        position: number;
        label: string;
        image_url: string | null;
      }>;
      allow_multiple: boolean;
      is_anonymous: boolean;
      hide_results_until_voted: boolean;
      closes_at: string | null;
    } | null = null;
    if (body.poll !== undefined && body.poll !== null) {
      if (!isRecord(body.poll)) {
        return invalidPostInput("투표 형식을 확인해 주세요.");
      }
      const rawPoll = body.poll;
      const allowedPollKeys = new Set([
        "question",
        "options",
        "allow_multiple",
        "is_anonymous",
        "hide_results_until_voted",
        "closes_at",
      ]);
      if (Object.keys(rawPoll).some((key) => !allowedPollKeys.has(key))) {
        return invalidPostInput("투표 형식을 확인해 주세요.");
      }

      const question = cleanOptionalText(rawPoll.question, 200);
      if (!question) {
        return invalidPostInput("투표 질문을 입력해 주세요.");
      }
      if (
        !Array.isArray(rawPoll.options)
        || rawPoll.options.length < 2
        || rawPoll.options.length > 10
      ) {
        return invalidPostInput("투표 선택지는 2개부터 10개까지 등록할 수 있습니다.");
      }

      const options: Array<{
        position: number;
        label: string;
        image_url: string | null;
      }> = [];
      const allowedOptionKeys = new Set(["label", "image_url"]);
      for (const rawOption of rawPoll.options) {
        if (
          !isRecord(rawOption)
          || Object.keys(rawOption).some((key) => !allowedOptionKeys.has(key))
        ) {
          return invalidPostInput("투표 선택지 형식을 확인해 주세요.");
        }
        const label = cleanOptionalText(rawOption.label, 100);
        if (!label) {
          return invalidPostInput("투표 선택지 내용을 입력해 주세요.");
        }

        let imageUrl: string | null = null;
        if (
          rawOption.image_url !== undefined
          && rawOption.image_url !== null
        ) {
          if (typeof rawOption.image_url !== "string") {
            return invalidPostInput("투표 선택지 이미지를 확인해 주세요.");
          }
          const imageResult = validateCommunityMediaUrl(
            rawOption.image_url,
            {
              kind: "image",
              ownerIds: user.id,
              requireUploadSessionPath: true,
            },
          );
          if (!imageResult.ok) return invalidCommunityMediaResponse();
          imageUrl = imageResult.url;
        }

        options.push({
          position: options.length,
          label,
          image_url: imageUrl,
        });
      }

      const allowMultiple =
        rawPoll.allow_multiple === undefined
          ? false
          : rawPoll.allow_multiple;
      const isAnonymous =
        rawPoll.is_anonymous === undefined ? false : rawPoll.is_anonymous;
      const hideResultsUntilVoted =
        rawPoll.hide_results_until_voted === undefined
          ? false
          : rawPoll.hide_results_until_voted;
      if (
        typeof allowMultiple !== "boolean"
        || typeof isAnonymous !== "boolean"
        || typeof hideResultsUntilVoted !== "boolean"
      ) {
        return invalidPostInput("투표 설정 값을 확인해 주세요.");
      }

      let closesAt: string | null = null;
      if (rawPoll.closes_at !== undefined && rawPoll.closes_at !== null) {
        if (typeof rawPoll.closes_at !== "string") {
          return invalidPostInput("투표 마감 시간을 확인해 주세요.");
        }
        const closesAtMs = Date.parse(rawPoll.closes_at);
        if (!Number.isFinite(closesAtMs) || closesAtMs <= Date.now()) {
          return invalidPostInput("투표 마감 시간은 미래여야 합니다.");
        }
        closesAt = new Date(closesAtMs).toISOString();
      }

      pollDraft = {
        question,
        options,
        allow_multiple: allowMultiple,
        is_anonymous: isAnonymous,
        hide_results_until_voted: hideResultsUntilVoted,
        closes_at: closesAt,
      };
    }

    const serviceClient = getServiceClient();
    const nickname = getSafeDefaultCommunityNickname(undefined, user.id);
    const { data: post, error } = await serviceClient
      .rpc("community_create_post_with_poll_atomic", {
        p_actor_id: user.id,
        p_default_nickname: nickname,
        p_category: category,
        p_title: title,
        p_content: content,
        p_images: images,
        p_slides: slides,
        p_visibility: visibility,
        p_vendor_tags: vendorTags,
        p_tags: tags,
        p_cost_data: costData,
        p_ad_disclosure: adDisclosure,
        p_sponsorship_detail: sponsorshipDetail,
        p_price_data: priceData,
        p_is_quick_review: isQuickReview,
        p_rating: normalizedRating,
        p_poll: pollDraft,
      })
      .select(COMMUNITY_POST_PUBLIC_SELECT)
      .single();

    if (error || !post) {
      console.error("Create post atomic RPC error:", safeErrorDiagnostic(error));
      const status = atomicPostErrorStatus(error);
      const message =
        status === 400
          ? "게시글 입력값을 확인해 주세요."
          : status === 403
            ? "현재 계정으로는 게시글을 작성할 수 없습니다."
          : status === 404
            ? "게시글 작성 대상을 찾을 수 없습니다."
            : "게시글 작성에 실패했습니다.";
      return NextResponse.json({ error: message }, { status });
    }

    try {
      revalidatePath("/");
      revalidatePath("/wedding");
      revalidatePath("/community");
    } catch (error) {
      console.error(
        "[posts.POST] revalidatePath failed (non-fatal):",
        safeErrorDiagnostic(error),
      );
    }

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
        } catch (aiError) {
          console.error(
            "AI comment generation failed:",
            safeErrorDiagnostic(aiError),
          );
        }
      })();
    }

    return NextResponse.json(
      { post: { ...post, is_author: true } },
      { status: 201 },
    );
  } catch (err) {
    console.error("Create post error:", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
