import { parseCommunityCommentOrigin } from "./communityTrust.mjs";

/**
 * 글 화면의 답변·답글 목록.
 *
 * `GET /api/community/comments` 는 최상위 답변마다 `replies`(1단계)를 붙여 보낸다. 앱은 예전에
 * 최상위만 읽고 답글을 버렸다. 여기서 답글까지 읽고, 작성 출처는 최상위와 같이 **깨져 있으면
 * 목록 전체를 실패로** 처리한다(출처 표시 없는 글을 그리지 않는다).
 *
 * 지운 글(`is_deleted: true`)은 본문을 비운 채로만 들고 다닌다. 화면은 웹 `CommentItem` 과 같은
 * 자리표시(「삭제된 답변입니다」·「삭제된 답글입니다」)를 그리고, 그 아래 답글은 계속 보인다.
 */

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseAuthor(value) {
  if (!isRecord(value) || typeof value.nickname !== "string") return null;
  return {
    nickname: value.nickname,
    rank: typeof value.rank === "string" ? value.rank : "",
    role: value.role === "bride" || value.role === "groom" || value.role === "neutral"
      ? value.role
      : null,
  };
}

function parseComment(value, { allowReplies }) {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    throw new Error("comment contract invalid");
  }
  const isDeleted = value.is_deleted === true;
  const contentOrigin = parseCommunityCommentOrigin(value);
  if (!contentOrigin && !isDeleted) throw new Error("comment trust metadata invalid");
  if (!isDeleted && typeof value.content !== "string") throw new Error("comment contract invalid");

  const rawReplies = allowReplies && Array.isArray(value.replies) ? value.replies : [];
  return {
    id: value.id,
    author_id: typeof value.author_id === "string" ? value.author_id : "",
    content: isDeleted ? "" : value.content,
    created_at: typeof value.created_at === "string" ? value.created_at : "",
    content_origin: contentOrigin ?? "legacy_unverified",
    is_deleted: isDeleted,
    author: isDeleted ? null : parseAuthor(value.author),
    replies: rawReplies.map((reply) => parseComment(reply, { allowReplies: false })),
  };
}

export function parseCommunityCommentThread(value) {
  if (!Array.isArray(value)) throw new Error("comments contract invalid");
  return value.map((comment) => parseComment(comment, { allowReplies: true }));
}

/** 웹 `CommentItem` 의 `삭제된 {isReply ? "답글" : "답변"}입니다` 와 같은 말. */
export function communityDeletedCommentLabel(isReply) {
  return `삭제된 ${isReply ? "답글" : "답변"}입니다`;
}

export function countVisibleCommunityComments(comments) {
  let count = 0;
  for (const comment of comments) {
    if (!comment.is_deleted) count += 1;
    for (const reply of comment.replies) {
      if (!reply.is_deleted) count += 1;
    }
  }
  return count;
}

/**
 * 차단한 사람의 답변과 답글을 숨긴다. 그 사람의 답변 아래 달린 답글도 함께 빠진다 —
 * 웹 `CommentSection` 의 `removeBlockedAuthors` 와 같고, 다시 불러왔을 때 서버가 돌려주는
 * 모양과도 같다(부모가 없는 답글은 서버 트리에서 빠진다).
 */
export function hideCommunityCommentsByAuthor(comments, authorId) {
  const blocked = typeof authorId === "string" ? authorId.toLowerCase() : "";
  const isBlocked = (comment) => blocked !== "" && comment.author_id.toLowerCase() === blocked;
  let removedCount = 0;
  const kept = [];
  for (const comment of comments) {
    if (isBlocked(comment)) {
      removedCount += countVisibleCommunityComments([comment]);
      continue;
    }
    const replies = comment.replies.filter((reply) => {
      if (!isBlocked(reply)) return true;
      if (!reply.is_deleted) removedCount += 1;
      return false;
    });
    kept.push(replies.length === comment.replies.length ? comment : { ...comment, replies });
  }
  return { comments: kept, removedCount };
}
