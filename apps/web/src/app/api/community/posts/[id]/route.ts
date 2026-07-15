import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import { getCommunityActorIdForUser } from "@/lib/community/actorIdentity";
import { getMutedActorIds } from "@/lib/community/mutes";
import {
  CommunityAuthorProfileUnavailableError,
  getCommunityAuthorMap,
  requireCommunityAuthor,
} from "@/lib/community/authorProfiles";
import { canReadCommunityPost } from "@/lib/community/publicPostRules";
import { isCommunityCategory } from "@/lib/community/routes";
import { sanitizeHtml, sanitizeText } from "@/utils/sanitize";
import { isBodyTooLarge, isRecord, isUuid } from "@/utils/requestValidation";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import type { AdDisclosure, PostVisibility, UpdatePostInput, PollWithOptions } from "@/types/community.types";

const VALID_POST_VISIBILITIES: PostVisibility[] = ["public", "members", "draft"];
const MAX_POST_BODY_BYTES = 256 * 1024;
const ALLOWED_UPDATE_POST_FIELDS = new Set([
  "title",
  "content",
  "category",
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

async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await getServiceClient()
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .single();
  return data?.is_admin === true;
}

// 게시글 상세 조회
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "게시글을 확인할 수 없습니다." }, { status: 400 });
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

    // 게시글 + 작성자 정보 조회
    const { data: post, error } = await supabase
      .from("community_posts")
      .select(
        COMMUNITY_POST_PUBLIC_SELECT
      )
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[community post detail] query failed", error.code);
      return NextResponse.json(
        { error: "게시글 조회가 일시적으로 불가능합니다. 잠시 후 다시 시도해주세요." },
        { status: 503 }
      );
    }

    if (!post) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const viewerActorId = await getCommunityActorIdForUser(user?.id);
    const userIsAdmin = user ? await isAdmin(user.id) : false;
    const canReadPost = canReadCommunityPost(post, {
      actorId: viewerActorId,
      isAuthenticated: Boolean(user),
      isAdmin: userIsAdmin,
    });

    if (!canReadPost) {
      const requiresLogin = post.visibility === "members" && !user && post.under_review !== true;
      return NextResponse.json(
        { error: requiresLogin ? "로그인이 필요합니다." : "게시글을 찾을 수 없습니다." },
        { status: requiresLogin ? 401 : 404 }
      );
    }

    const mutedActorIds = await getMutedActorIds(user?.id);
    if (mutedActorIds.includes(post.author_id)) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없습니다." },
        { status: 404, headers: { "Cache-Control": "private, no-store, max-age=0" } },
      );
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

      if (voteResult.error || bookmarkResult.error) {
        return NextResponse.json(
          { error: "좋아요와 북마크 상태를 불러오지 못했습니다." },
          { status: 503 },
        );
      }

      userVote = voteResult.data?.vote_type ?? null;
      userBookmarked = !!bookmarkResult.data;
    }

    // author 프로필 조회
    const authorMap = await getCommunityAuthorMap(supabase, [post.author_id]);

    // 폴 + 옵션 + 사용자 투표 상태
    let pollData: PollWithOptions | null = null;
    const { data: pollRow, error: pollError } = await supabase
      .from("community_polls")
      .select("*")
      .eq("post_id", id)
      .maybeSingle();
    if (pollError) {
      return NextResponse.json(
        { error: "투표 정보를 불러오지 못했습니다." },
        { status: 503 },
      );
    }

    if (pollRow) {
      const { data: optionRows, error: optionError } = await supabase
        .from("community_poll_options")
        .select("id, poll_id, position, label, vote_count")
        .eq("poll_id", pollRow.id)
        .order("position", { ascending: true });
      if (optionError) {
        return NextResponse.json(
          { error: "투표 선택지를 불러오지 못했습니다." },
          { status: 503 },
        );
      }

      let votedOptionIds: string[] = [];
      if (user) {
        const { data: voteRows, error: pollVoteError } = await supabase
          .from("community_poll_votes")
          .select("option_id")
          .eq("poll_id", pollRow.id)
          .eq("user_id", user.id);
        if (pollVoteError) {
          return NextResponse.json(
            { error: "내 투표 상태를 불러오지 못했습니다." },
            { status: 503 },
          );
        }
        votedOptionIds = (voteRows ?? []).map((v: { option_id: string }) => v.option_id);
      }

      pollData = {
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
        options: (optionRows ?? []).map((option) => ({
          ...option,
          image_url: null,
        })),
        user_voted_option_ids: votedOptionIds,
      };
    }

    return NextResponse.json({
      ...post,
      author: requireCommunityAuthor(authorMap, post.author_id),
      viewer_is_author: Boolean(viewerActorId && post.author_id === viewerActorId),
      user_vote: userVote,
      user_bookmarked: userBookmarked,
      poll: pollData,
    });
  } catch (err) {
    console.error("Get post detail error:", err);
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

// 게시글 수정 (작성자만)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "게시글을 확인할 수 없습니다." }, { status: 400 });
    }
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

    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:post:update", req, user.id),
      { maxRequests: 30, windowMs: 60 * 60 * 1_000 },
      user.id,
    );
    if (limited) return limited;

    const rawRequestBody = await req.text().catch(() => null);
    if (rawRequestBody === null) {
      return NextResponse.json(
        { error: "게시글 수정 요청을 읽지 못했습니다." },
        { status: 400 },
      );
    }
    if (new TextEncoder().encode(rawRequestBody).byteLength > MAX_POST_BODY_BYTES) {
      return NextResponse.json(
        { error: "요청 데이터가 너무 큽니다." },
        { status: 413 },
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawRequestBody);
    } catch {
      parsedBody = null;
    }
    if (!isRecord(parsedBody)) {
      return NextResponse.json(
        { error: "잘못된 게시글 요청입니다." },
        { status: 400 },
      );
    }
    const body = parsedBody as UpdatePostInput;

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
      "poll",
      "images",
      "slides",
      "cost_data",
      "ai_comment",
      "cohort_room_id",
      "vendor_tags",
      "rating",
      "is_quick_review",
      "is_verified_review",
      "verification_doc_url",
    ] as const;
    const retiredField = retiredFields.find((field) =>
      Object.prototype.hasOwnProperty.call(body, field),
    );
    if (retiredField) {
      return NextResponse.json(
        {
          error: "종료된 게시글 입력 기능입니다.",
          code: "community_structured_fields_retired",
          field: retiredField,
        },
        { status: 410 },
      );
    }
    const unknownField = Object.keys(body).find(
      (field) => !ALLOWED_UPDATE_POST_FIELDS.has(field),
    );
    if (unknownField) {
      return NextResponse.json(
        { error: "지원하지 않는 게시글 수정 항목입니다.", field: unknownField },
        { status: 400 },
      );
    }
    if (Object.keys(body).length === 0) {
      return NextResponse.json({ error: "수정할 항목이 없습니다." }, { status: 400 });
    }
    if (
      (body.title !== undefined &&
        (typeof body.title !== "string" ||
          body.title.length > 200 ||
          sanitizeText(body.title).length === 0)) ||
      (body.content !== undefined &&
        (typeof body.content !== "string" ||
          body.content.length > 50_000 ||
          sanitizeHtml(body.content).trim().length === 0)) ||
      (body.category !== undefined && !isCommunityCategory(body.category)) ||
      (body.visibility !== undefined &&
        !VALID_POST_VISIBILITIES.includes(body.visibility)) ||
      (body.ad_disclosure !== undefined &&
        !(["general", "sponsored", "ad"] as unknown[]).includes(body.ad_disclosure)) ||
      (body.sponsorship_detail !== undefined &&
        (typeof body.sponsorship_detail !== "string" ||
          body.sponsorship_detail.length > 500)) ||
      (body.tags !== undefined &&
        (!Array.isArray(body.tags) ||
          body.tags.length > 10 ||
          body.tags.some(
            (tag) =>
              typeof tag !== "string" ||
              tag.length > 30 ||
              sanitizeText(tag).length === 0,
          )))
    ) {
      return NextResponse.json(
        { error: "게시글 수정 입력 형식이나 길이를 확인해주세요." },
        { status: 400 },
      );
    }
    if (body.content !== undefined && /<\s*img\b/i.test(body.content)) {
      return NextResponse.json(
        {
          error: "커뮤니티 미디어는 안전한 보관·삭제 수명주기가 검증될 때까지 제공하지 않습니다.",
          code: "community_media_retired",
        },
        { status: 410 },
      );
    }

    const updateData: Record<string, unknown> = {};

    if (body.title !== undefined) {
      if (typeof body.title !== "string" || body.title.length > 200) {
        return NextResponse.json(
          { error: "제목 형식이나 길이를 확인해주세요." },
          { status: 400 },
        );
      }
      const title = sanitizeText(body.title);
      if (title.length === 0) {
        return NextResponse.json(
          { error: "제목을 입력해주세요." },
          { status: 400 }
        );
      }
      updateData.title = title;
    }
    if (body.content !== undefined) {
      if (typeof body.content !== "string" || body.content.length > 50_000) {
        return NextResponse.json(
          { error: "본문 형식이나 길이를 확인해주세요." },
          { status: 400 },
        );
      }
      if (/<\s*img\b/i.test(body.content)) {
        return NextResponse.json(
          {
            error: "커뮤니티 미디어는 안전한 보관·삭제 수명주기가 검증될 때까지 제공하지 않습니다.",
            code: "community_media_retired",
          },
          { status: 410 },
        );
      }
      const content = sanitizeHtml(body.content);
      if (content.trim().length === 0) {
        return NextResponse.json(
          { error: "내용을 입력해주세요." },
          { status: 400 }
        );
      }
      updateData.content = content;
    }
    if (body.category !== undefined) {
      if (!isCommunityCategory(body.category)) {
        return NextResponse.json({ error: "잘못된 카테고리입니다." }, { status: 400 });
      }
      updateData.category = body.category;
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
    if (body.ad_disclosure !== undefined || body.sponsorship_detail !== undefined) {
      const validAdDisclosures: AdDisclosure[] = ["general", "sponsored", "ad"];
      if (
        body.ad_disclosure !== undefined &&
        !validAdDisclosures.includes(body.ad_disclosure)
      ) {
        return NextResponse.json({ error: "광고 표시 유형을 확인해주세요." }, { status: 400 });
      }
      if (
        body.ad_disclosure !== undefined &&
        body.ad_disclosure !== "sponsored" &&
        body.sponsorship_detail !== undefined
      ) {
        return NextResponse.json(
          { error: "협찬 내용은 협찬 포함 글에만 입력할 수 있습니다." },
          { status: 400 },
        );
      }
      if (body.ad_disclosure !== undefined) {
        updateData.ad_disclosure = body.ad_disclosure;
      }
      if (body.sponsorship_detail !== undefined) {
        const detail = sanitizeText(body.sponsorship_detail);
        if (detail.length < 5) {
          return NextResponse.json(
            { error: "협찬이 포함된 글은 받은 혜택을 5자 이상 적어주세요." },
            { status: 400 },
          );
        }
        updateData.sponsorship_detail = detail;
      }
    }
    if (body.tags !== undefined) {
      if (
        !Array.isArray(body.tags) ||
        body.tags.length > 10 ||
        body.tags.some((tag) => typeof tag !== "string" || tag.length > 30)
      ) {
        return NextResponse.json({ error: "태그 형식을 확인해주세요." }, { status: 400 });
      }
      const tags = body.tags.map((tag) => sanitizeText(tag));
      if (tags.some((tag) => tag.length === 0)) {
        return NextResponse.json({ error: "빈 태그는 저장할 수 없습니다." }, { status: 400 });
      }
      updateData.tags = tags;
    }
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "수정할 항목이 없습니다." }, { status: 400 });
    }

    // The RPC locks the row and verifies current author/admin permission in
    // the same transaction as the exact-schema patch.
    const serviceClient = getServiceClient();
    const { data, error } = await serviceClient.rpc("community_update_post", {
      p_actor_id: user.id,
      p_post_id: id,
      p_patch: updateData,
    });

    if (error) {
      if (error.code === "P0002") {
        return NextResponse.json(
          { error: "게시글을 찾을 수 없습니다." },
          { status: 404 },
        );
      }
      if (error.code === "42501") {
        return NextResponse.json(
          { error: "수정 권한이 없습니다." },
          { status: 403 },
        );
      }
      if (error.code === "22023" || error.code === "23514" || error.code === "55000") {
        return NextResponse.json(
          { error: "게시글 수정 입력을 확인해주세요." },
          { status: 400 },
        );
      }
      console.error("Update post error:", error.code);
      return NextResponse.json(
        { error: "게시글 수정에 실패했습니다." },
        { status: 503 },
      );
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (
      !result ||
      result.post_id !== id ||
      (result.updated !== true && result.updated !== false) ||
      typeof result.viewer_is_author !== "boolean"
    ) {
      return NextResponse.json(
        { error: "게시글 수정 결과를 확인하지 못했습니다." },
        { status: 503 },
      );
    }

    const { data: updatedPost, error: updatedPostError } = await serviceClient
      .from("community_posts")
      .select(COMMUNITY_POST_PUBLIC_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (updatedPostError || !updatedPost) {
      return NextResponse.json(
        { error: "수정된 게시글을 불러오지 못했습니다." },
        { status: 503 },
      );
    }

    // 제목/본문/카테고리 변경 시 랜딩에서도 즉시 반영 — 실패해도 응답은 성공
    try {
      revalidatePath("/");
      revalidatePath("/wedding");
      revalidatePath("/community");
    } catch (e) {
      console.error("[posts.PATCH] revalidatePath failed (non-fatal):", e);
    }

    return NextResponse.json({
      post: { ...updatedPost, viewer_is_author: result.viewer_is_author },
    });
  } catch (err) {
    console.error("Update post error:", err);
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
      return NextResponse.json({ error: "게시글을 확인할 수 없습니다." }, { status: 400 });
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

    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:post:delete", req, user.id),
      { maxRequests: 10, windowMs: 60 * 60 * 1_000 },
      user.id,
    );
    if (limited) return limited;

    // The database function locks the post, checks current author/admin
    // permission, deletes it, and adjusts post_count in one transaction.
    const { data, error } = await getServiceClient().rpc("community_hard_delete_post", {
      p_actor_id: user.id,
      p_post_id: id,
    });

    if (error) {
      if (error.code === "42501") {
        return NextResponse.json(
          { error: "삭제 권한이 없습니다." },
          { status: 403 },
        );
      }
      console.error("Delete post error:", error.code);
      return NextResponse.json(
        { error: "게시글 삭제에 실패했습니다." },
        { status: 503 },
      );
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (
      !result ||
      result.post_id !== id ||
      (result.deleted !== true && result.deleted !== false)
    ) {
      console.error("Delete post verification failed");
      return NextResponse.json(
        { error: "게시글 삭제 결과를 확인하지 못했습니다." },
        { status: 503 },
      );
    }

    // 랜딩 / 커뮤니티 ISR 캐시 무효화 — 실패해도 응답은 성공
    try {
      revalidatePath("/");
      revalidatePath("/wedding");
      revalidatePath("/community");
    } catch (e) {
      console.error("[posts.DELETE] revalidatePath failed (non-fatal):", e);
    }

    return NextResponse.json({
      success: true,
      alreadyDeleted: result.deleted === false,
    });
  } catch (err) {
    console.error("Delete post error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
