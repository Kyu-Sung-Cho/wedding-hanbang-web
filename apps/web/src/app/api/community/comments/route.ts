import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { getSafeDefaultCommunityNickname } from "@/lib/community/nickname";
import { fallbackCommunityAuthor, getCommunityAuthorMap } from "@/lib/community/authorProfiles";
import { canReadCommunityPost } from "@/lib/community/publicPostRules";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import {
  findObviousPublicPersonalInfo,
  PUBLIC_PERSONAL_INFO_BLOCK_MESSAGE,
} from "@/lib/community/publicPersonalInfo";
import { sanitizeText } from "@/utils/sanitize";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import {
  isBodyTooLarge,
  isRecord,
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import type { CommentWithAuthor } from "@/types/community.types";
import { log } from "@/utils/log";

const MAX_COMMENT_BODY_BYTES = 8 * 1024;
const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization, Cookie, Origin, Sec-Fetch-Site",
};

function json(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    ...init,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

// 댓글 목록 조회 (트리 구조)
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const { searchParams } = new URL(req.url);
    const postId = searchParams.get("postId");

    if (!postId) {
      return json(
        { error: "postId가 필요합니다." },
        { status: 400 }
      );
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: targetPost, error: postFetchError } = await supabase
      .from("community_posts")
      .select("id, author_id, visibility, under_review")
      .eq("id", postId)
      .maybeSingle();

    if (postFetchError) {
      log.error("Comment parent post access check error:", postFetchError);
      return json(
        { error: "게시글 접근 확인에 실패했습니다." },
        { status: 500 }
      );
    }

    if (!targetPost || !canReadCommunityPost(targetPost, { userId: user?.id ?? null })) {
      return json(
        { error: "게시글을 찾을 수 없거나 접근 권한이 없습니다." },
        { status: 404 }
      );
    }

    // 댓글 조회
    const { data: comments, error } = await supabase
      .from("community_comments")
      .select("*")
      .eq("post_id", postId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true });

    if (error) {
      log.error("List comments error:", error);
      return json(
        { error: "댓글을 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    // 작성자 프로필 별도 조회
    const commentAuthorIds = [...new Set((comments ?? []).map((c) => c.author_id))];
    const commentAuthorMap = await getCommunityAuthorMap(supabase, commentAuthorIds);

    // 인증 사용자의 투표 상태 조회
    let userVotesMap: Record<string, number> = {};
    if (user && comments && comments.length > 0) {
      const commentIds = comments.map((c) => c.id);
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
    const commentsWithVotes = (comments ?? []).map((c) => ({
      ...c,
      author: commentAuthorMap[c.author_id] ?? fallbackCommunityAuthor(c.author_id),
      user_vote: userVotesMap[c.id] ?? null,
    }));

    const topLevel: CommentWithAuthor[] = [];
    const repliesMap: Record<string, CommentWithAuthor[]> = {};
    const visibleCommentIds = new Set(commentsWithVotes.map((comment) => comment.id));
    const missingParentIds = [...new Set(commentsWithVotes
      .map((comment) => comment.parent_id)
      .filter((id): id is string => Boolean(id) && !visibleCommentIds.has(id)))];
    const deletedParentIds = new Set<string>();
    if (missingParentIds.length > 0) {
      // 같은 열람자 권한으로 작성자가 삭제한 부모의 ID만 확인한다.
      // 차단·운영 숨김·존재하지 않는 부모는 복원하지 않는다.
      const { data: deletedParents, error: deletedParentsError } = await supabase
        .from("community_comments")
        .select("id")
        .eq("post_id", postId)
        .is("parent_id", null)
        .eq("is_deleted", true)
        .not("author_deleted_at", "is", null)
        .in("id", missingParentIds);
      if (deletedParentsError) {
        log.error("Deleted comment parent lookup failed:", deletedParentsError);
        return json({ error: "댓글을 불러올 수 없습니다." }, { status: 500 });
      }
      for (const parent of deletedParents ?? []) deletedParentIds.add(parent.id);
      if (deletedParentIds.size > 0) {
        // 작성자 삭제 뒤 운영 숨김이 겹칠 수 있다. 후보 ID의 활성 조치만
        // 서버 권한으로 확인하고 원문·작성자·사유는 읽거나 응답하지 않는다.
        const { data: activeCases, error: moderationError } = await createAdminClient()
          .from("community_moderation_cases")
          .select("target_id")
          .eq("target_type", "comment")
          .eq("status", "active")
          .in("target_id", [...deletedParentIds]);
        if (moderationError || !Array.isArray(activeCases)) {
          log.error("Deleted comment parent moderation check failed:", moderationError);
          return json({ error: "댓글을 불러올 수 없습니다." }, { status: 500 });
        }
        for (const moderationCase of activeCases) deletedParentIds.delete(moderationCase.target_id);
      }
    }

    for (const comment of commentsWithVotes) {
      if (comment.parent_id) {
        if (!repliesMap[comment.parent_id]) {
          repliesMap[comment.parent_id] = [];
          // 삭제 부모의 원문·신원·시간을 싣지 않고 기존 자리표시자만 구성한다.
          if (deletedParentIds.has(comment.parent_id)) {
            topLevel.push({
              id: comment.parent_id,
              post_id: postId,
              parent_id: null,
              author_id: "",
              content_origin: "legacy_unverified",
              content: "",
              upvote_count: 0,
              is_deleted: true,
              created_at: "",
              updated_at: "",
              author: fallbackCommunityAuthor(null),
              user_vote: null,
            } as CommentWithAuthor);
          }
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

    return json({ comments: tree });
  } catch (err) {
    log.error("List comments error:", err);
    return json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

type AtomicCommentResult = {
  comment: Record<string, unknown> & {
    author: Record<string, unknown>;
  };
  post_comment_count: number;
};

function isAtomicCommentResult(
  value: unknown,
  actorId: string,
): value is AtomicCommentResult {
  return (
    isRecord(value)
    && isRecord(value.comment)
    && typeof value.comment.id === "string"
    && value.comment.author_id === actorId
    && isRecord(value.comment.author)
    && value.comment.author.user_id === actorId
    && !Object.hasOwn(value, "replayed")
    && typeof value.post_comment_count === "number"
    && Number.isSafeInteger(value.post_comment_count)
    && value.post_comment_count >= 0
  );
}

function rpcFailure(error: { message?: string | null }) {
  const message = error.message ?? "";
  if (message.includes("COMMUNITY_COMMENT_IDEMPOTENCY_CONFLICT")) {
    return json(
      {
        code: "COMMUNITY_COMMENT_IDEMPOTENCY_CONFLICT",
        error: "같은 요청 키를 다른 답변에 다시 사용할 수 없습니다.",
      },
      { status: 409 },
    );
  }
  if (message.includes("COMMUNITY_SUSPENDED")) {
    return json(
      {
        code: "COMMUNITY_SUSPENDED",
        error: "현재 커뮤니티 작성 기능을 사용할 수 없습니다.",
      },
      { status: 403 },
    );
  }
  if (
    message.includes("COMMUNITY_PARENT_POST_MISMATCH")
    || message.includes("COMMUNITY_NESTED_REPLY_NOT_ALLOWED")
  ) {
    return json({ error: "답글 대상이 올바르지 않습니다." }, { status: 400 });
  }
  if (
    message.includes("COMMUNITY_POST_NOT_ACCESSIBLE")
    || message.includes("COMMUNITY_PARENT_COMMENT_NOT_FOUND")
  ) {
    return json(
      { error: "글이나 답변을 찾을 수 없거나 접근 권한이 없습니다." },
      { status: 404 },
    );
  }
  return json(
    {
      code: "COMMUNITY_COMMENT_SAVE_FAILED",
      error: "답변을 안전하게 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    },
    { status: 503 },
  );
}

// 댓글과 재방문 알림은 DB RPC 한 번으로 함께 커밋한다.
export async function POST(req: NextRequest) {
  if (!isTrustedMutationRequest(req)) {
    return json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
  }
  if (isBodyTooLarge(req, MAX_COMMENT_BODY_BYTES)) {
    return json({ error: "답변 요청이 너무 큽니다." }, { status: 413 });
  }

  try {
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? "";
    if (!isUuid(idempotencyKey)) {
      return json(
        {
          code: "COMMUNITY_COMMENT_IDEMPOTENCY_REQUIRED",
          error: "답변 요청 식별자가 올바르지 않습니다. 새로고침 후 다시 시도해 주세요.",
        },
        { status: 400 },
      );
    }

    const bodyResult = await readBoundedUtf8Text(req, MAX_COMMENT_BODY_BYTES);
    if (!bodyResult.ok) {
      return json(
        {
          error:
            bodyResult.reason === "too_large"
              ? "답변 요청이 너무 큽니다."
              : "답변 요청을 읽을 수 없습니다.",
        },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }

    let unknownBody: unknown;
    try {
      unknownBody = JSON.parse(bodyResult.text) as unknown;
    } catch {
      return json({ error: "답변 요청 형식이 올바르지 않습니다." }, { status: 400 });
    }
    if (!isRecord(unknownBody)) {
      return json({ error: "답변 요청 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const postId = unknownBody.post_id;
    const parentId = unknownBody.parent_id;
    const rawContent = unknownBody.content;
    if (
      !isUuid(postId)
      || (
        parentId !== undefined
        && parentId !== null
        && !isUuid(parentId)
      )
      || typeof rawContent !== "string"
    ) {
      return json({ error: "답변 대상이나 내용이 올바르지 않습니다." }, { status: 400 });
    }

    // Public comments are a plain-text surface. Removing markup before the PII
    // scan also removes hidden href/src/alt/title values from persisted data.
    const content = sanitizeText(rawContent).slice(0, 5000).trim();
    if (!content) {
      return json({ error: "답변 내용을 입력해 주세요." }, { status: 400 });
    }

    const personalInfoKinds = findObviousPublicPersonalInfo(content);
    if (personalInfoKinds.length > 0) {
      return json(
        {
          error: PUBLIC_PERSONAL_INFO_BLOCK_MESSAGE,
          code: "COMMUNITY_PERSONAL_INFO_DETECTED",
          detected: personalInfoKinds,
        },
        { status: 422 }
      );
    }

    const normalizedParentId = typeof parentId === "string" ? parentId : null;
    const writeService = createAdminClient();
    const profileNickname = getSafeDefaultCommunityNickname(null, user.id);
    const { data: replayData, error: replayError } = await writeService.rpc(
      "community_replay_comment_command_service",
      {
        p_actor_id: user.id,
        p_post_id: postId,
        p_parent_id: normalizedParentId,
        p_content: content,
        p_idempotency_key: idempotencyKey,
      },
    );
    if (replayError) return rpcFailure(replayError);
    if (replayData !== null && replayData !== undefined) {
      if (!isAtomicCommentResult(replayData, user.id)) {
        return json(
          {
            code: "COMMUNITY_COMMENT_REPLAY_UNCONFIRMED",
            error: "저장된 댓글 결과를 안전하게 확인하지 못했습니다.",
          },
          { status: 503 },
        );
      }

      return json(replayData, { status: 201 });
    }

    const writeAccess = await checkCommunityWriteAccess(supabase, user.id);
    if (!writeAccess.allowed) {
      return json(
        { code: writeAccess.code, error: writeAccess.message },
        { status: writeAccess.status },
      );
    }
    const rlResult = await checkRateLimitPersistent(
      rateLimitKey("community:comment:create", req, user.id),
      { maxRequests: 30, windowMs: 10 * 60 * 1000 },
    );
    if (rlResult) return rlResult;

    const { data: targetPost, error: postFetchError } = await supabase
      .from("community_posts")
      .select("id, author_id, visibility, under_review")
      .eq("id", postId)
      .maybeSingle();

    if (postFetchError) {
      return json(
        { error: "게시글 접근 권한을 확인하지 못했습니다." },
        { status: 503 },
      );
    }
    if (!targetPost || !canReadCommunityPost(targetPost, { userId: user.id })) {
      return json(
        { error: "게시글을 찾을 수 없거나 접근 권한이 없습니다." },
        { status: 404 },
      );
    }

    if (normalizedParentId) {
      const { data: parentComment, error: parentFetchError } = await supabase
        .from("community_comments")
        .select("id, post_id, parent_id, is_deleted")
        .eq("id", normalizedParentId)
        .maybeSingle();

      if (parentFetchError) {
        return json(
          { error: "답글 대상을 확인하지 못했습니다." },
          { status: 503 },
        );
      }
      if (!parentComment || parentComment.is_deleted) {
        return json({ error: "답글 대상을 찾을 수 없습니다." }, { status: 404 });
      }
      if (parentComment.post_id !== postId || parentComment.parent_id) {
        return json({ error: "답글 대상이 올바르지 않습니다." }, { status: 400 });
      }
    }

    const { data: atomicData, error: atomicError } = await writeService.rpc(
      "community_create_comment_with_notifications_service",
      {
        p_actor_id: user.id,
        p_post_id: postId,
        p_parent_id: normalizedParentId,
        p_content: content,
        p_profile_nickname: profileNickname,
        p_idempotency_key: idempotencyKey,
      },
    );

    if (atomicError) {
      log.error("Atomic community comment creation failed:", atomicError.code);
      return rpcFailure(atomicError);
    }
    if (!isAtomicCommentResult(atomicData, user.id)) {
      return json(
        {
          code: "COMMUNITY_COMMENT_SAVE_UNCONFIRMED",
          error: "답변 저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.",
        },
        { status: 503 },
      );
    }

    return json(atomicData, { status: 201 });
  } catch (err) {
    log.error("Create comment error:", err);
    return json(
      {
        code: "COMMUNITY_COMMENT_SAVE_FAILED",
        error: "답변을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status: 503 },
    );
  }
}
