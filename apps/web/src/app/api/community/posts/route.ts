import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { buildSourceBackedPriceComment } from "@/lib/community/priceComment";
import { fallbackCommunityAuthor, getCommunityAuthorMap } from "@/lib/community/authorProfiles";
import {
  getSafeDefaultCommunityNickname,
} from "@/lib/community/nickname";
import {
  validateCommunityAttachmentUrl,
  validateCommunityHtmlImageSources,
  validateCommunityMediaUrl,
} from "@/lib/community/mediaUrls";
import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import { getCommunityPollActorProjection } from "@/lib/community/pollProjection";
import {
  PUBLIC_COMMUNITY_POST_QUERY_FILTERS,
  communityReadablePostOrFilter,
} from "@/lib/community/publicPostRules";
import {
  findObviousPublicPersonalInfo,
  PUBLIC_PERSONAL_INFO_BLOCK_MESSAGE,
} from "@/lib/community/publicPersonalInfo";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import { isCommunityCategory } from "@/lib/community/routes";
import {
  COMMUNITY_MEDIA_DISABLED_CODE,
  isCommunityMediaPublishingEnabled,
} from "@/lib/community/mediaPublishingGate";
import { sanitizeHtml, sanitizeText } from "@/utils/sanitize";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import {
  hasPresentedAuthCredential,
  isRecord,
  isUuid,
} from "@/utils/requestValidation";
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
import { log } from "@/utils/log";

const POST_SORTS: PostSort[] = [
  "hot",
  "new",
  "top",
  "unanswered",
  "resolved",
  "my_cohort",
  "my_posts",
];
// "free"에는 질문뿐 아니라 잡담도 섞이므로 상태 필터에 넣지 않는다.
// 질문/후기 구분을 category와 분리하는 DB 필드가 생기기 전까지는 명시적 질문 카테고리만 사용한다.
const QUESTION_CATEGORIES: CommunityCategory[] = ["is_normal", "ama"];

type AtomicPostResult = {
  post: Record<string, unknown>;
  poll_id: string | null;
  post_count: number;
};

function isAtomicPostResult(
  value: unknown,
  actorId: string,
): value is AtomicPostResult {
  return (
    isRecord(value)
    && isRecord(value.post)
    && isUuid(value.post.id)
    && value.post.author_id === actorId
    && (value.poll_id === null || isUuid(value.poll_id))
    && typeof value.post_count === "number"
    && Number.isSafeInteger(value.post_count)
    && value.post_count >= 0
    && !Object.hasOwn(value, "replayed")
  );
}

