const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const THREAD_STATES = new Set([
  "open",
  "answered",
  "resolved",
  "followup_scheduled",
  "completed",
  "closed",
]);
const EXPERIENCE_SCOPES = new Set([
  "contract_terms",
  "extra_charge",
  "vendor_response",
  "cancellation_refund",
]);
const PREPARATION_STAGES = new Set([
  "vendor_search",
  "contract_review",
  "contracted",
  "dispute_or_cancellation",
]);
const CONTRACT_PHASES = new Set([
  "before_contract",
  "after_contract",
  "cancellation_or_refund",
]);
const CONTENT_ORIGINS = new Set([
  "member",
  "industry_professional",
  "vendor_official",
  "operator",
  "ai",
  "legacy_unverified",
]);
const COMMERCIAL_RELATIONSHIPS = new Set([
  "none",
  "gift",
  "discount",
  "refund",
  "affiliate",
  "paid",
  "employee",
  "owner_or_family",
  "platform_research_compensation",
]);
const APPLICABILITY_VALUES = new Set([
  "applies",
  "conditions_differ",
  "need_more_info",
  "taken_as_next_action",
]);
const MUTATION_OPERATIONS = new Set([
  "answer",
  "applicability",
  "resolve",
  "outcome",
  "withdraw",
  "publication_withdraw",
]);
const EXPERIENCE_PERIODS = new Set([
  "within_3_months",
  "within_6_months",
  "within_12_months",
  "over_12_months",
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactObjectKeys(value, expectedKeys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isTrimmedBoundedText(value, minimum, maximum) {
  return typeof value === "string"
    && value === value.trim()
    && value.length >= minimum
    && value.length <= maximum;
}

function isNullableTrimmedBoundedText(value, minimum, maximum) {
  return value === null || isTrimmedBoundedText(value, minimum, maximum);
}

export function isCommunityDecisionUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * The create endpoint has two intentionally different success classes:
 * 202 means the question is still private, while 200/201 proves publication.
 * Keep this parser strict so an unexpected or partial response can never be
 * rendered as a published thread.
 */
export function parseCommunityDecisionCreateReceipt(value, httpStatus) {
  if (!isRecord(value) || typeof value.replayed !== "boolean") return null;
  if (!isCommunityDecisionUuid(value.questionId)) return null;
  if (!isCommunityDecisionUuid(value.commandId)) return null;
  if (!isCommunityDecisionUuid(value.operationKey)) return null;

  if (httpStatus === 202 && value.status === "private_waitlist") {
    return {
      kind: "private_waitlist",
      questionId: value.questionId,
      commandId: value.commandId,
      operationKey: value.operationKey,
      replayed: value.replayed,
    };
  }

  if (
    (httpStatus === 200 || httpStatus === 201)
    && value.status === "published"
    && isCommunityDecisionUuid(value.threadId)
    && isCommunityDecisionUuid(value.postId)
    && value.publicationVersion === 1
    && THREAD_STATES.has(value.currentState)
    && Number.isSafeInteger(value.currentVersion)
    && value.currentVersion >= 1
    && ((httpStatus === 200 && value.replayed === true)
      || (httpStatus === 201 && value.replayed === false))
  ) {
    return {
      kind: "published",
      questionId: value.questionId,
      commandId: value.commandId,
      operationKey: value.operationKey,
      threadId: value.threadId,
      postId: value.postId,
      publicationVersion: 1,
      currentState: value.currentState,
      currentVersion: value.currentVersion,
      replayed: value.replayed,
    };
  }

  return null;
}

/** Bind a structurally valid receipt to the exact durable pending command. */
export function isCommunityDecisionCreateReceiptForSubmission(
  receipt,
  expectedQuestionId,
  expectedOperationKey,
  expectedCommandId,
) {
  return Boolean(receipt)
    && isCommunityDecisionUuid(expectedQuestionId)
    && receipt.questionId === expectedQuestionId
    && isCommunityDecisionUuid(expectedOperationKey)
    && receipt.operationKey === expectedOperationKey
    && (expectedCommandId === null
      || (isCommunityDecisionUuid(expectedCommandId)
        && receipt.commandId === expectedCommandId));
}

export function readCommunityDecisionApiError(value, fallback) {
  if (!isRecord(value)) return fallback;
  return typeof value.error === "string" && value.error.trim().length > 0
    ? value.error.trim()
    : fallback;
}

export function parseRetryAfterSeconds(value) {
  if (typeof value !== "string" || !/^\d+$/u.test(value.trim())) return null;
  const seconds = Number(value.trim());
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 86_400
    ? seconds
    : null;
}

export function parseCommunityDecisionWithdrawReceipt(value) {
  if (
    !isRecord(value)
    || value.status !== "withdrawn"
    || !isCommunityDecisionUuid(value.questionId)
    || !isCommunityDecisionUuid(value.commandId)
    || !isCommunityDecisionUuid(value.operationKey)
    || typeof value.replayed !== "boolean"
  ) return null;
  const isWaitlistReceipt = value.threadId === null
    && value.state === null
    && value.version === null
    && value.sourceUnavailableAt === null;
  const isPublishedReceipt = isCommunityDecisionUuid(value.threadId)
    && THREAD_STATES.has(value.state)
    && Number.isSafeInteger(value.version)
    && value.version >= 1
    && isDateString(value.sourceUnavailableAt);
  if (!isWaitlistReceipt && !isPublishedReceipt) return null;
  return {
    status: "withdrawn",
    questionId: value.questionId,
    threadId: value.threadId,
    state: value.state,
    version: value.version,
    sourceUnavailableAt: value.sourceUnavailableAt,
    commandId: value.commandId,
    operationKey: value.operationKey,
    replayed: value.replayed,
  };
}

/**
 * The author-facing publication withdrawal route deliberately returns only a
 * target receipt. The route echoes the bound Idempotency-Key, and the client
 * verifies that key plus every returned target field before clearing its
 * encrypted retry command.
 */
export function parseCommunityDecisionPublicationWithdrawReceipt(value) {
  if (
    !hasExactObjectKeys(value, [
      "status",
      "threadId",
      "outcomeId",
      "operationKey",
      "revision",
      "withdrawnAt",
      "replayed",
    ])
    || value.status !== "withdrawn"
    || !isCommunityDecisionUuid(value.threadId)
    || !isCommunityDecisionUuid(value.outcomeId)
    || !isCommunityDecisionUuid(value.operationKey)
    || !Number.isSafeInteger(value.revision)
    || value.revision < 1
    || !isDateString(value.withdrawnAt)
    || typeof value.replayed !== "boolean"
  ) return null;
  return {
    status: "withdrawn",
    threadId: value.threadId,
    outcomeId: value.outcomeId,
    operationKey: value.operationKey,
    revision: value.revision,
    withdrawnAt: value.withdrawnAt,
    replayed: value.replayed,
  };
}

/** Parse the owner-only publication state without accepting canonical outcome text. */
export function parseCommunityDecisionPublicationStatus(value) {
  if (
    !hasExactObjectKeys(value, [
      "outcomeId",
      "threadId",
      "revision",
      "publicationState",
      "canWithdraw",
      "updatedAt",
    ])
    || !isCommunityDecisionUuid(value.outcomeId)
    || !isCommunityDecisionUuid(value.threadId)
    || !Number.isSafeInteger(value.revision)
    || value.revision < 1
    || !new Set([
      "pending_review",
      "published",
      "rejected",
      "withdrawn",
    ]).has(value.publicationState)
    || typeof value.canWithdraw !== "boolean"
    || value.canWithdraw !== (
      value.publicationState === "pending_review"
      || value.publicationState === "published"
    )
    || !isDateString(value.updatedAt)
  ) return null;
  return {
    outcomeId: value.outcomeId,
    threadId: value.threadId,
    revision: value.revision,
    publicationState: value.publicationState,
    canWithdraw: value.canWithdraw,
    updatedAt: value.updatedAt,
  };
}

function parseMutationCommon(value, expectedStatus) {
  if (
    !isRecord(value)
    || value.status !== expectedStatus
    || !isCommunityDecisionUuid(value.threadId)
    || !THREAD_STATES.has(value.state)
    || !Number.isSafeInteger(value.version)
    || value.version < 1
    || !isCommunityDecisionUuid(value.commandId)
    || !isCommunityDecisionUuid(value.operationKey)
    || typeof value.replayed !== "boolean"
  ) return null;
  return value;
}

export function parseCommunityDecisionMutationReceipt(value, operation) {
  if (operation === "answer") {
    const common = parseMutationCommon(value, "answered");
    if (
      !common
      || !isCommunityDecisionUuid(common.answerId)
      || !isCommunityDecisionUuid(common.commentId)
      || !Number.isSafeInteger(common.qualifiedPeerAnswerCount)
      || common.qualifiedPeerAnswerCount < 0
      || !Number.isSafeInteger(common.qualifiedProfessionalAnswerCount)
      || common.qualifiedProfessionalAnswerCount < 0
    ) return null;
    return {
      operation,
      status: common.status,
      answerId: common.answerId,
      commentId: common.commentId,
      threadId: common.threadId,
      state: common.state,
      version: common.version,
      qualifiedPeerAnswerCount: common.qualifiedPeerAnswerCount,
      qualifiedProfessionalAnswerCount: common.qualifiedProfessionalAnswerCount,
      commandId: common.commandId,
      operationKey: common.operationKey,
      replayed: common.replayed,
    };
  }
  if (operation === "applicability") {
    const common = parseMutationCommon(value, "applicability_recorded");
    if (
      !common
      || !isCommunityDecisionUuid(common.selectionId)
      || !isCommunityDecisionUuid(common.answerId)
      || !APPLICABILITY_VALUES.has(common.applicability)
    ) return null;
    return {
      operation,
      status: common.status,
      threadId: common.threadId,
      state: common.state,
      version: common.version,
      selectionId: common.selectionId,
      answerId: common.answerId,
      applicability: common.applicability,
      commandId: common.commandId,
      operationKey: common.operationKey,
      replayed: common.replayed,
    };
  }
  if (operation === "resolve") {
    const common = parseMutationCommon(value, "resolved");
    if (
      !common
      || common.state !== "resolved"
      || typeof common.nextAction !== "string"
      || !Array.isArray(common.answerIds)
      || common.answerIds.length < 1
      || common.answerIds.some((answerId) => !isCommunityDecisionUuid(answerId))
      || new Set(common.answerIds).size !== common.answerIds.length
      || !Array.isArray(common.selectionIds)
      || common.selectionIds.length !== common.answerIds.length
      || common.selectionIds.some((selectionId) => !isCommunityDecisionUuid(selectionId))
      || new Set(common.selectionIds).size !== common.selectionIds.length
    ) return null;
    return {
      operation,
      status: common.status,
      threadId: common.threadId,
      state: common.state,
      version: common.version,
      nextAction: common.nextAction,
      answerIds: common.answerIds,
      selectionIds: common.selectionIds,
      commandId: common.commandId,
      operationKey: common.operationKey,
      replayed: common.replayed,
    };
  }
  if (operation === "outcome") {
    const common = parseMutationCommon(value, "completed");
    if (
      !common
      || common.state !== "completed"
      || !isCommunityDecisionUuid(common.outcomeId)
      || !Number.isSafeInteger(common.revision)
      || common.revision < 1
    ) return null;
    return {
      operation,
      status: common.status,
      threadId: common.threadId,
      state: common.state,
      version: common.version,
      outcomeId: common.outcomeId,
      revision: common.revision,
      commandId: common.commandId,
      operationKey: common.operationKey,
      replayed: common.replayed,
    };
  }
  return null;
}

export function parseCommunityDecisionStaleReceipt(value) {
  if (
    !isRecord(value)
    || value.status !== "stale"
    || !isCommunityDecisionUuid(value.threadId)
    || !THREAD_STATES.has(value.state)
    || !Number.isSafeInteger(value.currentVersion)
    || value.currentVersion < 1
    || !isCommunityDecisionUuid(value.commandId)
    || !isCommunityDecisionUuid(value.operationKey)
    || typeof value.replayed !== "boolean"
  ) return null;
  return {
    status: "stale",
    threadId: value.threadId,
    state: value.state,
    currentVersion: value.currentVersion,
    commandId: value.commandId,
    operationKey: value.operationKey,
    replayed: value.replayed,
  };
}

/** Bind any parsed command receipt to the exact persisted operation key. */
export function isCommunityDecisionReceiptForCommand(receipt, expectedCommandId) {
  return isRecord(receipt)
    && isCommunityDecisionUuid(expectedCommandId)
    && receipt.operationKey === expectedCommandId;
}

const MUTATION_PENDING_KEYS = [
  "ownerId",
  "questionId",
  "slot",
  "operation",
  "operationKey",
  "bodyText",
  "createdAt",
];

function isPositiveVersion(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isValidAnswerMutationBody(body) {
  const keys = [
    "content",
    "responseKind",
    "directExperience",
    "experiencePeriod",
    "experienceStage",
    "coarseRegion",
    "actionTaken",
    "resultSummary",
    "nextCheck",
    "factOpinionBoundary",
    "commercialRelationship",
    "sponsorshipDetail",
  ];
  if (!hasExactObjectKeys(body, keys)) return false;
  const evidence = [body.actionTaken, body.resultSummary, body.nextCheck];
  return isTrimmedBoundedText(body.content, 10, 5_000)
    && new Set(["answer", "experience"]).has(body.responseKind)
    && body.directExperience === true
    && EXPERIENCE_PERIODS.has(body.experiencePeriod)
    && PREPARATION_STAGES.has(body.experienceStage)
    && isNullableTrimmedBoundedText(body.coarseRegion, 2, 40)
    && isNullableTrimmedBoundedText(body.actionTaken, 3, 2_000)
    && isNullableTrimmedBoundedText(body.resultSummary, 3, 3_000)
    && isNullableTrimmedBoundedText(body.nextCheck, 3, 2_000)
    && evidence.some((value) => value !== null)
    && isTrimmedBoundedText(body.factOpinionBoundary, 3, 500)
    && hasValidCommercialDisclosure(
      body.commercialRelationship,
      body.sponsorshipDetail,
    );
}

function isValidMutationBody(operation, slot, body) {
  if (operation === "answer") {
    return slot === "answer" && isValidAnswerMutationBody(body);
  }
  if (operation === "applicability") {
    return hasExactObjectKeys(body, ["expectedVersion", "answerId", "applicability"])
      && isPositiveVersion(body.expectedVersion)
      && isCommunityDecisionUuid(body.answerId)
      && APPLICABILITY_VALUES.has(body.applicability)
      && slot === `applicability:${body.answerId}`;
  }
  if (operation === "resolve") {
    return hasExactObjectKeys(body, ["expectedVersion", "answerIds", "nextAction", "reason"])
      && slot === "resolve"
      && isPositiveVersion(body.expectedVersion)
      && Array.isArray(body.answerIds)
      && body.answerIds.length >= 1
      && body.answerIds.length <= 10
      && body.answerIds.every(isCommunityDecisionUuid)
      && new Set(body.answerIds).size === body.answerIds.length
      && isTrimmedBoundedText(body.nextAction, 3, 1_000)
      && isTrimmedBoundedText(body.reason, 3, 500);
  }
  if (operation === "outcome") {
    return hasExactObjectKeys(body, [
      "expectedVersion",
      "currentOutcomeId",
      "actionTaken",
      "resultSummary",
      "applicableConditions",
      "publicConsent",
      "commercialRelationship",
      "sponsorshipDetail",
    ])
      && slot === "outcome"
      && isPositiveVersion(body.expectedVersion)
      && (body.currentOutcomeId === null
        || isCommunityDecisionUuid(body.currentOutcomeId))
      && isTrimmedBoundedText(body.actionTaken, 3, 2_000)
      && isTrimmedBoundedText(body.resultSummary, 3, 3_000)
      && isTrimmedBoundedText(body.applicableConditions, 3, 2_000)
      && typeof body.publicConsent === "boolean"
      && hasValidCommercialDisclosure(
        body.commercialRelationship,
        body.sponsorshipDetail,
      );
  }
  if (operation === "withdraw") {
    return hasExactObjectKeys(body, ["expectedVersion", "reason"])
      && slot === "withdraw"
      && (body.expectedVersion === null || isPositiveVersion(body.expectedVersion))
      && isTrimmedBoundedText(body.reason, 3, 500);
  }
  if (operation === "publication_withdraw") {
    const outcomeId = slot.startsWith("publication_withdraw:")
      ? slot.slice("publication_withdraw:".length)
      : "";
    return hasExactObjectKeys(body, [])
      && isCommunityDecisionUuid(outcomeId)
      && slot === `publication_withdraw:${outcomeId}`;
  }
  return false;
}

/** Validate an encrypted, byte-replayable detail mutation command. */
export function parseCommunityDecisionMutationPending(
  value,
  expectedOwnerId,
  expectedQuestionId,
  now = Date.now(),
) {
  if (
    !hasExactObjectKeys(value, MUTATION_PENDING_KEYS)
    || !isCommunityDecisionUuid(expectedOwnerId)
    || !isCommunityDecisionUuid(expectedQuestionId)
    || !isCommunityDecisionUuid(value.ownerId)
    || value.ownerId.toLowerCase() !== expectedOwnerId.toLowerCase()
    || !isCommunityDecisionUuid(value.questionId)
    || value.questionId.toLowerCase() !== expectedQuestionId.toLowerCase()
    || typeof value.slot !== "string"
    || value.slot.length < 1
    || value.slot.length > 64
    || !MUTATION_OPERATIONS.has(value.operation)
    || !isCommunityDecisionUuid(value.operationKey)
    || typeof value.bodyText !== "string"
    || value.bodyText.length < 2
    || value.bodyText.length > 20_000
    || !Number.isSafeInteger(value.createdAt)
    || value.createdAt < 0
    || value.createdAt > now + 5 * 60 * 1_000
    || now - value.createdAt > 24 * 60 * 60 * 1_000
  ) return null;
  try {
    const body = JSON.parse(value.bodyText);
    if (!isRecord(body) || !isValidMutationBody(value.operation, value.slot, body)) {
      return null;
    }
  } catch {
    return null;
  }
  return {
    ownerId: value.ownerId,
    questionId: value.questionId,
    slot: value.slot,
    operation: value.operation,
    operationKey: value.operationKey,
    bodyText: value.bodyText,
    createdAt: value.createdAt,
  };
}

/**
 * Generic post responses do not expose this field in P0. This helper exists so
 * a future additive contract can only open the bridge after the API returns an
 * actual UUID; clients must never derive a thread id from the post id.
 */
export function readDecisionThreadIdFromPost(value) {
  if (!isRecord(value)) return null;
  return isCommunityDecisionUuid(value.decisionThreadId)
    ? value.decisionThreadId
    : null;
}

function isNullableString(value) {
  return value === null || typeof value === "string";
}

function hasValidCommercialDisclosure(relationship, detail) {
  if (!COMMERCIAL_RELATIONSHIPS.has(relationship)) return false;
  if (relationship === "none") return detail === null;
  return typeof detail === "string"
    && detail.trim().length >= 3
    && detail.trim().length <= 500;
}

function isDateString(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNullableDateString(value) {
  return value === null || isDateString(value);
}

function parseAuthor(value) {
  if (!isRecord(value)) return null;
  if (typeof value.nickname !== "string" || typeof value.badge !== "string") return null;
  return { nickname: value.nickname, badge: value.badge };
}

function parseThread(value) {
  if (!isRecord(value)) return null;
  if (
    !isCommunityDecisionUuid(value.id)
    || !isCommunityDecisionUuid(value.postId)
    || !THREAD_STATES.has(value.state)
    || !Number.isSafeInteger(value.version)
    || value.version < 1
    || value.kind !== "experience_question"
    || value.topicCategory !== "contract_extra_cost"
    || !EXPERIENCE_SCOPES.has(value.experienceScope)
    || !isNullableString(value.coarseRegion)
    || !PREPARATION_STAGES.has(value.preparationStage)
    || !CONTRACT_PHASES.has(value.contractPhase)
    || typeof value.desiredAnswer !== "string"
    || !Number.isSafeInteger(value.qualifiedPeerAnswerCount)
    || value.qualifiedPeerAnswerCount < 0
    || !Number.isSafeInteger(value.qualifiedProfessionalAnswerCount)
    || value.qualifiedProfessionalAnswerCount < 0
    || !isNullableString(value.nextAction)
    || !isNullableDateString(value.resolvedAt)
    || !isNullableDateString(value.completedAt)
    || !isNullableDateString(value.sourceUnavailableAt)
    || typeof value.newApplicationsAllowed !== "boolean"
    || ((value.sourceUnavailableAt === null)
      !== value.newApplicationsAllowed)
    || !isDateString(value.createdAt)
  ) return null;
  return {
    id: value.id,
    postId: value.postId,
    state: value.state,
    version: value.version,
    kind: value.kind,
    topicCategory: value.topicCategory,
    experienceScope: value.experienceScope,
    coarseRegion: value.coarseRegion,
    preparationStage: value.preparationStage,
    contractPhase: value.contractPhase,
    desiredAnswer: value.desiredAnswer,
    qualifiedPeerAnswerCount: value.qualifiedPeerAnswerCount,
    qualifiedProfessionalAnswerCount: value.qualifiedProfessionalAnswerCount,
    nextAction: value.nextAction,
    resolvedAt: value.resolvedAt,
    completedAt: value.completedAt,
    sourceUnavailableAt: value.sourceUnavailableAt,
    newApplicationsAllowed: value.newApplicationsAllowed,
    createdAt: value.createdAt,
  };
}

function parsePost(value) {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const author = value.author === null ? null : parseAuthor(value.author);
  if (
    typeof value.title !== "string"
    || typeof value.content !== "string"
    || !CONTENT_ORIGINS.has(value.contentOrigin)
    || !hasValidCommercialDisclosure(
      value.commercialRelationship,
      value.sponsorshipDetail,
    )
    || !new Set(["draft", "published", "failed", "withdrawn"]).has(value.publicationState)
    || (value.author !== null && !author)
    || !isDateString(value.createdAt)
  ) return undefined;
  return {
    title: value.title,
    content: value.content,
    contentOrigin: value.contentOrigin,
    commercialRelationship: value.commercialRelationship,
    sponsorshipDetail: value.sponsorshipDetail,
    publicationState: value.publicationState,
    author,
    createdAt: value.createdAt,
  };
}

function parseAnswer(value) {
  if (!isRecord(value)) return null;
  const author = parseAuthor(value.author);
  const hasStructuredEvidence = [
    value.actionTaken,
    value.resultSummary,
    value.nextCheck,
  ].some((item) => typeof item === "string" && item.trim().length > 0);
  if (
    !isCommunityDecisionUuid(value.id)
    || !isCommunityDecisionUuid(value.commentId)
    || typeof value.content !== "string"
    || !new Set(["answer", "experience"]).has(value.responseKind)
    || !new Set(["member", "industry_professional"]).has(value.contentOrigin)
    || value.directExperience !== true
    || !new Set([
      "within_3_months",
      "within_6_months",
      "within_12_months",
      "over_12_months",
    ]).has(value.experiencePeriod)
    || !PREPARATION_STAGES.has(value.experienceStage)
    || !isNullableString(value.coarseRegion)
    || !isNullableString(value.actionTaken)
    || !isNullableString(value.resultSummary)
    || !isNullableString(value.nextCheck)
    || !hasStructuredEvidence
    || typeof value.factOpinionBoundary !== "string"
    || !hasValidCommercialDisclosure(
      value.commercialRelationship,
      value.sponsorshipDetail,
    )
    || value.rubricVersion !== 1
    || !author
    || !isDateString(value.createdAt)
  ) return null;
  return {
    id: value.id,
    commentId: value.commentId,
    content: value.content,
    responseKind: value.responseKind,
    contentOrigin: value.contentOrigin,
    directExperience: true,
    experiencePeriod: value.experiencePeriod,
    experienceStage: value.experienceStage,
    coarseRegion: value.coarseRegion,
    actionTaken: value.actionTaken,
    resultSummary: value.resultSummary,
    nextCheck: value.nextCheck,
    factOpinionBoundary: value.factOpinionBoundary,
    commercialRelationship: value.commercialRelationship,
    sponsorshipDetail: value.sponsorshipDetail,
    rubricVersion: 1,
    author,
    createdAt: value.createdAt,
  };
}

function parseSelection(value) {
  if (!isRecord(value)) return null;
  if (
    !isCommunityDecisionUuid(value.id)
    || !isCommunityDecisionUuid(value.answerId)
    || !isCommunityDecisionUuid(value.commentId)
    || !APPLICABILITY_VALUES.has(value.applicability)
    || !isDateString(value.selectedAt)
    || !isNullableDateString(value.includedInResolutionAt)
  ) return null;
  return {
    id: value.id,
    answerId: value.answerId,
    commentId: value.commentId,
    applicability: value.applicability,
    selectedAt: value.selectedAt,
    includedInResolutionAt: value.includedInResolutionAt,
  };
}

function parseOutcome(value) {
  if (!isRecord(value)) return null;
  if (
    !isCommunityDecisionUuid(value.id)
    || !Number.isSafeInteger(value.revision)
    || value.revision < 1
    || !(value.supersedesOutcomeId === null || isCommunityDecisionUuid(value.supersedesOutcomeId))
    || typeof value.actionTaken !== "string"
    || typeof value.resultSummary !== "string"
    || typeof value.applicableConditions !== "string"
    || typeof value.publicConsent !== "boolean"
    || !hasValidCommercialDisclosure(
      value.commercialRelationship,
      value.sponsorshipDetail,
    )
    || !isDateString(value.createdAt)
  ) return null;
  return {
    id: value.id,
    revision: value.revision,
    supersedesOutcomeId: value.supersedesOutcomeId,
    actionTaken: value.actionTaken,
    resultSummary: value.resultSummary,
    applicableConditions: value.applicableConditions,
    publicConsent: value.publicConsent,
    commercialRelationship: value.commercialRelationship,
    sponsorshipDetail: value.sponsorshipDetail,
    createdAt: value.createdAt,
  };
}

/** Parse the authenticated, private-no-store DecisionThread read model. */
export function parseCommunityDecisionDetail(value) {
  if (!isRecord(value) || !isRecord(value.viewer)) return null;
  if (value.status === "private_waitlist") {
    const intake = value.intake;
    if (
      !isRecord(intake)
      || !isCommunityDecisionUuid(intake.questionId)
      || typeof intake.title !== "string"
      || typeof intake.content !== "string"
      || intake.topicCategory !== "contract_extra_cost"
      || !EXPERIENCE_SCOPES.has(intake.experienceScope)
      || !isNullableString(intake.coarseRegion)
      || !PREPARATION_STAGES.has(intake.preparationStage)
      || !CONTRACT_PHASES.has(intake.contractPhase)
      || typeof intake.desiredAnswer !== "string"
      || !hasValidCommercialDisclosure(
        intake.commercialRelationship,
        intake.sponsorshipDetail,
      )
      || !isDateString(intake.createdAt)
      || value.thread !== null
      || value.post !== null
      || !Array.isArray(value.answers)
      || value.answers.length !== 0
      || value.viewer.isAuthor !== true
      || value.viewer.canAnswer !== false
      || value.viewer.canResolve !== false
      || value.viewer.canRecordOutcome !== false
      || value.viewer.canWithdraw !== true
      || !Array.isArray(value.viewer.selection)
      || value.viewer.selection.length !== 0
      || !Array.isArray(value.viewer.outcomes)
      || value.viewer.outcomes.length !== 0
    ) return null;
    return {
      status: "private_waitlist",
      intake: {
        questionId: intake.questionId,
        title: intake.title,
        content: intake.content,
        topicCategory: intake.topicCategory,
        experienceScope: intake.experienceScope,
        coarseRegion: intake.coarseRegion,
        preparationStage: intake.preparationStage,
        contractPhase: intake.contractPhase,
        desiredAnswer: intake.desiredAnswer,
        commercialRelationship: intake.commercialRelationship,
        sponsorshipDetail: intake.sponsorshipDetail,
        createdAt: intake.createdAt,
      },
      thread: null,
      post: null,
      answers: [],
      viewer: {
        isAuthor: true,
        canAnswer: false,
        canResolve: false,
        canRecordOutcome: false,
        canWithdraw: true,
        selection: [],
        outcomes: [],
      },
    };
  }
  const thread = parseThread(value.thread);
  const post = parsePost(value.post);
  const answers = Array.isArray(value.answers) ? value.answers.map(parseAnswer) : null;
  const selection = Array.isArray(value.viewer.selection)
    ? value.viewer.selection.map(parseSelection)
    : null;
  const outcomes = Array.isArray(value.viewer.outcomes)
    ? value.viewer.outcomes.map(parseOutcome)
    : null;
  if (
    !thread
    || post === undefined
    || !answers
    || answers.some((answer) => !answer)
    || typeof value.viewer.isAuthor !== "boolean"
    || typeof value.viewer.canAnswer !== "boolean"
    || typeof value.viewer.canResolve !== "boolean"
    || typeof value.viewer.canRecordOutcome !== "boolean"
    || typeof value.viewer.canWithdraw !== "boolean"
    || !selection
    || selection.some((item) => !item)
    || !outcomes
    || outcomes.some((item) => !item)
    || (!value.viewer.isAuthor && (selection.length > 0 || outcomes.length > 0))
  ) return null;
  const visiblePeerAnswerCount = answers.filter(
    (answer) => answer.contentOrigin === "member",
  ).length;
  const visibleProfessionalAnswerCount = answers.filter(
    (answer) => answer.contentOrigin === "industry_professional",
  ).length;
  if (
    thread.qualifiedPeerAnswerCount !== visiblePeerAnswerCount
    || thread.qualifiedProfessionalAnswerCount !== visibleProfessionalAnswerCount
  ) return null;
  const sourceAvailable = thread.sourceUnavailableAt === null
    && thread.newApplicationsAllowed;
  const publiclyReadablePost = post !== null
    && post.publicationState === "published";
  if (
    (value.viewer.canAnswer && (
      value.viewer.isAuthor
      || !sourceAvailable
      || !publiclyReadablePost
      || !new Set(["open", "answered"]).has(thread.state)
    ))
    || (value.viewer.canResolve && (
      !value.viewer.isAuthor
      || !sourceAvailable
      || thread.state !== "answered"
      || thread.qualifiedPeerAnswerCount
        + thread.qualifiedProfessionalAnswerCount < 1
    ))
    || (value.viewer.canRecordOutcome && (
      !value.viewer.isAuthor
      || !sourceAvailable
      || !new Set(["resolved", "followup_scheduled", "completed"])
        .has(thread.state)
    ))
    || (value.viewer.canWithdraw && !value.viewer.isAuthor)
  ) return null;
  return {
    thread,
    post,
    answers,
    viewer: {
      isAuthor: value.viewer.isAuthor,
      canAnswer: value.viewer.canAnswer,
      canResolve: value.viewer.canResolve,
      canRecordOutcome: value.viewer.canRecordOutcome,
      canWithdraw: value.viewer.canWithdraw,
      selection,
      outcomes,
    },
  };
}

const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Validate an owner-scoped encrypted composer draft without widening its data. */
export function parseCommunityDecisionDraft(value, expectedOwnerId, now = Date.now()) {
  if (!isRecord(value) || !isCommunityDecisionUuid(expectedOwnerId)) return null;
  if (
    value.ownerId !== expectedOwnerId
    || typeof value.updatedAt !== "number"
    || !Number.isSafeInteger(value.updatedAt)
    || value.updatedAt > now + 5 * 60 * 1000
    || now - value.updatedAt > DRAFT_MAX_AGE_MS
    || typeof value.content !== "string"
    || value.content.length > 5000
    || typeof value.title !== "string"
    || value.title.length > 160
    || !(value.experienceScope === null || EXPERIENCE_SCOPES.has(value.experienceScope))
    || !(value.preparationStage === null || PREPARATION_STAGES.has(value.preparationStage))
    || !(value.contractPhase === null || CONTRACT_PHASES.has(value.contractPhase))
    || typeof value.coarseRegion !== "string"
    || value.coarseRegion.length > 40
    || typeof value.desiredAnswer !== "string"
    || value.desiredAnswer.length > 300
    || !COMMERCIAL_RELATIONSHIPS.has(value.commercialRelationship)
    || typeof value.sponsorshipDetail !== "string"
    || value.sponsorshipDetail.length > 500
  ) return null;
  return {
    ownerId: value.ownerId,
    updatedAt: value.updatedAt,
    content: value.content,
    title: value.title,
    experienceScope: value.experienceScope,
    preparationStage: value.preparationStage,
    contractPhase: value.contractPhase,
    coarseRegion: value.coarseRegion,
    desiredAnswer: value.desiredAnswer,
    commercialRelationship: value.commercialRelationship,
    sponsorshipDetail: value.sponsorshipDetail,
  };
}
