function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMUNITY_ACTION_KINDS = new Set(["vote", "bookmark", "comment"]);

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function createCommunityPostActionGate() {
  let generation = 0;
  let ownerId = null;
  let nextOperationId = 0;
  const active = new Map();

  function isCurrent(token) {
    if (
      !isRecord(token)
      || token.generation !== generation
      || token.ownerId !== ownerId
    ) return false;
    if (token.kind === undefined) return true;
    return COMMUNITY_ACTION_KINDS.has(token.kind)
      && active.get(token.kind) === token.operationId;
  }

  return {
    setOwner(nextOwnerId) {
      if (nextOwnerId !== null && !isUuid(nextOwnerId)) {
        throw new Error("COMMUNITY_SESSION_OWNER_INVALID");
      }
      const normalized = nextOwnerId?.toLowerCase() ?? null;
      if (ownerId === normalized) return false;
      generation += 1;
      ownerId = normalized;
      active.clear();
      return true;
    },
    capture() {
      return ownerId === null ? null : { generation, ownerId };
    },
    begin(kind) {
      const socialActionBusy = (kind === "vote" || kind === "bookmark")
        && (active.has("vote") || active.has("bookmark"));
      if (
        ownerId === null
        || !COMMUNITY_ACTION_KINDS.has(kind)
        || active.has(kind)
        || socialActionBusy
      ) {
        return null;
      }
      nextOperationId += 1;
      active.set(kind, nextOperationId);
      return { generation, ownerId, kind, operationId: nextOperationId };
    },
    hasActiveAction() {
      return active.size > 0;
    },
    isCurrent,
    finish(token) {
      if (isCurrent(token) && token.kind !== undefined) {
        active.delete(token.kind);
        return true;
      }
      return false;
    },
  };
}

export function createCommunityCommentIdempotencyStore(createId) {
  if (typeof createId !== "function") {
    throw new Error("COMMUNITY_COMMENT_IDEMPOTENCY_FACTORY_INVALID");
  }
  let current = null;
  return {
    keyFor(ownerId, postId, content) {
      if (
        !isUuid(ownerId)
        || !isUuid(postId)
        || typeof content !== "string"
        || content.length < 1
        || Array.from(content).length > 5_000
      ) throw new Error("COMMUNITY_COMMENT_IDEMPOTENCY_CONTEXT_INVALID");
      const identity = JSON.stringify([
        ownerId.toLowerCase(),
        postId.toLowerCase(),
        content,
      ]);
      if (current?.identity === identity) return current.key;
      const key = createId();
      if (!isUuid(key)) throw new Error("COMMUNITY_COMMENT_IDEMPOTENCY_KEY_INVALID");
      current = { identity, key: key.toLowerCase() };
      return current.key;
    },
    clearIf(key) {
      if (!isUuid(key) || current?.key !== key.toLowerCase()) return false;
      current = null;
      return true;
    },
    clear() {
      current = null;
    },
  };
}

function isSafeMessage(value) {
  return typeof value === "string"
    && Array.from(value).length >= 1
    && Array.from(value).length <= 240
    && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

function fallbackMessageForStatus(status, fallbackMessage) {
  if (status === 401) return "로그인이 필요해요. 다시 로그인해주세요.";
  if (status === 403) return "현재 이 활동을 완료할 수 없어요. 계정 상태를 확인해주세요.";
  if (status === 429) return "요청이 너무 많아요. 잠시 후 다시 시도해주세요.";
  if (status === 503) return "커뮤니티 상태를 안전하게 확인하지 못했어요. 잠시 후 다시 시도해주세요.";
  return fallbackMessage;
}

export class CommunityPostMutationError extends Error {
  constructor({ code, status, displayMessage }) {
    super(code);
    this.name = "CommunityPostMutationError";
    this.code = code;
    this.status = status;
    this.displayMessage = displayMessage;
    this.shouldRefresh = true;
  }
}

async function throwResponseError(response, fallbackCode, fallbackMessage) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const code = isRecord(payload)
    && typeof payload.code === "string"
    && /^[A-Z0-9_]{1,80}$/.test(payload.code)
    ? payload.code
    : fallbackCode;
  const displayMessage = isRecord(payload) && isSafeMessage(payload.error)
    ? payload.error
    : fallbackMessageForStatus(response.status, fallbackMessage);
  throw new CommunityPostMutationError({
    code,
    status: Number.isSafeInteger(response.status) ? response.status : 0,
    displayMessage,
  });
}

export function parseCommunityVoteResponse(value) {
  if (
    !isRecord(value)
    || Object.keys(value).length !== 2
    || !isNonNegativeInteger(value.upvote_count)
    || !isNonNegativeInteger(value.downvote_count)
  ) {
    throw new Error("COMMUNITY_VOTE_RESPONSE_INVALID");
  }
  return {
    upvoteCount: value.upvote_count,
    downvoteCount: value.downvote_count,
  };
}

