const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COHORT_MESSAGE_TOPICS = new Set(["price", "review", "concern", "chat"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isSafeText(value, maxLength) {
  return typeof value === "string"
    && Array.from(value).length >= 1
    && Array.from(value).length <= maxLength
    && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

function isSafeMultilineText(value, maxLength) {
  return typeof value === "string"
    && Array.from(value).length >= 1
    && Array.from(value).length <= maxLength
    && !/[\p{Cf}\p{Zl}\p{Zp}]/u.test(value)
    && !/\p{Cc}/u.test(value.replace(/[\n\r\t]/g, ""));
}

export function createCommunityCohortGate() {
  let generation = 0;
  let ownerId = null;
  let activeAssignmentId = null;
  let nextAssignmentId = 0;
  let activeMessageId = null;
  let nextMessageId = 0;

  function isCurrent(token) {
    if (
      !isRecord(token)
      || token.generation !== generation
      || token.ownerId !== ownerId
    ) return false;
    if (token.assignmentId !== undefined) {
      return token.assignmentId === activeAssignmentId;
    }
    if (token.messageId !== undefined) {
      return token.messageId === activeMessageId;
    }
    return true;
  }

  return {
    setOwner(nextOwnerId) {
      if (nextOwnerId !== null && !isUuid(nextOwnerId)) {
        throw new Error("COMMUNITY_COHORT_OWNER_INVALID");
      }
      const normalized = nextOwnerId?.toLowerCase() ?? null;
      if (normalized === ownerId) return false;
      generation += 1;
      ownerId = normalized;
      activeAssignmentId = null;
      activeMessageId = null;
      return true;
    },
    capture() {
      return ownerId === null ? null : { generation, ownerId };
    },
    invalidateOperations() {
      if (ownerId === null) return false;
      generation += 1;
      activeAssignmentId = null;
      activeMessageId = null;
      return true;
    },
    beginAssignment() {
      if (ownerId === null || activeAssignmentId !== null) return null;
      nextAssignmentId += 1;
      activeAssignmentId = nextAssignmentId;
      return { generation, ownerId, assignmentId: nextAssignmentId };
    },
    isCurrent,
    finishAssignment(token) {
      if (!isCurrent(token) || token.assignmentId === undefined) return false;
      activeAssignmentId = null;
      return true;
    },
    beginMessage() {
      if (ownerId === null || activeMessageId !== null) return null;
      nextMessageId += 1;
      activeMessageId = nextMessageId;
      return { generation, ownerId, messageId: nextMessageId };
    },
    hasActiveMessage() {
      return activeMessageId !== null;
    },
    finishMessage(token) {
      if (!isCurrent(token) || token.messageId === undefined) return false;
      activeMessageId = null;
      return true;
    },
  };
}

export function mergeCohortMessageSnapshot(snapshot, liveMessages) {
  if (!Array.isArray(snapshot) || !Array.isArray(liveMessages)) {
    throw new Error("COMMUNITY_COHORT_MESSAGE_MERGE_INVALID");
  }
  const byId = new Map();
  for (const message of liveMessages) {
    if (!isRecord(message) || !isUuid(message.id) || typeof message.created_at !== "string") {
      throw new Error("COMMUNITY_COHORT_MESSAGE_MERGE_INVALID");
    }
    byId.set(message.id.toLowerCase(), message);
  }
  for (const message of snapshot) {
    if (!isRecord(message) || !isUuid(message.id) || typeof message.created_at !== "string") {
      throw new Error("COMMUNITY_COHORT_MESSAGE_MERGE_INVALID");
    }
    byId.set(message.id.toLowerCase(), message);
  }
  return [...byId.values()].sort((left, right) => (
    left.created_at.localeCompare(right.created_at)
      || left.id.localeCompare(right.id)
  ));
}

export function createCohortMessageIdempotencyStore(createId) {
  if (typeof createId !== "function") {
    throw new Error("COMMUNITY_COHORT_MESSAGE_IDEMPOTENCY_FACTORY_INVALID");
  }
  let current = null;
  return {
    keyFor(ownerId, roomId, content, threadTopic) {
      const normalizedContent = typeof content === "string" ? content.trim() : "";
      if (
        !isUuid(ownerId)
        || !isUuid(roomId)
        || normalizedContent.length < 1
        || Array.from(normalizedContent).length > 2_000
        || !(threadTopic === undefined || COHORT_MESSAGE_TOPICS.has(threadTopic))
      ) throw new Error("COMMUNITY_COHORT_MESSAGE_IDEMPOTENCY_CONTEXT_INVALID");
      const identity = JSON.stringify([
        ownerId.toLowerCase(),
        roomId.toLowerCase(),
        normalizedContent,
        threadTopic ?? null,
      ]);
      if (current?.identity === identity) return current.key;
      const key = createId();
      if (!isUuid(key)) throw new Error("COMMUNITY_COHORT_MESSAGE_IDEMPOTENCY_KEY_INVALID");
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

export class CommunityCohortAccessError extends Error {
  constructor({ code, status, displayMessage }) {
    super(code);
    this.name = "CommunityCohortAccessError";
    this.code = code;
    this.status = status;
    this.displayMessage = displayMessage;
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function serverErrorFields(payload, fallbackCode, fallbackMessage) {
  return {
    code: isRecord(payload)
      && typeof payload.code === "string"
      && /^[A-Z0-9_]{1,80}$/.test(payload.code)
      ? payload.code
      : fallbackCode,
    displayMessage: isRecord(payload) && isSafeText(payload.error, 240)
      ? payload.error
      : fallbackMessage,
  };
}

export function parseCurrentCohortAccess(value, expectedRoomId) {
  if (!isUuid(expectedRoomId) || !isRecord(value)) {
    throw new Error("COMMUNITY_COHORT_ACCESS_RESPONSE_INVALID");
  }
  if (value.room === null) {
    if (Object.keys(value).length !== 1) {
      throw new Error("COMMUNITY_COHORT_ACCESS_RESPONSE_INVALID");
    }
    return { status: "unassigned" };
  }
  if (
    !isRecord(value.room)
    || !isUuid(value.room.id)
    || !isSafeText(value.room.name, 120)
    || !Number.isSafeInteger(value.room.member_count)
    || value.room.member_count < 0
    || !Array.isArray(value.recentMembers)
    || value.recentMembers.length > 8
    || !(value.lastMessage === null || isSafeMultilineText(value.lastMessage, 2_000))
  ) {
    throw new Error("COMMUNITY_COHORT_ACCESS_RESPONSE_INVALID");
  }
  const room = {
    id: value.room.id.toLowerCase(),
    name: value.room.name,
    memberCount: value.room.member_count,
  };
  return room.id === expectedRoomId.toLowerCase()
    ? { status: "member", room }
    : { status: "different_room", room };
}

export async function fetchCurrentCohortAccess({
  apiFetchForExpectedUser,
  ownerId,
  roomId,
}) {
  if (
    typeof apiFetchForExpectedUser !== "function"
    || !isUuid(ownerId)
    || !isUuid(roomId)
  ) {
    throw new Error("COMMUNITY_COHORT_ACCESS_REQUEST_INVALID");
  }
  const response = await apiFetchForExpectedUser(
    ownerId,
    "/api/community/cohort",
    {},
  );
  if (!response || typeof response.ok !== "boolean" || typeof response.json !== "function") {
    throw new CommunityCohortAccessError({
      code: "COMMUNITY_COHORT_ACCESS_UNAVAILABLE",
      status: 0,
      displayMessage: "동기방 가입 상태를 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
    });
  }
  const payload = await readJson(response);
  if (!response.ok) {
    const fallbackMessage = response.status === 403
      ? "동기방 이용 권한이 없거나 종료되었어요. 현재 가입 상태를 다시 확인해주세요."
      : "동기방 가입 상태를 확인하지 못했어요. 잠시 후 다시 시도해주세요.";
    const fields = serverErrorFields(
      payload,
      "COMMUNITY_COHORT_ACCESS_UNAVAILABLE",
      fallbackMessage,
    );
    throw new CommunityCohortAccessError({ ...fields, status: response.status });
  }
  return parseCurrentCohortAccess(payload, roomId);
}

export async function assignCurrentUserToCohort({
  apiFetchForExpectedUser,
  ownerId,
}) {
  if (typeof apiFetchForExpectedUser !== "function" || !isUuid(ownerId)) {
    throw new Error("COMMUNITY_COHORT_ASSIGN_REQUEST_INVALID");
  }
  const response = await apiFetchForExpectedUser(
    ownerId,
    "/api/community/cohort/auto-assign",
    { method: "POST" },
  );
  if (!response || typeof response.ok !== "boolean" || typeof response.json !== "function") {
    throw new CommunityCohortAccessError({
      code: "COMMUNITY_COHORT_ASSIGN_UNAVAILABLE",
      status: 0,
      displayMessage: "동기방을 배정하지 못했어요. 잠시 후 다시 시도해주세요.",
    });
  }
  const payload = await readJson(response);
  if (!response.ok) {
    const fields = serverErrorFields(
      payload,
      "COMMUNITY_COHORT_ASSIGN_UNAVAILABLE",
      "동기방을 배정하지 못했어요. 잠시 후 다시 시도해주세요.",
    );
    throw new CommunityCohortAccessError({ ...fields, status: response.status });
  }
  if (
    isRecord(payload)
    && payload.room_id === null
    && isSafeText(payload.reason, 80)
  ) {
    throw new CommunityCohortAccessError({
      code: "COMMUNITY_COHORT_NOT_ASSIGNED",
      status: response.status,
      displayMessage: "동기방을 배정하지 못했어요. 커뮤니티 이용 상태를 확인한 뒤 다시 시도해주세요.",
    });
  }
  if (
    !isRecord(payload)
    || !isUuid(payload.room_id)
    || !isSafeText(payload.reason, 80)
  ) {
    throw new Error("COMMUNITY_COHORT_ASSIGN_RESPONSE_INVALID");
  }
  return { roomId: payload.room_id.toLowerCase() };
}

export async function sendCohortMessage({
  apiFetchForExpectedUser,
  ownerId,
  roomId,
  content,
  threadTopic,
  idempotencyKey,
}) {
  const normalizedContent = typeof content === "string" ? content.trim() : "";
  if (
    typeof apiFetchForExpectedUser !== "function"
    || !isUuid(ownerId)
    || !isUuid(roomId)
    || normalizedContent.length < 1
    || Array.from(normalizedContent).length > 2_000
    || !(threadTopic === undefined || COHORT_MESSAGE_TOPICS.has(threadTopic))
    || !isUuid(idempotencyKey)
  ) {
    throw new Error("COMMUNITY_COHORT_MESSAGE_REQUEST_INVALID");
  }
  const requestBody = {
    content: normalizedContent,
    ...(threadTopic === undefined ? {} : { thread_topic: threadTopic }),
  };
  const response = await apiFetchForExpectedUser(
    ownerId,
    `/api/community/cohort/${roomId}/messages`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey.toLowerCase() },
      body: JSON.stringify(requestBody),
    },
  );
  if (!response || typeof response.ok !== "boolean" || typeof response.json !== "function") {
    throw new CommunityCohortAccessError({
      code: "COMMUNITY_COHORT_MESSAGE_UNAVAILABLE",
      status: 0,
      displayMessage: "메시지 전송 결과를 확인하지 못했어요. 입력한 내용은 유지했어요.",
    });
  }
  const payload = await readJson(response);
  if (!response.ok) {
    const fields = serverErrorFields(
      payload,
      "COMMUNITY_COHORT_MESSAGE_UNAVAILABLE",
      response.status === 429
        ? "요청이 너무 많아요. 잠시 후 다시 시도해주세요."
        : "메시지를 전송하지 못했어요. 입력한 내용은 유지했어요.",
    );
    throw new CommunityCohortAccessError({ ...fields, status: response.status });
  }
  const message = isRecord(payload) ? payload.message : null;
  if (
    !isRecord(message)
    || !isUuid(message.id)
    || !isUuid(message.room_id)
    || message.room_id.toLowerCase() !== roomId.toLowerCase()
    || !isUuid(message.author_id)
    || message.author_id.toLowerCase() !== ownerId.toLowerCase()
    || typeof message.content !== "string"
    || message.content.trim().length < 1
    || Array.from(message.content).length > 2_000
    || !(message.thread_topic === null || COHORT_MESSAGE_TOPICS.has(message.thread_topic))
    || typeof message.created_at !== "string"
    || !Number.isFinite(Date.parse(message.created_at))
  ) {
    throw new CommunityCohortAccessError({
      code: "COMMUNITY_COHORT_MESSAGE_RESPONSE_INVALID",
      status: response.status,
      displayMessage: "메시지 저장 결과를 확인하지 못했어요. 새로고침 후 확인해주세요.",
    });
  }
  return {
    id: message.id.toLowerCase(),
    roomId: message.room_id.toLowerCase(),
    authorId: message.author_id.toLowerCase(),
    content: message.content,
    topic: message.thread_topic,
    createdAt: message.created_at,
  };
}

function parseCohortMessageRow(message, roomId) {
  if (
    !isRecord(message)
    || !isUuid(message.id)
    || !isUuid(message.room_id)
    || message.room_id.toLowerCase() !== roomId.toLowerCase()
    || !(message.author_id === null || isUuid(message.author_id))
    || typeof message.content !== "string"
    || message.content.trim().length < 1
    || Array.from(message.content).length > 2_000
    || !(message.thread_topic === null || COHORT_MESSAGE_TOPICS.has(message.thread_topic))
    || typeof message.created_at !== "string"
    || !Number.isFinite(Date.parse(message.created_at))
  ) return null;
  const author = isRecord(message.author) ? message.author : null;
  return {
    id: message.id.toLowerCase(),
    roomId: message.room_id.toLowerCase(),
    authorId: message.author_id?.toLowerCase() ?? null,
    authorNickname: author && isSafeText(author.nickname, 80) ? author.nickname : null,
    content: message.content,
    topic: message.thread_topic,
    createdAt: message.created_at,
  };
}

export async function fetchCohortMessages({
  apiFetchForExpectedUser,
  ownerId,
  roomId,
}) {
  if (
    typeof apiFetchForExpectedUser !== "function"
    || !isUuid(ownerId)
    || !isUuid(roomId)
  ) throw new Error("COMMUNITY_COHORT_MESSAGES_REQUEST_INVALID");
  const response = await apiFetchForExpectedUser(
    ownerId,
    `/api/community/cohort/${roomId}/messages`,
    {},
  );
  if (!response || typeof response.ok !== "boolean" || typeof response.json !== "function") {
    throw new Error("COMMUNITY_COHORT_MESSAGES_UNAVAILABLE");
  }
  const payload = await readJson(response);
  if (!response.ok) {
    const fields = serverErrorFields(
      payload,
      "COMMUNITY_COHORT_MESSAGES_UNAVAILABLE",
      "동기방 메시지를 불러오지 못했어요.",
    );
    throw new CommunityCohortAccessError({ ...fields, status: response.status });
  }
  if (!isRecord(payload) || !Array.isArray(payload.messages) || payload.messages.length > 50) {
    throw new Error("COMMUNITY_COHORT_MESSAGES_RESPONSE_INVALID");
  }
  const messages = payload.messages.map((message) => parseCohortMessageRow(message, roomId));
  if (messages.some((message) => message === null)) {
    throw new Error("COMMUNITY_COHORT_MESSAGES_RESPONSE_INVALID");
  }
  return messages;
}
