export const AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONTRACT_VERSION = 1;
export const AMORA_PREPARATION_TOPIC_MESSAGE_REF_LIST_LIMIT = 80;
export const AMORA_PREPARATION_NOTES_PAGE_LIMIT = 24;
export const AMORA_PREPARATION_ACTION_RECEIPT_PAGE_LIMIT = 24;
export const AMORA_PREPARATION_SCHEDULE_DECISION_PAGE_LIMIT = 24;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
// 이 집합도 정본의 거울이 아니라 DB 화이트리스트의 거울이다 —
// supabase/migrations/20260816120000_amora_preparation_topic_message_refs.sql 의
// 24~28행 CHECK, 559~563행과 783~787행 함수 가드가 모두 열아홉 개다.
//
// 여기에 두 키를 넣으면 모바일 저장 대화상자(apps/mobile/app/(tabs)/chat.tsx)에
// **누를 때마다 400이 나는 항목 두 개**가 생긴다. 이 집합이 나가는 관문과 들어오는
// 검증을 동시에 맡고 있기 때문이다.
export const AMORA_PREPARATION_TOPIC_KEYS_THE_DATABASE_CANNOT_ACCEPT =
  Object.freeze(["greeting", "registration"]);
const TOPIC_KEYS = new Set([
  "meeting",
  "venue",
  "studio",
  "dress",
  "makeup",
  "ring",
  "hanbok",
  "yedan",
  "honeymoon",
  "houseware",
  "housing",
  "invitation",
  "snap",
  "shoes",
  "bouquet",
  "gift",
  "mc",
  "ham",
  "pyebaek",
]);
const AUDIENCES = new Set(["couple_shared", "owner_private"]);
const UNSAFE_INLINE_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const UNSAFE_MULTILINE_RE =
  /[\p{Cf}\p{Zl}\p{Zp}\u0000-\u0009\u000B-\u001F\u007F-\u009F]/u;
const NOTES_CURSOR_RE = /^np1\.[A-Za-z0-9_-]{16,512}$/u;
const ACTION_RECEIPT_CURSOR_RE = /^ap1\.[A-Za-z0-9_-]{16,512}$/u;
const ACTION_RECEIPT_V2_CURSOR_RE = /^ap2\.[A-Za-z0-9_-]{16,512}$/u;
const SCHEDULE_DECISION_CURSOR_RE = /^sd1\.[A-Za-z0-9_-]{16,512}$/u;
const ACTION_ID_RE = /^[0-9A-Za-z_-]{1,200}$/u;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.length
    && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function isIsoTime(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|([+-])(\d{2}):(\d{2}))$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  if (
    year < 1
    || month < 1
    || month > 12
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 23
    || offsetMinute > 59
  ) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day >= 1
    && day <= daysInMonth[month - 1]
    && Number.isFinite(Date.parse(value));
}

function isCalendarDate(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

function isSafeRevision(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveRevision(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function isSafeExcerpt(value) {
  return typeof value === "string"
    && value === value.trim()
    && Array.from(value).length >= 1
    && Array.from(value).length <= 320
    && !UNSAFE_INLINE_RE.test(value);
}

function isSafeContent(value) {
  return typeof value === "string"
    && value.trim().length >= 1
    && Array.from(value).length <= 20_000
    && !UNSAFE_MULTILINE_RE.test(value);
}

export function isAmoraPreparationTopicMessageRefTopicKey(value) {
  return typeof value === "string" && TOPIC_KEYS.has(value);
}

export function parseAmoraPreparationTopicMessageRefMutationRequest(value) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "topicKey",
      "messageId",
      "desiredState",
      "expectedRevision",
      "requestId",
    ])
    || !isAmoraPreparationTopicMessageRefTopicKey(value.topicKey)
    || !isUuid(value.messageId)
    || (value.desiredState !== "saved" && value.desiredState !== "removed")
    || !isSafeRevision(value.expectedRevision)
    || !isUuid(value.requestId)
  ) return null;
  return value;
}

function isCollectionReference(value) {
  return isRecord(value)
    && hasExactKeys(value, [
      "refId",
      "topicKey",
      "messageId",
      "audience",
      "revision",
      "savedAt",
      "sourceCreatedAt",
      "excerpt",
      "canRemove",
      "canOpenOriginal",
    ])
    && isUuid(value.refId)
    && TOPIC_KEYS.has(value.topicKey)
    && isUuid(value.messageId)
    && AUDIENCES.has(value.audience)
    && isPositiveRevision(value.revision)
    && isIsoTime(value.savedAt)
    && isIsoTime(value.sourceCreatedAt)
    && Date.parse(value.sourceCreatedAt) <= Date.parse(value.savedAt)
    && isSafeExcerpt(value.excerpt)
    && value.canRemove === true
    && value.canOpenOriginal === true;
}