export function parseCommunityBookmarkResponse(value) {
  if (
    !isRecord(value)
    || Object.keys(value).length !== 2
    || typeof value.bookmarked !== "boolean"
    || !isNonNegativeInteger(value.bookmark_count)
  ) {
    throw new Error("COMMUNITY_BOOKMARK_RESPONSE_INVALID");
  }
  return {
    bookmarked: value.bookmarked,
    bookmarkCount: value.bookmark_count,
  };
}

export async function submitCommunityVote({
  apiFetchForExpectedUser,
  ownerId,
  postId,
  voteType,
}) {
  if (
    typeof apiFetchForExpectedUser !== "function"
    || !isUuid(ownerId)
    || !isUuid(postId)
    || !(voteType === 0 || voteType === 1)
  ) {
    throw new Error("COMMUNITY_VOTE_REQUEST_INVALID");
  }
  const response = await apiFetchForExpectedUser(
    ownerId,
    `/api/community/posts/${postId}/vote`,
    { method: "POST", body: JSON.stringify({ voteType }) },
  );
  if (!response || typeof response.ok !== "boolean" || typeof response.json !== "function") {
    throw new CommunityPostMutationError({
      code: "COMMUNITY_VOTE_REQUEST_INVALID_RESPONSE",
      status: 0,
      displayMessage: "좋아요 저장 결과를 확인하지 못했어요. 최신 상태를 다시 확인합니다.",
    });
  }
  if (!response.ok) {
    return throwResponseError(
      response,
      "COMMUNITY_VOTE_REQUEST_FAILED",
      "좋아요를 저장하지 못했어요. 잠시 후 다시 시도해주세요.",
    );
  }
  const parsed = parseCommunityVoteResponse(await response.json());
  return { ...parsed, userVote: voteType };
}

export async function setCommunityBookmark({
  apiFetchForExpectedUser,
  ownerId,
  postId,
  bookmarked,
}) {
  if (
    typeof apiFetchForExpectedUser !== "function"
    || !isUuid(ownerId)
    || !isUuid(postId)
    || typeof bookmarked !== "boolean"
  ) {
    throw new Error("COMMUNITY_BOOKMARK_REQUEST_INVALID");
  }
  const response = await apiFetchForExpectedUser(
    ownerId,
    `/api/community/posts/${postId}/bookmark`,
    { method: "POST", body: JSON.stringify({ bookmarked }) },
  );
  if (!response || typeof response.ok !== "boolean" || typeof response.json !== "function") {
    throw new CommunityPostMutationError({
      code: "COMMUNITY_BOOKMARK_REQUEST_INVALID_RESPONSE",
      status: 0,
      displayMessage: "북마크 저장 결과를 확인하지 못했어요. 최신 상태를 다시 확인합니다.",
    });
  }
  if (!response.ok) {
    return throwResponseError(
      response,
      "COMMUNITY_BOOKMARK_REQUEST_FAILED",
      "북마크를 저장하지 못했어요. 잠시 후 다시 시도해주세요.",
    );
  }
  return parseCommunityBookmarkResponse(await response.json());
}

function parseCommunityPostSocialState(value, expectedPostId) {
  if (
    !isRecord(value)
    || !isUuid(value.id)
    || value.id.toLowerCase() !== expectedPostId.toLowerCase()
    || !isNonNegativeInteger(value.upvote_count)
    || !isNonNegativeInteger(value.downvote_count)
    || !(value.user_vote === null || value.user_vote === -1 || value.user_vote === 0 || value.user_vote === 1)
    || typeof value.user_bookmarked !== "boolean"
  ) {
    throw new Error("COMMUNITY_POST_SOCIAL_RESPONSE_INVALID");
  }
  return {
    userVote: value.user_vote ?? 0,
    bookmarked: value.user_bookmarked,
    upvoteCount: value.upvote_count,
    downvoteCount: value.downvote_count,
  };
}

export async function fetchCommunityPostSocialState({
  apiFetchForExpectedUser,
  ownerId,
  postId,
}) {
  if (
    typeof apiFetchForExpectedUser !== "function"
    || !isUuid(ownerId)
    || !isUuid(postId)
  ) {
    throw new Error("COMMUNITY_POST_SOCIAL_REQUEST_INVALID");
  }
  const response = await apiFetchForExpectedUser(
    ownerId,
    `/api/community/posts/${postId}`,
    {},
  );
  if (!response || typeof response.ok !== "boolean" || typeof response.json !== "function") {
    throw new Error("COMMUNITY_POST_SOCIAL_RESPONSE_INVALID");
  }
  if (!response.ok) {
    return throwResponseError(
      response,
      "COMMUNITY_POST_SOCIAL_REQUEST_FAILED",
      "최신 좋아요와 북마크 상태를 확인하지 못했어요.",
    );
  }
  return parseCommunityPostSocialState(await response.json(), postId);
}
