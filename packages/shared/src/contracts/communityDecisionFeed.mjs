const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const MODES = new Set(["for_you", "needs_help", "outcomes"]);
const STATES = new Set([
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

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNullableString(value) {
  return value === null || typeof value === "string";
}

function hasValidCommercialDisclosure(relationship, detail) {
  if (!COMMERCIAL_RELATIONSHIPS.has(relationship)) return false;
  if (relationship === "none") return detail === null;
  return typeof detail === "string"
    && detail.trim().length >= 3
    && detail.length <= 500;
}

function parseAuthor(value) {
  if (
    !hasExactKeys(value, ["nickname", "badge"])
    || typeof value.nickname !== "string"
    || value.nickname.trim().length < 1
    || value.nickname.length > 80
    || typeof value.badge !== "string"
    || value.badge.length > 64
  ) return null;
  return Object.freeze({ nickname: value.nickname, badge: value.badge });
}

function parseViewer(value) {
  if (
    !hasExactKeys(value, ["isAuthor", "canAnswer"])
    || typeof value.isAuthor !== "boolean"
    || typeof value.canAnswer !== "boolean"
  ) return null;
  return Object.freeze({
    isAuthor: value.isAuthor,
    canAnswer: value.canAnswer,
  });
}

function parseOutcome(value) {
  if (value === null) return null;
  if (
    !hasExactKeys(value, [
      "id",
      "revision",
      "actionTaken",
      "resultSummary",
      "applicableConditions",
      "commercialRelationship",
      "sponsorshipDetail",
      "createdAt",
    ])
    || !isUuid(value.id)
    || !Number.isSafeInteger(value.revision)
    || value.revision < 1
    || typeof value.actionTaken !== "string"
    || typeof value.resultSummary !== "string"
    || typeof value.applicableConditions !== "string"
    || !hasValidCommercialDisclosure(
      value.commercialRelationship,
      value.sponsorshipDetail,
    )
    || !isDate(value.createdAt)
  ) return undefined;
  return Object.freeze({
    id: value.id,
    revision: value.revision,
    actionTaken: value.actionTaken,
    resultSummary: value.resultSummary,
    applicableConditions: value.applicableConditions,
    commercialRelationship: value.commercialRelationship,
    sponsorshipDetail: value.sponsorshipDetail,
    createdAt: value.createdAt,
  });
}

/** Parse the public, human-reviewed projection returned by a detail read. */
export function parseCommunityDecisionPublicOutcome(value) {
  if (!hasExactKeys(value, ["outcome"])) return null;
  const outcome = parseOutcome(value.outcome);
  if (outcome === undefined) return null;
  return Object.freeze({ outcome });
}

const ITEM_KEYS = [
  "threadId",
  "postId",
  "state",
  "version",
  "kind",
  "topicCategory",
  "experienceScope",
  "coarseRegion",
  "preparationStage",
  "contractPhase",
  "desiredAnswer",
  "title",
  "content",
  "contentOrigin",
  "commercialRelationship",
  "sponsorshipDetail",
  "author",
  "qualifiedPeerAnswerCount",
  "qualifiedProfessionalAnswerCount",
  "viewer",
  "outcome",
  "createdAt",
  "sortAt",
];

function parseItem(value) {
  if (!hasExactKeys(value, ITEM_KEYS)) return null;
  const author = parseAuthor(value.author);
  const viewer = parseViewer(value.viewer);
  const outcome = parseOutcome(value.outcome);
  if (
    !isUuid(value.threadId)
    || !isUuid(value.postId)
    || !STATES.has(value.state)
    || !Number.isSafeInteger(value.version)
    || value.version < 1
    || value.kind !== "experience_question"
    || value.topicCategory !== "contract_extra_cost"
    || !EXPERIENCE_SCOPES.has(value.experienceScope)
    || !isNullableString(value.coarseRegion)
    || !PREPARATION_STAGES.has(value.preparationStage)
    || !CONTRACT_PHASES.has(value.contractPhase)
    || typeof value.desiredAnswer !== "string"
    || typeof value.title !== "string"
    || typeof value.content !== "string"
    || value.contentOrigin !== "member"
    || !hasValidCommercialDisclosure(
      value.commercialRelationship,
      value.sponsorshipDetail,
    )
    || !author
    || !Number.isSafeInteger(value.qualifiedPeerAnswerCount)
    || value.qualifiedPeerAnswerCount < 0
    || !Number.isSafeInteger(value.qualifiedProfessionalAnswerCount)
    || value.qualifiedProfessionalAnswerCount < 0
    || !viewer
    || outcome === undefined
    || !isDate(value.createdAt)
    || !isDate(value.sortAt)
  ) return null;
  return Object.freeze({
    threadId: value.threadId,
    postId: value.postId,
    state: value.state,
    version: value.version,
    kind: "experience_question",
    topicCategory: "contract_extra_cost",
    experienceScope: value.experienceScope,
    coarseRegion: value.coarseRegion,
    preparationStage: value.preparationStage,
    contractPhase: value.contractPhase,
    desiredAnswer: value.desiredAnswer,
    title: value.title,
    content: value.content,
    contentOrigin: "member",
    commercialRelationship: value.commercialRelationship,
    sponsorshipDetail: value.sponsorshipDetail,
    author,
    qualifiedPeerAnswerCount: value.qualifiedPeerAnswerCount,
    qualifiedProfessionalAnswerCount: value.qualifiedProfessionalAnswerCount,
    viewer,
    outcome,
    createdAt: value.createdAt,
    sortAt: value.sortAt,
  });
}

export function parseCommunityDecisionFeed(value, expectedMode) {
  if (
    !hasExactKeys(value, ["items", "nextCursor", "hasMore", "mode"])
    || !MODES.has(value.mode)
    || (expectedMode !== undefined && value.mode !== expectedMode)
    || !Array.isArray(value.items)
    || value.items.length > 20
    || typeof value.hasMore !== "boolean"
  ) return null;

  const items = value.items.map(parseItem);
  if (items.some((item) => item === null)) return null;
  let nextCursor = null;
  if (value.nextCursor !== null) {
    if (
      !hasExactKeys(value.nextCursor, ["at", "id"])
      || !isDate(value.nextCursor.at)
      || !isUuid(value.nextCursor.id)
      || !value.hasMore
      || items.length < 1
    ) return null;
    nextCursor = Object.freeze({
      at: value.nextCursor.at,
      id: value.nextCursor.id,
    });
  } else if (value.hasMore) {
    return null;
  }

  return Object.freeze({
    items: Object.freeze(items),
    nextCursor,
    hasMore: value.hasMore,
    mode: value.mode,
  });
}

function parseLane(
  value,
  targetKey,
  extraTargetKey = null,
) {
  const keys = ["count", targetKey];
  if (extraTargetKey) keys.push(extraTargetKey);
  if (
    !hasExactKeys(value, keys)
    || !Number.isSafeInteger(value.count)
    || value.count < 0
    || !(value[targetKey] === null || isUuid(value[targetKey]))
    || (value.count === 0 && value[targetKey] !== null)
    || (value.count > 0 && value[targetKey] === null)
  ) return null;
  if (
    extraTargetKey
    && !(
      value[extraTargetKey] === null
      || value[extraTargetKey] === "private_waitlist"
      || value[extraTargetKey] === "open"
    )
  ) return null;
  return value;
}

export function parseCommunityDecisionInbox(value) {
  if (!hasExactKeys(value, [
    "waitingReplies",
    "experienceNeeded",
    "returnedOutcomes",
  ])) return null;
  const waiting = parseLane(
    value.waitingReplies,
    "targetQuestionId",
    "targetStatus",
  );
  const needed = parseLane(value.experienceNeeded, "targetThreadId");
  const outcomes = parseLane(value.returnedOutcomes, "targetThreadId");
  if (!waiting || !needed || !outcomes) return null;
  if (
    (waiting.count === 0 && waiting.targetStatus !== null)
    || (waiting.count > 0 && waiting.targetStatus === null)
  ) return null;
  return Object.freeze({
    waitingReplies: Object.freeze({ ...waiting }),
    experienceNeeded: Object.freeze({ ...needed }),
    returnedOutcomes: Object.freeze({ ...outcomes }),
  });
}