export function validateAmoraPreparationTopicMessageRefCollectionResponse(
  value,
  expectedRecipientUserId,
  expectedCoupleId,
) {
  if (!isUuid(expectedRecipientUserId) || !isUuid(expectedCoupleId) || !isRecord(value)) {
    return { ok: false, reason: "invalid" };
  }
  if (value.version !== AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONTRACT_VERSION) {
    return { ok: false, reason: "version" };
  }
  if (value.recipientUserId !== expectedRecipientUserId) {
    return { ok: false, reason: "recipient" };
  }
  if (value.coupleId !== expectedCoupleId) {
    return { ok: false, reason: "couple" };
  }
  if (
    !hasExactKeys(value, [
      "version",
      "state",
      "recipientUserId",
      "coupleId",
      "references",
      "partial",
    ])
    || value.state !== "ready"
    || !Array.isArray(value.references)
    || value.references.length > AMORA_PREPARATION_TOPIC_MESSAGE_REF_LIST_LIMIT
    || value.references.some((reference) => !isCollectionReference(reference))
    || value.partial !== Boolean(value.partial)
  ) return { ok: false, reason: "collection" };

  const refIds = new Set();
  const topicMessages = new Set();
  for (const reference of value.references) {
    const refId = reference.refId.toLowerCase();
    const topicMessage = `${reference.topicKey}:${reference.messageId.toLowerCase()}`;
    if (refIds.has(refId) || topicMessages.has(topicMessage)) {
      return { ok: false, reason: "collection" };
    }
    refIds.add(refId);
    topicMessages.add(topicMessage);
  }
  return { ok: true, value };
}

function isPreparationNotesEntry(value, snapshotAt) {
  return isRecord(value)
    && hasExactKeys(value, [
      "refId",
      "topicKey",
      "messageId",
      "audience",
      "revision",
      "savedAt",
      "sourceCreatedAt",
      "questionExcerpt",
      "answerExcerpt",
      "canRemove",
      "canOpenOriginal",
    ])
    && isUuid(value.refId)
    && TOPIC_KEYS.has(value.topicKey)
    && isUuid(value.messageId)
    && AUDIENCES.has(value.audience)
    && isPositiveRevision(value.revision)
    && isIsoTime(value.savedAt)
    && Date.parse(value.savedAt) <= Date.parse(snapshotAt)
    && isIsoTime(value.sourceCreatedAt)
    && Date.parse(value.sourceCreatedAt) <= Date.parse(value.savedAt)
    && isSafeExcerpt(value.questionExcerpt)
    && isSafeExcerpt(value.answerExcerpt)
    && value.canRemove === true
    && value.canOpenOriginal === true;
}

export function validateAmoraPreparationNotesPageResponse(
  value,
  expectedRecipientUserId,
  expectedCoupleId,
) {
  const envelopeError = validateEnvelope(
    value,
    expectedRecipientUserId,
    expectedCoupleId,
  );
  if (envelopeError) return envelopeError;
  if (
    !hasExactKeys(value, [
      "version",
      "state",
      "recipientUserId",
      "coupleId",
      "snapshotAt",
      "entries",
      "nextCursor",
      "partial",
    ])
    || value.state !== "ready"
    || !isIsoTime(value.snapshotAt)
    || !Array.isArray(value.entries)
    || value.entries.length > AMORA_PREPARATION_NOTES_PAGE_LIMIT
    || value.entries.some((entry) => !isPreparationNotesEntry(entry, value.snapshotAt))
    || (value.nextCursor !== null && (
      typeof value.nextCursor !== "string" || !NOTES_CURSOR_RE.test(value.nextCursor)
    ))
    || typeof value.partial !== "boolean"
  ) return { ok: false, reason: "collection" };

  const refIds = new Set();
  const topicMessages = new Set();
  for (const entry of value.entries) {
    const refId = entry.refId.toLowerCase();
    const topicMessage = `${entry.topicKey}:${entry.messageId.toLowerCase()}`;
    if (refIds.has(refId) || topicMessages.has(topicMessage)) {
      return { ok: false, reason: "collection" };
    }
    refIds.add(refId);
    topicMessages.add(topicMessage);
  }
  return { ok: true, value };
}

