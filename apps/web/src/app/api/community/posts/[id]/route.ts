import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import { fallbackCommunityAuthor, getCommunityAuthorMap } from "@/lib/community/authorProfiles";
import { canReadCommunityPost } from "@/lib/community/publicPostRules";
import {
  COMMUNITY_POLL_OPTION_SERVER_SELECT,
  COMMUNITY_POLL_SERVER_SELECT,
  protectCommunityPollResults,
} from "@/lib/community/pollVisibility";
import { requestMatchesExpectedCommunityActor } from "@/lib/community/actorFence";
import {
  validateCommunityAttachmentUrl,
  validateCommunityHtmlImageSources,
  validateCommunityMediaUrl,
  validateRetainedCommunityImageUrl,
  validateRetainedCommunityVideoUrl,
} from "@/lib/community/mediaUrls";
import { sanitizeHtmlWithInputLimit, sanitizeText } from "@/utils/sanitize";
import { isRecord, isUuid, readBoundedJsonValue } from "@/utils/requestValidation";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { getCommunityPublicIdForUser } from "@/lib/community/publicIdentity";
import { verifyAdmin } from "@/lib/utils/adminAuth";
import {
  COMMUNITY_WRITE_DENIED_MESSAGE,
  isCommunityActorWriteDenied,
} from "@/lib/community/actorWriteGate";
import type { PostVisibility, UpdatePostInput, PollWithOptions } from "@/types/community.types";

const VALID_POST_VISIBILITIES: PostVisibility[] = ["public", "members", "draft"];
const MAX_BODY_BYTES = 512 * 1024;
const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Authorization",
};

function getServiceClient() {
  return createAdminClient();
}

function invalidCommunityMediaResponse() {
  return NextResponse.json(
    { error: "커뮤니티 업로드로 등록된 이미지만 첨부할 수 있습니다." },
    { status: 400 }
  );
}

