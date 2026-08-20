import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import { fallbackCommunityAuthor, getCommunityAuthorMap } from "@/lib/community/authorProfiles";
import { canReadCommunityPost } from "@/lib/community/publicPostRules";
import { getCommunityPollActorProjection } from "@/lib/community/pollProjection";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import {
  findObviousPublicPersonalInfo,
  PUBLIC_PERSONAL_INFO_BLOCK_MESSAGE,
} from "@/lib/community/publicPersonalInfo";
import {
  validateCommunityAttachmentUrl,
  validateCommunityHtmlImageSources,
  validateCommunityMediaUrl,
  validateRetainedCommunityImageUrl,
  validateRetainedCommunityVideoUrl,
} from "@/lib/community/mediaUrls";
import {
  COMMUNITY_MEDIA_DISABLED_CODE,
  isCommunityMediaPatchAllowedWhileDisabled,
  isCommunityMediaPublishingEnabled,
} from "@/lib/community/mediaPublishingGate";
import { sanitizeHtml, sanitizeText } from "@/utils/sanitize";
import {
  hasPresentedAuthCredential,
  isRecord,
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import type {
  AdDisclosure,
  PollWithOptions,
  PostVisibility,
  PriceData,
  UpdatePostInput,
} from "@/types/community.types";

const VALID_POST_VISIBILITIES: PostVisibility[] = ["public", "members", "draft"];
const MAX_POST_PATCH_BODY_BYTES = 512 * 1024;
const POST_PATCH_FIELDS = new Set([
  "title",
  "content",
  "images",
  "slides",
  "visibility",
  "vendor_tags",
  "tags",
  "ad_disclosure",
  "sponsorship_detail",
  "price_data",
  "is_resolved",
  "cost_data",
]);
const SLIDE_FIELDS = new Set(["type", "url", "width", "height", "thumbnail_url"]);
const PRICE_FIELDS = new Set([
  "vendor_category",
  "base_price",
  "extra_price",
  "vendor_name",
  "region",
  "details",
]);

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isValidPostPatchBody(body: Record<string, unknown>): boolean {
  if (Object.keys(body).some((field) => !POST_PATCH_FIELDS.has(field))) return false;
  if (!isOptionalString(body.title) || !isOptionalString(body.content)) return false;
  if (!isOptionalString(body.visibility) || !isOptionalString(body.ad_disclosure)) return false;
  if (
    body.sponsorship_detail !== undefined
    && body.sponsorship_detail !== null
    && typeof body.sponsorship_detail !== "string"
  ) return false;
  if (
    body.is_resolved !== undefined
    && typeof body.is_resolved !== "boolean"
  ) return false;

  for (const field of ["images", "vendor_tags", "tags"] as const) {
    const value = body[field];
    if (
      value !== undefined
      && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    ) return false;
  }

  if (body.slides !== undefined && body.slides !== null) {
    if (!Array.isArray(body.slides)) return false;
    for (const slide of body.slides) {
      if (
        !isRecord(slide)
        || Object.keys(slide).some((field) => !SLIDE_FIELDS.has(field))
        || (slide.type !== "image" && slide.type !== "video")
        || typeof slide.url !== "string"
        || !isOptionalFiniteNumber(slide.width)
        || !isOptionalFiniteNumber(slide.height)
        || !isOptionalString(slide.thumbnail_url)
      ) return false;
    }
  }

  if (body.price_data !== undefined && body.price_data !== null) {
    const price = body.price_data;
    if (
      !isRecord(price)
      || Object.keys(price).some((field) => !PRICE_FIELDS.has(field))
      || typeof price.vendor_category !== "string"
      || typeof price.base_price !== "number"
      || !Number.isFinite(price.base_price)
      || !isOptionalFiniteNumber(price.extra_price)
      || !isOptionalString(price.vendor_name)
      || !isOptionalString(price.region)
      || !isOptionalString(price.details)
    ) return false;
  }

  if (
    body.cost_data !== undefined
    && body.cost_data !== null
    && !isRecord(body.cost_data)
  ) return false;

  return true;
}

function logContentFreeFailure(
  scope: string,
  category: "database" | "cache" | "unexpected",
  sourceCode: unknown,
) {
  const code =
    typeof sourceCode === "string" && /^[A-Z0-9_]{1,64}$/u.test(sourceCode)
      ? sourceCode
      : "UNCLASSIFIED";
  console.error(scope, { category, code });
}
const PRIVATE_DETAIL_NO_STORE = "private, no-store, max-age=0";
const VIEWER_VARY = "Authorization, Cookie";

type AtomicPostDeleteResult = {
  actor_id: string;
  post_id: string;
  deleted: boolean;
  post_count: number;
};

function isAtomicPostDeleteResult(
  value: unknown,
  actorId: string,
  postId: string,
): value is AtomicPostDeleteResult {
  return (
    isRecord(value)
    && isUuid(value.actor_id)
    && value.actor_id === actorId
    && isUuid(value.post_id)
    && value.post_id === postId
    && value.deleted === true
    && typeof value.post_count === "number"
    && Number.isSafeInteger(value.post_count)
    && value.post_count >= 0
    && !Object.hasOwn(value, "replayed")
  );
}

function getServiceClient() {
  return createAdminClient();
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
      error: "통제 베타에서는 새 이미지 발행이나 기존 이미지 변경을 아직 사용할 수 없어요.",
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

async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await getServiceClient()
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .single();
  return data?.is_admin === true;
}

// 게시글 상세 조회
async function getPostResponse(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(req);

    const {
      data: { user },
      error: viewerError,
    } = await supabase.auth.getUser();

    // 로그아웃 방문자에게는 getUser()가 항상 에러다. 자격 증명을 실제로 제시한
    // 요청만 503으로 닫는다 — 목록 라우트와 같은 기준. 그러지 않으면 공개 글
    // 상세가 비로그인 사용자 전원에게 503이 된다.
    if (viewerError && hasPresentedAuthCredential(req)) {
      return NextResponse.json(
        { error: "게시글 접근 권한을 확인하지 못했습니다." },
        { status: 503 },
      );
    }

    // 게시글 + 작성자 정보 조회
    const { data: post, error } = await supabase
      .from("community_posts")
      .select(
        COMMUNITY_POST_PUBLIC_SELECT
      )
      .eq("id", id)
      .single();

    if (error || !post) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const userIsAdmin = user ? await isAdmin(user.id) : false;
    const canReadPost = canReadCommunityPost(post, {
      userId: user?.id ?? null,
      isAdmin: userIsAdmin,
    });

    if (!canReadPost) {
      const requiresLogin = post.visibility === "members" && !user && post.under_review !== true;
      return NextResponse.json(
        { error: requiresLogin ? "로그인이 필요합니다." : "게시글을 찾을 수 없습니다." },
        { status: requiresLogin ? 401 : 404 }
      );
    }

    // 벤더 태그 상세 정보
    if (user && post.author_id !== user.id) {
      const { data: viewerCanSee, error: viewerControlError } = await getServiceClient().rpc(
        "community_viewer_can_see" as never,
        {
          p_viewer_user_id: user.id,
          p_other_user_id: post.author_id,
        } as never,
      ) as { data: unknown; error: unknown };
      if (viewerControlError || typeof viewerCanSee !== "boolean") {
        return NextResponse.json(
          { error: "게시글 접근 권한을 확인하지 못했습니다." },
          { status: 503 },
        );
      }
      if (!viewerCanSee) {
        return NextResponse.json(
          { error: "게시글을 찾을 수 없습니다." },
          { status: 404 },
        );
      }
    }

    let vendorDetails: Array<{
      id: string;
      business_name: string;
      category: string;
      thumbnail_url: string | null;
      rating: number | null;
    }> = [];
    if (post.vendor_tags && post.vendor_tags.length > 0) {
      const { data: vendors } = await getServiceClient()
        .from("vendors")
        .select("id, name, category, thumbnail_url, rating")
        .in("id", post.vendor_tags)
        .eq("status", "approved");

      vendorDetails = (vendors ?? []).map((v) => ({
        id: v.id,
        business_name: v.name,
        category: v.category,
        thumbnail_url: v.thumbnail_url ?? null,
        rating: v.rating ?? null,
      }));
    }

    // 인증 사용자: 투표 + 북마크 상태
    let userVote: number | null = null;
    let userBookmarked = false;

    if (user) {
      const [voteResult, bookmarkResult] = await Promise.all([
        supabase
          .from("community_votes")
          .select("vote_type")
          .eq("user_id", user.id)
          .eq("post_id", id)
          .maybeSingle(),
        supabase
          .from("community_bookmarks")
          .select("id")
          .eq("user_id", user.id)
          .eq("post_id", id)
          .maybeSingle(),
      ]);

      userVote = voteResult.data?.vote_type ?? null;
      userBookmarked = !!bookmarkResult.data;
    }

    // author 프로필 조회
    const authorMap = await getCommunityAuthorMap(supabase, [post.author_id]);

    // 폴 + 옵션 + 사용자 투표 상태
    let pollData: PollWithOptions | null = null;
    const { data: pollRow, error: pollError } = await supabase
      .from("community_polls")
      .select("id, post_id")
      .eq("post_id", id)
      .maybeSingle();

    if (pollError) throw pollError;
    if (pollRow) {
      pollData = await getCommunityPollActorProjection(
        getServiceClient(),
        user?.id ?? null,
        pollRow.id,
      );
    }

    return NextResponse.json({
      ...post,
      author: authorMap[post.author_id] ?? fallbackCommunityAuthor(post.author_id),
      vendor_details: vendorDetails,
      user_vote: userVote,
      user_bookmarked: userBookmarked,
      poll: pollData,
    });
  } catch {
    logContentFreeFailure(
      "[community.posts.get]",
      "unexpected",
      "UNHANDLED_EXCEPTION",
    );
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const response = await getPostResponse(req, context);
  response.headers.set("Cache-Control", PRIVATE_DETAIL_NO_STORE);
  response.headers.set("Vary", VIEWER_VARY);
  return response;
}

// 게시글 수정 (작성자만)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const { id } = await params;
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

    const writeAccess = await checkCommunityWriteAccess(supabase, user.id);
    if (!writeAccess.allowed) {
      return NextResponse.json(
        { error: writeAccess.message, code: writeAccess.code },
        { status: writeAccess.status },
      );
    }

    const userIsAdmin = await isAdmin(user.id);
    const readClient = userIsAdmin ? getServiceClient() : supabase;

    // 작성자 확인. 관리자는 전체 커뮤니티 관리 권한으로 service role 조회를 사용한다.
    const { data: existingPost } = await readClient
      .from("community_posts")
      .select(
        "author_id, slides, images, visibility, title, content, tags, cost_data, price_data, ad_disclosure, sponsorship_detail"
      )
      .eq("id", id)
      .maybeSingle();

    if (!existingPost) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (existingPost.author_id !== user.id && userIsAdmin) {
      return NextResponse.json(
        {
          error: "관리자 운영 조치는 감사 기록이 남는 moderation 경로를 사용해 주세요.",
          code: "COMMUNITY_ADMIN_EDIT_REQUIRES_AUDITED_ACTION",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (existingPost.author_id !== user.id) {
      return NextResponse.json(
        { error: "수정 권한이 없습니다." },
        { status: 403 }
      );
    }

    const mediaOwnerIds = existingPost.author_id;
    const bodyResult = await readBoundedUtf8Text(req, MAX_POST_PATCH_BODY_BYTES);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: "게시글 수정 요청을 읽을 수 없습니다." },
        {
          status: bodyResult.reason === "too_large" ? 413 : 400,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(bodyResult.text) as unknown;
    } catch {
      return NextResponse.json(
        { error: "게시글 수정 요청 형식을 확인해 주세요." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (
      !isRecord(parsedBody)
      || !isValidPostPatchBody(parsedBody)
    ) {
      return NextResponse.json(
        { error: "게시글 수정 요청 필드를 확인해 주세요." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const body = parsedBody as UpdatePostInput;
    const updateData: Record<string, unknown> = {};
    const requestedContent = body.content === undefined
      ? undefined
      : sanitizeHtml(typeof body.content === "string" ? body.content : "").slice(0, 50000);

    if (
      !isCommunityMediaPublishingEnabled()
      && !isCommunityMediaPatchAllowedWhileDisabled(
        {
          content: requestedContent,
          images: body.images,
          slides: body.slides,
          visibility: body.visibility,
        },
        existingPost,
      )
    ) {
      return communityMediaPublishingDisabledResponse();
    }

    if (body.title !== undefined) {
      const title = sanitizeText(typeof body.title === "string" ? body.title : "").trim().slice(0, 200);
      if (title.length === 0) {
        return NextResponse.json(
          { error: "제목을 입력해주세요." },
          { status: 400 }
        );
      }
      updateData.title = title;
    }
    if (body.content !== undefined) {
      const content = requestedContent ?? "";
      const contentImagesResult = validateCommunityHtmlImageSources(content, {
        ownerIds: mediaOwnerIds,
      });
      if (!contentImagesResult.ok) return invalidCommunityMediaResponse();

      // 카드 게시물(슬라이드)이면 캡션 비어도 허용. 그 외엔 본문 필수.
      const willHaveSlides =
        body.slides === undefined
          ? Array.isArray(existingPost.slides) && existingPost.slides.length > 0
          : Array.isArray(body.slides) && body.slides.length > 0;
      if (!willHaveSlides && content.trim().length === 0) {
        return NextResponse.json(
          { error: "내용을 입력해주세요." },
          { status: 400 }
        );
      }
      updateData.content = content;
    }
    if (body.images !== undefined) {
      const images: string[] = [];
      for (const rawImageUrl of (Array.isArray(body.images) ? body.images : []).slice(0, 10)) {
        const imageResult = validateCommunityAttachmentUrl(rawImageUrl, {
          ownerIds: mediaOwnerIds,
        });
        if (imageResult.ok) {
          images.push(imageResult.url);
          continue;
        }
        const retainedImageResult = validateRetainedCommunityImageUrl(
          rawImageUrl,
          existingPost.images,
          { ownerIds: mediaOwnerIds },
        );
        if (retainedImageResult.ok) {
          images.push(retainedImageResult.url);
          continue;
        }
        const retainedVideoResult = validateRetainedCommunityVideoUrl(
          rawImageUrl,
          (Array.isArray(existingPost.images) ? existingPost.images : [])
            .map((url) => ({ type: "video", url })),
          { ownerIds: mediaOwnerIds },
        );
        if (!retainedVideoResult.ok) return invalidCommunityMediaResponse();
        images.push(retainedVideoResult.url);
      }
      updateData.images = images;
    }
    // 카드 게시물 슬라이드 — null 명시 시 일반 글로 되돌림, 배열이면 카드 게시물로 갱신.
    if (body.slides !== undefined) {
      if (body.slides === null || (Array.isArray(body.slides) && body.slides.length === 0)) {
        updateData.slides = null;
      } else if (Array.isArray(body.slides)) {
        const slides: Array<{ type: "image" | "video"; url: string; width?: number; height?: number; thumbnail_url?: string }> = [];
        for (const s of body.slides.slice(0, 10)) {
          const type = s?.type === "video" ? "video" as const : "image" as const;
          const strictImageResult = type === "image"
            ? validateCommunityMediaUrl(s?.url, {
                kind: "image",
                ownerIds: mediaOwnerIds,
                requireUploadSessionPath: true,
              })
            : null;
          const mediaResult = type === "video"
            ? validateRetainedCommunityVideoUrl(s?.url, existingPost.slides, {
                ownerIds: mediaOwnerIds,
              })
            : strictImageResult?.ok
              ? strictImageResult
              : validateRetainedCommunityImageUrl(s?.url, existingPost.slides, {
                  ownerIds: mediaOwnerIds,
                });
          if (!mediaResult.ok) return invalidCommunityMediaResponse();

          const slide: { type: "image" | "video"; url: string; width?: number; height?: number; thumbnail_url?: string } = {
            type,
            url: mediaResult.url,
          };
          if (typeof s.width === "number" && s.width > 0) slide.width = Math.min(8192, Math.round(s.width));
          if (typeof s.height === "number" && s.height > 0) slide.height = Math.min(8192, Math.round(s.height));
          if (typeof s.thumbnail_url === "string" && s.thumbnail_url.trim().length > 0) {
            const strictThumbnailResult = validateCommunityMediaUrl(s.thumbnail_url, {
              kind: "image",
              ownerIds: mediaOwnerIds,
              requireUploadSessionPath: true,
            });
            const thumbnailResult = strictThumbnailResult.ok
              ? strictThumbnailResult
              : validateRetainedCommunityImageUrl(s.thumbnail_url, existingPost.slides, {
                  ownerIds: mediaOwnerIds,
                });
            if (!thumbnailResult.ok) return invalidCommunityMediaResponse();
            slide.thumbnail_url = thumbnailResult.url;
          }
          slides.push(slide);
        }
        updateData.slides = slides;
      } else {
        return invalidCommunityMediaResponse();
      }
    }
    if (body.visibility !== undefined) {
      if (existingPost.author_id !== user.id) {
        return NextResponse.json(
          {
            error: "운영 조치는 작성자의 공개 의사와 분리된 감사 경로를 사용해야 합니다.",
            code: "COMMUNITY_AUTHOR_VISIBILITY_INTENT_CONFLICT",
          },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }
      if (!VALID_POST_VISIBILITIES.includes(body.visibility)) {
        return NextResponse.json(
          { error: "잘못된 공개 범위입니다." },
          { status: 400 }
        );
      }
      updateData.visibility = body.visibility;
    }
    if (body.vendor_tags !== undefined) {
      updateData.vendor_tags = (Array.isArray(body.vendor_tags) ? body.vendor_tags : [])
        .filter((tag): tag is string => typeof tag === "string")
        .slice(0, 5);
    }
    if (body.tags !== undefined) {
      updateData.tags = (Array.isArray(body.tags) ? body.tags : [])
        .slice(0, 10)
        .map((t: string) => sanitizeText(typeof t === "string" ? t : "").slice(0, 30))
        .filter((t: string) => t.length > 0);
    }
    if (
      body.ad_disclosure !== undefined ||
      body.sponsorship_detail !== undefined
    ) {
      const allowedDisclosures: AdDisclosure[] = [
        "general",
        "sponsored",
        "ad",
      ];
      const nextDisclosure =
        body.ad_disclosure ?? existingPost.ad_disclosure;
      if (!allowedDisclosures.includes(nextDisclosure as AdDisclosure)) {
        return NextResponse.json(
          { error: "광고 표시 유형을 확인해 주세요." },
          { status: 400 }
        );
      }

      updateData.ad_disclosure = nextDisclosure;
      if (nextDisclosure === "sponsored") {
        const detail = sanitizeText(
          typeof body.sponsorship_detail === "string"
            ? body.sponsorship_detail
            : existingPost.sponsorship_detail ?? ""
        )
          .trim()
          .slice(0, 500);
        if (detail.length < 5) {
          return NextResponse.json(
            { error: "협찬으로 받은 혜택을 5자 이상 적어 주세요." },
            { status: 400 }
          );
        }
        updateData.sponsorship_detail = detail;
      } else {
        updateData.sponsorship_detail = null;
      }
    }
    if (body.price_data !== undefined) {
      if (body.price_data === null) {
        updateData.price_data = null;
      } else if (
        typeof body.price_data.base_price === "number" &&
        Number.isFinite(body.price_data.base_price) &&
        body.price_data.base_price > 0
      ) {
        const priceData: PriceData = {
          vendor_category: body.price_data.vendor_category,
          base_price: body.price_data.base_price,
          extra_price:
            typeof body.price_data.extra_price === "number" &&
            Number.isFinite(body.price_data.extra_price)
              ? body.price_data.extra_price
              : undefined,
          vendor_name:
            typeof body.price_data.vendor_name === "string"
              ? sanitizeText(body.price_data.vendor_name).trim().slice(0, 100)
              : undefined,
          region:
            typeof body.price_data.region === "string"
              ? sanitizeText(body.price_data.region).trim().slice(0, 100)
              : undefined,
          details:
            typeof body.price_data.details === "string"
              ? sanitizeText(body.price_data.details).trim().slice(0, 1_000)
              : undefined,
        };
        updateData.price_data = priceData;
      } else {
        return NextResponse.json(
          { error: "가격 정보의 기본 금액을 확인해 주세요." },
          { status: 400 }
        );
      }
    }
    if (body.is_resolved !== undefined) {
      if (typeof body.is_resolved !== "boolean") {
        return NextResponse.json(
          { error: "해결 상태는 참 또는 거짓으로 보내주세요." },
          { status: 400 }
        );
      }
      updateData.is_resolved = body.is_resolved;
    }
    if (body.cost_data !== undefined) updateData.cost_data = body.cost_data;

    const nextPublicValue = (field: string, currentValue: unknown) =>
      Object.prototype.hasOwnProperty.call(updateData, field)
        ? updateData[field]
        : currentValue;
    const publicText = (value: unknown): string | null => {
      if (typeof value === "string") return value;
      if (value === null || value === undefined) return null;
      return JSON.stringify(value);
    };
    const personalInfoKinds = findObviousPublicPersonalInfo(
      publicText(nextPublicValue("title", existingPost.title)),
      publicText(nextPublicValue("content", existingPost.content)),
      publicText(
        nextPublicValue(
          "sponsorship_detail",
          existingPost.sponsorship_detail
        )
      ),
      publicText(nextPublicValue("tags", existingPost.tags)),
      publicText(nextPublicValue("cost_data", existingPost.cost_data)),
      publicText(nextPublicValue("price_data", existingPost.price_data))
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

    updateData.updated_at = new Date().toISOString();

    // Authenticated table writes are intentionally revoked. Ownership and
    // moderation access were checked above; the validated mutation now uses
    // only the server-held service role.
    const writeClient = getServiceClient();
    const postUpdate = writeClient
      .from("community_posts")
      .update(updateData)
      .eq("id", id)
      .eq("author_id", user.id);
    const { data: updatedPost, error } = await postUpdate
      .select("*")
      .single();

    if (!updatedPost && (!error || error.code === "PGRST116")) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없습니다." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (error) {
      logContentFreeFailure("[community.posts.patch]", "database", error.code);
      return NextResponse.json(
        { error: "게시글 수정에 실패했습니다." },
        { status: 500 }
      );
    }

    // 제목/본문/카테고리 변경 시 랜딩에서도 즉시 반영 — 실패해도 응답은 성공
    try {
      revalidatePath("/");
      revalidatePath("/wedding");
      revalidatePath("/community");
    } catch {
      logContentFreeFailure(
        "[community.posts.patch]",
        "cache",
        "REVALIDATE_FAILED",
      );
    }

    return NextResponse.json({ post: updatedPost });
  } catch {
    logContentFreeFailure(
      "[community.posts.patch]",
      "unexpected",
      "UNHANDLED_EXCEPTION",
    );
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// 게시글 삭제 (작성자만)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(req);
    const serviceClient = getServiceClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const userIsAdmin = await isAdmin(user.id);
    if (userIsAdmin) {
      // Foreign administrator deletion must remain on the recoverable audited
      // moderation path. A missing row may still be this admin's exact retry,
      // so only a present foreign row is rejected before the receipt RPC.
      const { data: existingPost, error: existingPostError } = await serviceClient
        .from("community_posts")
        .select("author_id")
        .eq("id", id)
        .maybeSingle();
      if (existingPostError) {
        return NextResponse.json(
          { error: "게시글 소유자를 안전하게 확인하지 못했습니다." },
          { status: 503, headers: { "Cache-Control": "private, no-store" } },
        );
      }
      if (existingPost && existingPost.author_id !== user.id) {
        return NextResponse.json(
          {
            error: "관리자 삭제는 복구 가능한 감사 조치 경로를 사용해야 합니다.",
            code: "COMMUNITY_ADMIN_DELETE_REQUIRES_AUDITED_ACTION",
          },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }
    }

    const { data: atomicData, error: atomicError } = await serviceClient.rpc(
      "community_delete_post_service",
      { p_actor_id: user.id, p_post_id: id },
    );
    if (atomicError) {
      const message = atomicError.message ?? "";
      if (
        message.includes("COMMUNITY_POST_NOT_FOUND")
        || message.includes("COMMUNITY_POST_DELETE_FORBIDDEN")
      ) {
        return NextResponse.json(
          { error: "게시글을 찾을 수 없습니다." },
          { status: 404, headers: { "Cache-Control": "private, no-store" } },
        );
      }
      logContentFreeFailure(
        "[community.posts.delete]",
        "database",
        atomicError.code,
      );
      return NextResponse.json(
        {
          code: "COMMUNITY_POST_DELETE_FAILED",
          error: "게시글을 안전하게 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (!isAtomicPostDeleteResult(atomicData, user.id, id)) {
      return NextResponse.json(
        {
          code: "COMMUNITY_POST_DELETE_UNCONFIRMED",
          error: "게시글 삭제 결과를 안전하게 확인하지 못했습니다.",
        },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    // 랜딩 / 커뮤니티 ISR 캐시 무효화 — 실패해도 응답은 성공
    try {
      revalidatePath("/");
      revalidatePath("/wedding");
      revalidatePath("/community");
    } catch {
      logContentFreeFailure(
        "[community.posts.delete]",
        "cache",
        "REVALIDATE_FAILED",
      );
    }

    return NextResponse.json(atomicData, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    logContentFreeFailure(
      "[community.posts.delete]",
      "unexpected",
      "UNHANDLED_EXCEPTION",
    );
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