function isPreparationActionReceiptEntry(value, snapshotAt) {
  return isRecord(value)
    && hasExactKeys(value, [
      "receiptMessageId",
      "actionId",
      "topicKey",
      "title",
      "displayMessage",
      "appliedAt",
      "scope",
      "canOpenAction",
    ])
    && isUuid(value.receiptMessageId)
    && typeof value.actionId === "string"
    && ACTION_ID_RE.test(value.actionId)
    && (value.topicKey === null || TOPIC_KEYS.has(value.topicKey))
    && isSafeExcerpt(value.title)
    && Array.from(value.title).length <= 120
    && isSafeExcerpt(value.displayMessage)
    && isIsoTime(value.appliedAt)
    && Date.parse(value.appliedAt) <= Date.parse(snapshotAt)
    && value.scope === "couple_shared"
    && value.canOpenAction === true;
}

function isApprovedFirstAction(value, expectedTitle) {
  return value === null || (
    isRecord(value)
    && hasExactKeys(value, ["action", "reason", "completionCriterion"])
    && value.action === expectedTitle
    && isSafeExcerpt(value.action)
    && Array.from(value.action).length <= 120
    && isSafeExcerpt(value.reason)
    && Array.from(value.reason).length <= 220
    && isSafeExcerpt(value.completionCriterion)
    && Array.from(value.completionCriterion).length <= 220
  );
}

function isPreparationActionReceiptV2Entry(value, snapshotAt) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "receiptMessageId",
      "actionId",
      "topicKey",
      "title",
      "displayMessage",
      "approvedFirstAction",
      "appliedAt",
      "scope",
      "canOpenAction",
    ])
  ) return false;
  const legacyShape = { ...value };
  delete legacyShape.approvedFirstAction;
  return isPreparationActionReceiptEntry(legacyShape, snapshotAt)
    && isApprovedFirstAction(value.approvedFirstAction, value.title);
}

export function validateAmoraPreparationActionReceiptPageResponse(
  value,
  expectedRecipientUserId,
  expectedCoupleId,
) {
  const envelopeError = validateEnvelope(
    value,
    expectedRecipientUserId,
    expectedCoupleId,
  );
  if (envelopeError) return envelopeError;
  if (
    !hasExactKeys(value, [
      "version",
      "state",
      "recipientUserId",
      "coupleId",
      "snapshotAt",
      "entries",
      "nextCursor",
      "partial",
    ])
    || value.state !== "ready"
    || !isIsoTime(value.snapshotAt)
    || !Array.isArray(value.entries)
    || value.entries.length > AMORA_PREPARATION_ACTION_RECEIPT_PAGE_LIMIT
    || value.entries.some((entry) => !isPreparationActionReceiptEntry(entry, value.snapshotAt))
    || (value.nextCursor !== null && (
      typeof value.nextCursor !== "string"
      || !ACTION_RECEIPT_CURSOR_RE.test(value.nextCursor)
    ))
    || typeof value.partial !== "boolean"
  ) return { ok: false, reason: "collection" };

  const receiptIds = new Set();
  const actionIds = new Set();
  for (const entry of value.entries) {
    const receiptId = entry.receiptMessageId.toLowerCase();
    if (receiptIds.has(receiptId) || actionIds.has(entry.actionId)) {
      return { ok: false, reason: "collection" };
    }
    receiptIds.add(receiptId);
    actionIds.add(entry.actionId);
  }
  return { ok: true, value };
}

