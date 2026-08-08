const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const WEB_REPLY_HREF_PATTERN =
  /^\/wedding\/community\/post\/([0-9a-f-]{36})#comment-([0-9a-f-]{36})$/i;
const MOBILE_REPLY_HREF_PATTERN =
  /^\/community\/post\/([0-9a-f-]{36})\?commentId=([0-9a-f-]{36})$/i;

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function assertTarget(target) {
  if (
    target === null
    || typeof target !== "object"
    || Array.isArray(target)
    || !(target.kind === "post_reply" || target.kind === "comment_reply")
    || !isUuid(target.postId)
    || !isUuid(target.commentId)
  ) {
    throw new Error("INVALID_COMMUNITY_REPLY_NOTIFICATION_TARGET");
  }
}

function matchesExactTarget(value, pattern) {
  if (typeof value !== "string") return false;
  const match = value.match(pattern);
  return Boolean(match && isUuid(match[1]) && isUuid(match[2]));
}

export function buildCommunityReplyWebHref(postId, commentId) {
  if (!isUuid(postId) || !isUuid(commentId)) {
    throw new Error("INVALID_COMMUNITY_REPLY_NOTIFICATION_TARGET");
  }
  return `/wedding/community/post/${postId.toLowerCase()}#comment-${commentId.toLowerCase()}`;
}

export function isAllowedCommunityReplyWebHref(value) {
  return matchesExactTarget(value, WEB_REPLY_HREF_PATTERN);
}

export function isAllowedCommunityReplyPushHref(value) {
  return matchesExactTarget(value, MOBILE_REPLY_HREF_PATTERN);
}

export function parseCommunityReplyPushHref(value) {
  if (typeof value !== "string") return null;
  const match = value.match(MOBILE_REPLY_HREF_PATTERN);
  if (!match || !isUuid(match[1]) || !isUuid(match[2])) return null;
  return Object.freeze({
    postId: match[1].toLowerCase(),
    commentId: match[2].toLowerCase(),
  });
}

/**
 * Lock-screen copy is intentionally generic. The builder accepts no post title,
 * question body, wedding date, budget, vendor, or partner fields, so those
 * details cannot accidentally enter an Expo push payload.
 */
export function buildCommunityReplyPushPayload(target) {
  assertTarget(target);
  const postId = target.postId.toLowerCase();
  const commentId = target.commentId.toLowerCase();
  return Object.freeze({
    title: "웨딩한방 커뮤니티",
    body:
      target.kind === "comment_reply"
        ? "내 답변에 새 답글이 도착했어요."
        : "내 글에 새 답변이 도착했어요.",
    data: Object.freeze({
      type: "community_reply",
      href: `/community/post/${postId}?commentId=${commentId}`,
    }),
  });
}

/**
 * Remote payloads add only opaque delivery identifiers. Navigation is never
 * trusted from this object alone; the mobile client must resolve both ids
 * against the signed-in owner before opening the allowlisted route.
 */
export function buildCommunityRemoteReplyPushPayload(target) {
  assertTarget(target);
  if (!isUuid(target.notificationId) || !isUuid(target.deliveryId)) {
    throw new Error("INVALID_COMMUNITY_REPLY_NOTIFICATION_TARGET");
  }
  const base = buildCommunityReplyPushPayload(target);
  return Object.freeze({
    title: base.title,
    body: base.body,
    data: Object.freeze({
      type: "community_reply",
      href: base.data.href,
      notificationId: target.notificationId.toLowerCase(),
      deliveryId: target.deliveryId.toLowerCase(),
    }),
  });
}

export function parseCommunityRemoteReplyPushData(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 4
    || keys[0] !== "deliveryId"
    || keys[1] !== "href"
    || keys[2] !== "notificationId"
    || keys[3] !== "type"
    || value.type !== "community_reply"
    || !isUuid(value.notificationId)
    || !isUuid(value.deliveryId)
  ) {
    return null;
  }
  const hrefTarget = parseCommunityReplyPushHref(value.href);
  if (!hrefTarget) return null;
  return Object.freeze({
    type: "community_reply",
    href: value.href,
    notificationId: value.notificationId.toLowerCase(),
    deliveryId: value.deliveryId.toLowerCase(),
    postId: hrefTarget.postId,
    commentId: hrefTarget.commentId,
  });
}
