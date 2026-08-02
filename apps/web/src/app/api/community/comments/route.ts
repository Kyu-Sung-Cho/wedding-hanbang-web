import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { mobileBridgeJson } from "@/lib/mobile/boundedJsonResponse";
import { getSafeDefaultCommunityNickname } from "@/lib/community/nickname";
import { fallbackCommunityAuthor, getCommunityAuthorMap } from "@/lib/community/authorProfiles";
import { canReadCommunityPost } from "@/lib/community/publicPostRules";
import { sanitizeHtmlWithInputLimit } from "@/utils/sanitize";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import type { CommentWithAuthor, CreateCommentInput } from "@/types/community.types";
import { isRecord, isUuid, readBoundedJsonValue } from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { COMMUNITY_COMMENT_PUBLIC_SELECT } from "@/lib/community/commentSelect";
import { getCommunityPublicIdForUser } from "@/lib/community/publicIdentity";

const MAX_BODY_BYTES = 32 * 1024;
const MAX_COMMENTS_PER_RESPONSE = 100;
const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Authorization",
};

function getServiceClient() {
  return createAdminClient();
}

// 댓글 목록 조회 (트리 구조)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const postId = searchParams.get("postId");

    if (!isUuid(postId)) {
      return NextResponse.json(
        { error: "올바른 postId가 필요합니다." },
        { status: 400 }
      );
    }

    const ingressLimited = await checkRateLimitPersistent(
      rateLimitKey("community:comments:list", req),
      { maxRequests: 120, windowMs: 60 * 1000 },
    );
    if (ingressLimited) return ingressLimited;

    const supabase = await createClientFromRequest(req);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const viewerPublicId = await getCommunityPublicIdForUser(
      getServiceClient(),
      user?.id,
    );

    const { data: targetPost, error: postFetchError } = await supabase
      .from("community_posts")
      .select("id, author_id:author_public_id, visibility, under_review")
      .eq("id", postId)
      .maybeSingle();

    if (postFetchError) {
      console.error("Comment parent post access check error:", safeErrorDiagnostic(postFetchError));
      return NextResponse.json(
        { error: "게시글 접근 확인에 실패했습니다." },
        { status: 500 }
      );
    }

    if (!targetPost || !canReadCommunityPost(targetPost, { userId: viewerPublicId })) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없거나 접근 권한이 없습니다." },
        { status: 404 }
      );
    }

    // 댓글 조회
    const { data: comments, error } = await supabase
      .from("community_comments")
      .select(COMMUNITY_COMMENT_PUBLIC_SELECT)
      .eq("post_id", postId)
      .order("created_at", { ascending: true })
      .limit(MAX_COMMENTS_PER_RESPONSE + 1);

    if (error) {
      console.error("List comments error:", safeErrorDiagnostic(error));
      return NextResponse.json(
        { error: "댓글을 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    // 작성자 프로필 별도 조회
    const boundedComments = (comments ?? []).slice(0, MAX_COMMENTS_PER_RESPONSE);
    const commentsTruncated = (comments?.length ?? 0) > MAX_COMMENTS_PER_RESPONSE;
    const commentAuthorIds = [...new Set(boundedComments.map((c) => c.author_id))];
    const commentAuthorMap = await getCommunityAuthorMap(supabase, commentAuthorIds);

    // 인증 사용자의 투표 상태 조회
    let userVotesMap: Record<string, number> = {};
    if (user && boundedComments.length > 0) {
      const commentIds = boundedComments.map((c) => c.id);
      const { data: votes } = await supabase
        .from("community_votes")
        .select("comment_id, vote_type")
        .eq("user_id", user.id)
        .in("comment_id", commentIds);

      if (votes) {
        userVotesMap = Object.fromEntries(
          votes.map((v) => [v.comment_id, v.vote_type])
        );
      }
    }

    // 트리 구조로 변환
    const commentsWithVotes = boundedComments.map((c) => ({
      ...c,
      author: commentAuthorMap[c.author_id] ?? fallbackCommunityAuthor(c.author_id),
      is_author: Boolean(viewerPublicId && c.author_id === viewerPublicId),
      user_vote: userVotesMap[c.id] ?? null,
    }));

    const topLevel: CommentWithAuthor[] = [];
    const repliesMap: Record<string, CommentWithAuthor[]> = {};

    for (const comment of commentsWithVotes) {
      if (comment.parent_id) {
        if (!repliesMap[comment.parent_id]) {
          repliesMap[comment.parent_id] = [];
        }
        repliesMap[comment.parent_id].push(comment as CommentWithAuthor);
      } else {
        topLevel.push(comment as CommentWithAuthor);
      }
    }

    // 대댓글을 부모에 연결
    const tree = topLevel.map((comment) => ({
      ...comment,
      replies: repliesMap[comment.id] ?? [],
    }));

    return mobileBridgeJson(
      { comments: tree, truncated: commentsTruncated },
      { headers: PRIVATE_RESPONSE_HEADERS },
    );
  } catch (err) {
    console.error("List comments error:", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// 댓글 작성
function atomicCommentErrorStatus(error: unknown): number {
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

// 댓글 작성
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

    const rlResult = await checkRateLimitPersistent(
      rateLimitKey("community:comment:create", req, user.id),
      { maxRequests: 30, windowMs: 10 * 60 * 1000 },
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

    const { post_id, parent_id, content: rawContent } =
      bodyResult.value as unknown as CreateCommentInput;
    const content = sanitizeHtmlWithInputLimit(
      typeof rawContent === "string" ? rawContent : "",
      5000,
    );

    if (
      !isUuid(post_id)
      || (parent_id !== undefined && parent_id !== null && !isUuid(parent_id))
      || content.trim().length === 0
    ) {
      return NextResponse.json(
        { error: "입력값을 확인해 주세요." },
        { status: 400 },
      );
    }

    const serviceClient = getServiceClient();
    const nickname = getSafeDefaultCommunityNickname(undefined, user.id);
    const { data: comment, error } = await serviceClient
      .rpc("community_create_comment_atomic", {
        p_actor_id: user.id,
        p_post_id: post_id,
        p_parent_id: parent_id ?? null,
        p_content: content,
        p_default_nickname: nickname,
      })
      .select(COMMUNITY_COMMENT_PUBLIC_SELECT)
      .single();

    if (error || !comment) {
      console.error("Create comment atomic RPC error:", safeErrorDiagnostic(error));
      const status = atomicCommentErrorStatus(error);
      const message =
        status === 404
          ? "게시글 또는 부모 댓글을 찾을 수 없거나 접근 권한이 없습니다."
          : status === 403
            ? "현재 계정으로는 댓글을 작성할 수 없습니다."
          : status === 400
            ? "댓글 입력값을 확인해 주세요."
            : "댓글 작성에 실패했습니다.";
      return NextResponse.json({ error: message }, { status });
    }

    let author = fallbackCommunityAuthor(comment.author_id);
    try {
      const authorMap = await getCommunityAuthorMap(
        serviceClient,
        [comment.author_id],
      );
      author = authorMap[comment.author_id] ?? author;
    } catch (authorError) {
      // The write is already committed. A display-only profile lookup must
      // not turn success into a retryable 500 and create a duplicate comment.
      console.error(
        "Created comment author lookup failed (non-fatal):",
        safeErrorDiagnostic(authorError),
      );
    }
    const commentWithAuthor = {
      ...comment,
      author,
      is_author: true,
    };

    return NextResponse.json(
      { comment: commentWithAuthor },
      { status: 201 },
    );
  } catch (err) {
    console.error("Create comment error:", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