export function validateAmoraPreparationActionReceiptV2PageResponse(
  value,
  expectedRecipientUserId,
  expectedCoupleId,
) {
  if (!isUuid(expectedRecipientUserId) || !isUuid(expectedCoupleId) || !isRecord(value)) {
    return { ok: false, reason: "invalid" };
  }
  if (value.version !== 2) return { ok: false, reason: "version" };
  if (value.recipientUserId !== expectedRecipientUserId) {
    return { ok: false, reason: "recipient" };
  }
  if (value.coupleId !== expectedCoupleId) return { ok: false, reason: "couple" };
  if (
    !hasExactKeys(value, [
      "version",
      "state",
      "recipientUserId",
      "coupleId",
      "snapshotAt",
      "entries",
      "nextCursor",
      "partial",
    ])
    || value.state !== "ready"
    || !isIsoTime(value.snapshotAt)
    || !Array.isArray(value.entries)
    || value.entries.length > AMORA_PREPARATION_ACTION_RECEIPT_PAGE_LIMIT
    || value.entries.some((entry) => !isPreparationActionReceiptV2Entry(entry, value.snapshotAt))
    || (value.nextCursor !== null && (
      typeof value.nextCursor !== "string"
      || !ACTION_RECEIPT_V2_CURSOR_RE.test(value.nextCursor)
    ))
    || typeof value.partial !== "boolean"
  ) return { ok: false, reason: "collection" };

  const receiptIds = new Set();
  const actionIds = new Set();
  for (const entry of value.entries) {
    const receiptId = entry.receiptMessageId.toLowerCase();
    if (receiptIds.has(receiptId) || actionIds.has(entry.actionId)) {
      return { ok: false, reason: "collection" };
    }
    receiptIds.add(receiptId);
    actionIds.add(entry.actionId);
  }
  return { ok: true, value };
}

function isPreparationScheduleDecisionEntry(value, snapshotAt) {
  return isRecord(value)
    && hasExactKeys(value, [
      "decisionId",
      "eventId",
      "topicKey",
      "title",
      "date",
      "confirmedAt",
      "scope",
      "canOpenSchedule",
    ])
    && isUuid(value.decisionId)
    && typeof value.eventId === "string"
    && ACTION_ID_RE.test(value.eventId)
    && TOPIC_KEYS.has(value.topicKey)
    && isSafeExcerpt(value.title)
    && Array.from(value.title).length <= 160
    && isCalendarDate(value.date)
    && isIsoTime(value.confirmedAt)
    && Date.parse(value.confirmedAt) <= Date.parse(snapshotAt)
    && value.scope === "couple_shared"
    && value.canOpenSchedule === true;
}

export function validateAmoraPreparationScheduleDecisionPageResponse(
  value,
  expectedRecipientUserId,
  expectedCoupleId,
) {
  const envelopeError = validateEnvelope(
    value,
    expectedRecipientUserId,
    expectedCoupleId,
  );
  if (envelopeError) return envelopeError;
  if (
    !hasExactKeys(value, [
      "version",
      "state",
      "recipientUserId",
      "coupleId",
      "snapshotAt",
      "currentJourneyRevision",
      "entries",
      "nextCursor",
      "partial",
    ])
    || value.state !== "ready"
    || !isIsoTime(value.snapshotAt)
    || !isSafeRevision(value.currentJourneyRevision)
    || !Array.isArray(value.entries)
    || value.entries.length > AMORA_PREPARATION_SCHEDULE_DECISION_PAGE_LIMIT
    || value.entries.some((entry) => (
      !isPreparationScheduleDecisionEntry(entry, value.snapshotAt)
    ))
    || (value.nextCursor !== null && (
      typeof value.nextCursor !== "string"
      || !SCHEDULE_DECISION_CURSOR_RE.test(value.nextCursor)
    ))
    || typeof value.partial !== "boolean"
  ) return { ok: false, reason: "collection" };

  const decisionIds = new Set();
  const eventIds = new Set();
  for (const entry of value.entries) {
    const decisionId = entry.decisionId.toLowerCase();
    if (decisionIds.has(decisionId) || eventIds.has(entry.eventId)) {
      return { ok: false, reason: "collection" };
    }
    decisionIds.add(decisionId);
    eventIds.add(entry.eventId);
  }
  return { ok: true, value };
}

function validateEnvelope(value, expectedRecipientUserId, expectedCoupleId) {
  if (!isUuid(expectedRecipientUserId) || !isUuid(expectedCoupleId) || !isRecord(value)) {
    return { ok: false, reason: "invalid" };
  }
  if (value.version !== AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONTRACT_VERSION) {
    return { ok: false, reason: "version" };
  }
  if (value.recipientUserId !== expectedRecipientUserId) {
    return { ok: false, reason: "recipient" };
  }
  if (value.coupleId !== expectedCoupleId) {
    return { ok: false, reason: "couple" };
  }
  return null;
}

function isStateReference(value, expectedTopicKey, expectedMessageId) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "topicKey",
      "messageId",
      "refId",
      "audience",
      "savedState",
      "revision",
    ])
    || value.topicKey !== expectedTopicKey
    || value.messageId !== expectedMessageId
    || !AUDIENCES.has(value.audience)
    || !isSafeRevision(value.revision)
  ) return false;
  if (value.savedState === "saved") {
    return isUuid(value.refId) && isPositiveRevision(value.revision);
  }
  return value.savedState === "removed" && value.refId === null;
}