function postCommandFailure(error: { message?: string | null }) {
  const message = error.message ?? "";
  if (message.includes("COMMUNITY_POST_IDEMPOTENCY_CONFLICT")) {
    return NextResponse.json(
      {
        code: "COMMUNITY_POST_IDEMPOTENCY_CONFLICT",
        error: "같은 요청 식별자를 다른 게시글에 다시 사용할 수 없습니다.",
      },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (message.includes("COMMUNITY_SUSPENDED")) {
    return NextResponse.json(
      {
        code: "COMMUNITY_SUSPENDED",
        error: "현재 커뮤니티 작성 기능을 사용할 수 없습니다.",
      },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return NextResponse.json(
    {
      code: "COMMUNITY_POST_SAVE_FAILED",
      error: "게시글을 안전하게 저장하지 못했습니다. 같은 내용으로 다시 시도해 주세요.",
    },
    { status: 503, headers: { "Cache-Control": "private, no-store" } },
  );
}

async function generateAiPriceComment(priceData: PriceData): Promise<AiComment | null> {
  try {
    return buildSourceBackedPriceComment(priceData);
  } catch (err) {
    log.error("AI price comment inline error:", err);
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

function communityMediaPublishingDisabledResponse() {
  return NextResponse.json(
    {
      error: "지금은 커뮤니티 이미지 발행을 사용할 수 없어요.",
      code: COMMUNITY_MEDIA_DISABLED_CODE,
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "3600",
      },
    },
  );
}

// 게시글 목록 조회
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const { searchParams } = new URL(req.url);

    const categoryParam = searchParams.get("category");
    const category = isCommunityCategory(categoryParam) ? categoryParam : null;
    const requestedSort = searchParams.get("sort");
    const sort = POST_SORTS.includes(requestedSort as PostSort)
      ? (requestedSort as PostSort)
      : "hot";
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
      error: viewerError,
    } = await supabase.auth.getUser();

    if (viewerError && hasPresentedAuthCredential(req)) {
      return NextResponse.json(
        { error: "게시글 접근 권한을 확인하지 못했습니다." },
        {
          status: 503,
          headers: { "Cache-Control": "private, no-store, max-age=0" },
        },
      );
    }

    const isLatestFeed = sort === "new" || sort === "unanswered" || sort === "resolved";
    const isPersonalizedFeed = Boolean(user) || bookmarkedOnly || sort === "my_cohort" || sort === "my_posts";
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

    // 공개/멤버/작성자 전용 visibility와 under_review 규칙은 단일 Module에서 관리한다.
    if (user) {
      query = query.or(communityReadablePostOrFilter(user.id));
    } else {
      query = query
        .eq("visibility", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.visibility)
        .eq("under_review", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.underReview);
    }

    // 인기·추천 순위에는 광고와 협찬을 섞지 않는다. 최신순에서는 투명한 배지와
    // 대가 내용을 붙여 열람할 수 있지만, 반응 점수로 노출을 증폭시키지는 않는다.
    if (sort === "top" || sort === "hot" || sort === "unanswered" || sort === "resolved") {
      query = query.eq("ad_disclosure", "general");
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
    } else if (sort === "unanswered") {
      query = query
        .in("category", QUESTION_CATEGORIES)
        .eq("is_resolved", false)
        .eq("comment_count", 0)
        .order("created_at", { ascending: false });
    } else if (sort === "resolved") {
      query = query
        .in("category", QUESTION_CATEGORIES)
        .eq("is_resolved", true)
        .order("updated_at", { ascending: false });
    } else if (sort === "new") {
      // 고정 글 우선(운영자 앵커) → 그 다음 최신순
      query = query.order("is_pinned", { ascending: false }).order("created_at", { ascending: false });
    } else if (sort === "top") {
      // "도움된순"은 실제 도움돼요 반응이 있는 글만 뜻한다.
      // 0표 글까지 순위로 보여주면 빈 커뮤니티를 인기 목록처럼 오인시킨다.
      query = query.gt("upvote_count", 0);
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
      log.error("Community posts list error:", error);
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
      const { data: polls, error: pollReferencesError } = await supabase
        .from("community_polls")
        .select("id, post_id")
        .in("post_id", postIds);
      if (pollReferencesError) {
        log.error("Community poll references error:", pollReferencesError);
      } else if (polls) {
        const postById = new Map(sortedPosts.map((post) => [post.id, post]));
        const serviceClient = getServiceClient();
        const projections = await Promise.all(
          polls.map(async (poll) => {
            const parentPost = postById.get(poll.post_id);
            if (!parentPost) return null;

            if (user && parentPost.author_id !== user.id) {
              const { data: viewerCanSee, error: viewerControlError } = await serviceClient.rpc(
                "community_viewer_can_see" as never,
                {
                  p_viewer_user_id: user.id,
                  p_other_user_id: parentPost.author_id,
                } as never,
              ) as { data: unknown; error: unknown };
              if (viewerControlError || viewerCanSee !== true) return null;
            }

            try {
              return await getCommunityPollActorProjection(
                serviceClient,
                user?.id ?? null,
                poll.id,
              );
            } catch (error) {
              log.error("Community poll projection error:", error);
              return null;
            }
          }),
        );
        pollSummaryMap = Object.fromEntries(
          projections
            .filter((poll): poll is NonNullable<typeof poll> => poll !== null)
            .map((poll) => [
              poll.post_id,
              {
                id: poll.id,
                question: poll.question,
                total_voters: poll.total_voters,
                closes_at: poll.closes_at,
              } satisfies PollSummary,
            ]),
        );
      }
    }

    // 응답 데이터 조합
    const postsWithVotes = sortedPosts.map((post) => ({
      ...post,
      author: authorMap[post.author_id] ?? fallbackCommunityAuthor(post.author_id),
      user_vote: userVotesMap[post.id] ?? null,
      poll: pollSummaryMap[post.id] ?? null,
    }));

    const total = count ?? 0;
    const hasMore = offset + limit < total;

    return feedResponse({ posts: postsWithVotes, total, hasMore });
  } catch (err) {
    log.error("Community posts error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// 게시글 생성
export async function POST(req: NextRequest) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
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

    const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? "";
    if (!isUuid(idempotencyKey)) {
      return NextResponse.json(
        {
          code: "COMMUNITY_POST_IDEMPOTENCY_REQUIRED",
          error: "게시글 요청 식별자가 올바르지 않습니다. 새로고침 후 다시 시도해 주세요.",
        },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }

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

    const requestsMedia =
      (typeof rawContent === "string" && /<img\b/iu.test(rawContent))
      || (Array.isArray(rawImages) && rawImages.length > 0)
      || (Array.isArray(rawSlides) && rawSlides.length > 0)
      || Boolean(
        rawPoll?.options?.some(
          (option) =>
            typeof option?.image_url === "string"
            && option.image_url.trim().length > 0,
        ),
      );
    if (requestsMedia && !isCommunityMediaPublishingEnabled()) {
      return communityMediaPublishingDisabledResponse();
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
    // 최대 10장, 신규 슬라이드는 검증이 끝난 이미지 URL만 허용한다.
    // 잘못된 형식은 자동으로 제거. 결과 배열이 비면 null로 저장 (일반 글로 처리).
    let slides: Array<{ type: "image" | "video"; url: string; width?: number; height?: number; thumbnail_url?: string }> | null = null;
    if (Array.isArray(rawSlides) && rawSlides.length > 0) {
      const cleaned: Array<{ type: "image" | "video"; url: string; width?: number; height?: number; thumbnail_url?: string }> = [];
      for (const s of rawSlides.slice(0, 10)) {
        if (s?.type === "video") return invalidCommunityMediaResponse();
        const type = "image" as const;
        const mediaResult = validateCommunityMediaUrl(s?.url, {
          kind: type,
          ownerIds: user.id,
          requireUploadSessionPath: true,
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
            requireUploadSessionPath: true,
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
            requireUploadSessionPath: true,
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

    const personalInfoKinds = findObviousPublicPersonalInfo(
      title,
      content,
      sponsorshipDetail,
      priceData?.vendor_name,
      priceData?.region,
      priceData?.details,
      priceData ? JSON.stringify(priceData) : null,
      ...tags,
      cost_data ? JSON.stringify(cost_data) : null,
      pollDraft?.question,
      ...(pollDraft?.options.map((option) => option.label) ?? [])
    );
    if (personalInfoKinds.length > 0) {
      return NextResponse.json(
        {
          error: PUBLIC_PERSONAL_INFO_BLOCK_MESSAGE,
          code: "COMMUNITY_PERSONAL_INFO_DETECTED",
          detected: personalInfoKinds,
        },
        { status: 422 }
      );
    }

    const payload = {
      category,
      title,
      content,
      images,
      slides,
      visibility,
      vendor_tags,
      tags,
      cost_data: cost_data ?? null,
      ad_disclosure: adDisclosure,
      sponsorship_detail: sponsorshipDetail,
      price_data: priceData,
      is_quick_review: is_quick_review === true,
      rating: typeof rating === "number" ? rating : null,
      poll: pollDraft,
    };
    const serviceClient = getServiceClient();

    // Exact committed receipts bypass mutable rate, runtime and suspension
    // gates so a lost HTTP response can be recovered without another write.
    const { data: replayData, error: replayError } = await serviceClient.rpc(
      "community_replay_post_command_service",
      {
        p_actor_id: user.id,
        p_idempotency_key: idempotencyKey,
        p_payload: payload,
      },
    );
    if (replayError) return postCommandFailure(replayError);
    if (replayData !== null && replayData !== undefined) {
      if (!isAtomicPostResult(replayData, user.id)) {
        return NextResponse.json(
          {
            code: "COMMUNITY_POST_REPLAY_UNCONFIRMED",
            error: "저장된 게시글 결과를 안전하게 확인하지 못했습니다.",
          },
          { status: 503, headers: { "Cache-Control": "private, no-store" } },
        );
      }
      return NextResponse.json(replayData, {
        status: 201,
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    const writeAccess = await checkCommunityWriteAccess(supabase, user.id);
    if (!writeAccess.allowed) {
      return NextResponse.json(
        { error: writeAccess.message, code: writeAccess.code },
        { status: writeAccess.status },
      );
    }
    const rlResult = await checkRateLimitPersistent(
      rateLimitKey("community:post:create", req, user.id),
      { maxRequests: 10, windowMs: 10 * 60 * 1000 },
    );
    if (rlResult) return rlResult;

    const { data: userProfile, error: userProfileError } = await serviceClient
      .from("profiles")
      .select("name")
      .eq("id", user.id)
      .maybeSingle();
    if (userProfileError) {
      return NextResponse.json(
        {
          code: "COMMUNITY_PROFILE_SOURCE_UNAVAILABLE",
          error: "작성자 정보를 안전하게 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const profileNickname = getSafeDefaultCommunityNickname(userProfile?.name, user.id);
    const { data: atomicData, error: atomicError } = await serviceClient.rpc(
      "community_create_post_service",
      {
        p_actor_id: user.id,
        p_idempotency_key: idempotencyKey,
        p_profile_nickname: profileNickname,
        p_payload: payload,
      },
    );
    if (atomicError) {
      log.error("Atomic community post creation failed:", atomicError.code);
      return postCommandFailure(atomicError);
    }
    if (!isAtomicPostResult(atomicData, user.id)) {
      return NextResponse.json(
        {
          code: "COMMUNITY_POST_SAVE_UNCONFIRMED",
          error: "게시글 저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.",
        },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const post = atomicData.post;

    // 새 글이 랜딩 / 커뮤니티 ISR 캐시에 즉시 반영되도록 — 실패해도 응답은 성공
    try {
      revalidatePath("/");
      revalidatePath("/wedding");
      revalidatePath("/community");
    } catch (e) {
      log.error("[posts.POST] revalidatePath failed (non-fatal):", e);
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
          log.error("AI comment generation failed:", aiErr);
        }
      })();
    }

    return NextResponse.json(atomicData, {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    log.error("Create post error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