// 게시글 상세 조회
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json(
        { error: "올바른 게시글 ID가 아닙니다." },
        { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
    const ingressLimited = await checkRateLimitPersistent(
      rateLimitKey("community:post:detail", req),
      { maxRequests: 180, windowMs: 60 * 1000 },
    );
    if (ingressLimited) return ingressLimited;

    const supabase = await createClientFromRequest(req);

    const {
      data: { user },
    } = await supabase.auth.getUser();

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

    const adminVerification = user
      ? await verifyAdmin(req)
      : { authorized: false as const, userId: undefined };
    const userIsAdmin = Boolean(
      user
      && adminVerification.authorized
      && adminVerification.userId === user.id,
    );
    const viewerPublicId = await getCommunityPublicIdForUser(
      getServiceClient(),
      user?.id,
    );
    const canReadPost = canReadCommunityPost(post, {
      userId: viewerPublicId,
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
    const serviceClient = getServiceClient();
    const { data: pollRow } = await serviceClient
      .from("community_polls")
      .select(COMMUNITY_POLL_SERVER_SELECT)
      .eq("post_id", id)
      .maybeSingle();

    if (pollRow) {
      const { data: optionRows } = await serviceClient
        .from("community_poll_options")
        .select(COMMUNITY_POLL_OPTION_SERVER_SELECT)
        .eq("poll_id", pollRow.id)
        .order("position", { ascending: true });

      let votedOptionIds: string[] = [];
      if (user) {
        const { data: voteRows } = await supabase
          .from("community_poll_votes")
          .select("option_id")
          .eq("poll_id", pollRow.id)
          .eq("user_id", user.id);
        votedOptionIds = (voteRows ?? []).map((v: { option_id: string }) => v.option_id);
      }

      pollData = protectCommunityPollResults({
        id: pollRow.id,
        post_id: pollRow.post_id,
        question: pollRow.question,
        allow_multiple: pollRow.allow_multiple,
        is_anonymous: pollRow.is_anonymous,
        hide_results_until_voted: pollRow.hide_results_until_voted,
        closes_at: pollRow.closes_at,
        total_voters: pollRow.total_voters,
        total_votes: pollRow.total_votes,
        created_at: pollRow.created_at,
        options: optionRows ?? [],
        user_voted_option_ids: votedOptionIds,
      });
    }

    return NextResponse.json(
      {
        ...post,
        author: authorMap[post.author_id] ?? fallbackCommunityAuthor(post.author_id),
        is_author: Boolean(viewerPublicId && post.author_id === viewerPublicId),
        vendor_details: vendorDetails,
        user_vote: userVote,
        user_bookmarked: userBookmarked,
        poll: pollData,
      },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error("Get post detail error", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// 게시글 수정 (작성자만)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json(
        { error: "올바른 게시글 ID가 아닙니다." },
        { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
      );
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

    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:post:update", req, user.id),
      { maxRequests: 30, windowMs: 60 * 1000 },
    );
    if (limited) return limited;


    if (!requestMatchesExpectedCommunityActor(req, user.id)) {
      return NextResponse.json(
        { error: "계정이 변경되어 글 수정을 중단했습니다. 다시 확인해 주세요." },
        { status: 409 },
      );
    }

    const readClient = getServiceClient();

    // 작성자 확인. 관리자는 전체 커뮤니티 관리 권한으로 service role 조회를 사용한다.
    const { data: existingPost } = await readClient
      .from("community_posts")
      .select("author_id, slides, images")
      .eq("id", id)
      .maybeSingle();

    if (!existingPost) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    let allowAdminOverride = false;
    if (existingPost.author_id !== user.id) {
      const adminVerification = await verifyAdmin(req);
      if (!adminVerification.authorized || adminVerification.userId !== user.id) {
        return NextResponse.json(
          { error: "수정 권한이 없습니다." },
          { status: 403 }
        );
      }
      allowAdminOverride = true;
    }

    const mediaOwnerIds = allowAdminOverride
      ? [existingPost.author_id, user.id]
      : existingPost.author_id;
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
    const body = bodyResult.value as unknown as UpdatePostInput;
    const updateData: Record<string, unknown> = {};

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
      const content = sanitizeHtmlWithInputLimit(
        typeof body.content === "string" ? body.content : "",
        50000
      );
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
    if (body.cost_data !== undefined) updateData.cost_data = body.cost_data;
    // Authorization, suspension state, and the row update are revalidated under
    // one database transaction. This also closes a suspension/update race.
    const writeClient = getServiceClient();
    const { data: updatedPost, error } = await writeClient
      .rpc("community_update_post_for_actor", {
        p_actor_id: user.id,
        p_post_id: id,
        p_patch: updateData,
        p_allow_admin_override: allowAdminOverride,
      })
      .select(COMMUNITY_POST_PUBLIC_SELECT)
      .single();

    if (error) {
      if (isCommunityActorWriteDenied(error)) {
        return NextResponse.json(
          { error: COMMUNITY_WRITE_DENIED_MESSAGE },
          { status: 403 },
        );
      }
      console.error("Update post error", safeErrorDiagnostic(error));
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
    } catch (e) {
      console.error(
        "[posts.PATCH] revalidatePath failed (non-fatal)",
        safeErrorDiagnostic(e),
      );
    }

    return NextResponse.json({ post: updatedPost });
  } catch (err) {
    console.error("Update post error", safeErrorDiagnostic(err));
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
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json(
        { error: "올바른 게시글 ID가 아닙니다." },
        { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
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

    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:post:delete", req, user.id),
      { maxRequests: 20, windowMs: 10 * 60 * 1000 },
    );
    if (limited) return limited;

    const readClient = serviceClient;

    // 작성자 확인. 관리자는 숨김/신고 글까지 처리할 수 있어야 한다.
    const { data: existingPost, error: postLookupError } = await readClient
      .from("community_posts")
      .select("author_id")
      .eq("id", id)
      .maybeSingle();

    if (postLookupError) {
      console.error(
        "Delete post lookup error",
        safeErrorDiagnostic(postLookupError),
      );
      return NextResponse.json(
        { error: "게시글을 확인하지 못했습니다." },
        { status: 500 },
      );
    }

    if (!existingPost) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    let allowAdminOverride = false;
    if (existingPost.author_id !== user.id) {
      const adminVerification = await verifyAdmin(req);
      if (!adminVerification.authorized || adminVerification.userId !== user.id) {
        return NextResponse.json(
          { error: "삭제 권한이 없습니다." },
          { status: 403 }
        );
      }
      allowAdminOverride = true;
    }

    const { data: deleted, error } = await serviceClient.rpc(
      "community_delete_post_for_actor",
      {
        p_actor_id: user.id,
        p_post_id: id,
        p_allow_admin_override: allowAdminOverride,
      },
    );

    if (error) {
      if (isCommunityActorWriteDenied(error)) {
        return NextResponse.json(
          { error: COMMUNITY_WRITE_DENIED_MESSAGE },
          { status: 403 },
        );
      }
      console.error("Delete post error", safeErrorDiagnostic(error));
      return NextResponse.json(
        { error: "게시글 삭제에 실패했습니다." },
        { status: 500 }
      );
    }

    if (deleted !== true) {
      console.error("Delete post RPC returned an invalid result");
      return NextResponse.json(
        { error: "게시글 삭제 결과를 확인하지 못했습니다." },
        { status: 500 },
      );
    }

    // 랜딩 / 커뮤니티 ISR 캐시 무효화 — 실패해도 응답은 성공
    try {
      revalidatePath("/");
      revalidatePath("/wedding");
      revalidatePath("/community");
    } catch (e) {
      console.error(
        "[posts.DELETE] revalidatePath failed (non-fatal)",
        safeErrorDiagnostic(e),
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete post error", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