export function validateAmoraPreparationTopicMessageRefStateResponse(
  value,
  expectedRecipientUserId,
  expectedCoupleId,
  expectedTopicKey,
  expectedMessageId,
) {
  const envelopeError = validateEnvelope(
    value,
    expectedRecipientUserId,
    expectedCoupleId,
  );
  if (envelopeError) return envelopeError;
  if (
    !isAmoraPreparationTopicMessageRefTopicKey(expectedTopicKey)
    || !isUuid(expectedMessageId)
    || !hasExactKeys(value, [
      "version",
      "state",
      "recipientUserId",
      "coupleId",
      "reference",
    ])
    || value.state !== "ready"
    || !isStateReference(value.reference, expectedTopicKey, expectedMessageId)
  ) return { ok: false, reason: "reference" };
  return { ok: true, value };
}

export function validateAmoraPreparationTopicMessageRefMutationResponse(
  value,
  expectedRecipientUserId,
  expectedCoupleId,
  expectedTopicKey,
  expectedMessageId,
  expectedDesiredState,
) {
  const envelopeError = validateEnvelope(
    value,
    expectedRecipientUserId,
    expectedCoupleId,
  );
  if (envelopeError) return envelopeError;
  if (
    !isAmoraPreparationTopicMessageRefTopicKey(expectedTopicKey)
    || !isUuid(expectedMessageId)
    || (expectedDesiredState !== "saved" && expectedDesiredState !== "removed")
    || !hasExactKeys(value, [
      "version",
      "state",
      "recipientUserId",
      "coupleId",
      "reference",
      "reused",
    ])
    || value.state !== "ready"
    || !isStateReference(value.reference, expectedTopicKey, expectedMessageId)
    || value.reference.savedState !== expectedDesiredState
    || typeof value.reused !== "boolean"
  ) return { ok: false, reason: "reference" };
  return { ok: true, value };
}

function isResolvedTarget(value, reference) {
  const expectedLane = reference.audience === "couple_shared" ? "shared" : "private";
  return isRecord(value)
    && hasExactKeys(value, ["messageId", "lane", "content", "createdAt"])
    && value.messageId === reference.messageId
    && value.lane === expectedLane
    && isSafeContent(value.content)
    && isIsoTime(value.createdAt)
    && Date.parse(value.createdAt) <= Date.parse(reference.savedAt);
}

function isResolvedQuestion(value, reference, target) {
  if (value === null) return true;
  const expectedLane = reference.audience === "couple_shared" ? "shared" : "private";
  return isRecord(value)
    && hasExactKeys(value, [
      "messageId",
      "lane",
      "senderType",
      "content",
      "createdAt",
    ])
    && isUuid(value.messageId)
    && value.messageId !== target.messageId
    && value.lane === expectedLane
    && (value.senderType === "bride" || value.senderType === "groom")
    && isSafeContent(value.content)
    && isIsoTime(value.createdAt)
    && Date.parse(value.createdAt) <= Date.parse(target.createdAt);
}

export function validateAmoraPreparationTopicMessageRefResolveResponse(
  value,
  expectedRecipientUserId,
  expectedCoupleId,
  expectedRefId,
) {
  const envelopeError = validateEnvelope(
    value,
    expectedRecipientUserId,
    expectedCoupleId,
  );
  if (envelopeError) return envelopeError;
  if (
    !isUuid(expectedRefId)
    || !hasExactKeys(value, [
      "version",
      "state",
      "recipientUserId",
      "coupleId",
      "reference",
      "target",
      "question",
    ])
    || value.state !== "ready"
    || !isRecord(value.reference)
    || !hasExactKeys(value.reference, [
      "refId",
      "topicKey",
      "messageId",
      "audience",
      "revision",
      "savedAt",
    ])
    || value.reference.refId !== expectedRefId
    || !isAmoraPreparationTopicMessageRefTopicKey(value.reference.topicKey)
    || !isUuid(value.reference.messageId)
    || !AUDIENCES.has(value.reference.audience)
    || !isPositiveRevision(value.reference.revision)
    || !isIsoTime(value.reference.savedAt)
    || !isResolvedTarget(value.target, value.reference)
    || !isResolvedQuestion(value.question, value.reference, value.target)
  ) return { ok: false, reason: "reference" };
  return { ok: true, value };
}
