import { isRecord, isUuid } from "@/utils/requestValidation";

export const DECISION_PUBLICATION_STATES = [
  "pending_review",
  "published",
  "rejected",
  "withdrawn",
] as const;

export type DecisionPublicationState =
  (typeof DECISION_PUBLICATION_STATES)[number];

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

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNullableDate(value: unknown): value is string | null {
  return value === null || isDate(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

const EVIDENCE_KEYS = [
  "content",
  "contentOrigin",
  "applicability",
  "commercialRelationship",
  "sponsorshipDetail",
] as const;

function parseEvidence(value: unknown) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, EVIDENCE_KEYS)
    || !isNullableString(value.content)
    || !["member", "industry_professional"].includes(
      String(value.contentOrigin),
    )
    || ![
      "applies",
      "conditions_differ",
      "need_more_info",
      "taken_as_next_action",
    ].includes(String(value.applicability))
    || !COMMERCIAL_RELATIONSHIPS.has(String(value.commercialRelationship))
    || !isNullableString(value.sponsorshipDetail)
  ) return null;
  return {
    content: value.content,
    contentOrigin: value.contentOrigin as "member" | "industry_professional",
    applicability: value.applicability as string,
    commercialRelationship: value.commercialRelationship as string,
    sponsorshipDetail: value.sponsorshipDetail,
  };
}

const ITEM_KEYS = [
  "outcomeId",
  "threadId",
  "revision",
  "publicationState",
  "sourceAvailable",
  "authorNickname",
  "title",
  "sourceContent",
  "desiredAnswer",
  "actionTaken",
  "resultSummary",
  "applicableConditions",
  "commercialRelationship",
  "sponsorshipDetail",
  "selectedEvidence",
  "createdAt",
  "reviewedAt",
  "reviewReason",
  "reviewPolicyVersion",
  "publishedAt",
  "withdrawnAt",
  "withdrawnReason",
] as const;

function parseItem(value: unknown) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ITEM_KEYS)
    || !isUuid(value.outcomeId)
    || !isUuid(value.threadId)
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 1
    || !DECISION_PUBLICATION_STATES.includes(
      value.publicationState as DecisionPublicationState,
    )
    || typeof value.sourceAvailable !== "boolean"
    || typeof value.authorNickname !== "string"
    || typeof value.title !== "string"
    || typeof value.sourceContent !== "string"
    || typeof value.desiredAnswer !== "string"
    || typeof value.actionTaken !== "string"
    || typeof value.resultSummary !== "string"
    || typeof value.applicableConditions !== "string"
    || !COMMERCIAL_RELATIONSHIPS.has(String(value.commercialRelationship))
    || !isNullableString(value.sponsorshipDetail)
    || !Array.isArray(value.selectedEvidence)
    || value.selectedEvidence.length > 20
    || !isDate(value.createdAt)
    || !isNullableDate(value.reviewedAt)
    || !isNullableString(value.reviewReason)
    || !isNullableString(value.reviewPolicyVersion)
    || !isNullableDate(value.publishedAt)
    || !isNullableDate(value.withdrawnAt)
    || !isNullableString(value.withdrawnReason)
  ) return null;
  const selectedEvidence = value.selectedEvidence.map(parseEvidence);
  if (selectedEvidence.some((item) => item === null)) return null;
  return {
    outcomeId: value.outcomeId,
    threadId: value.threadId,
    revision: value.revision as number,
    publicationState: value.publicationState as DecisionPublicationState,
    sourceAvailable: value.sourceAvailable,
    authorNickname: value.authorNickname,
    title: value.title,
    sourceContent: value.sourceContent,
    desiredAnswer: value.desiredAnswer,
    actionTaken: value.actionTaken,
    resultSummary: value.resultSummary,
    applicableConditions: value.applicableConditions,
    commercialRelationship: value.commercialRelationship as string,
    sponsorshipDetail: value.sponsorshipDetail,
    selectedEvidence,
    createdAt: value.createdAt,
    reviewedAt: value.reviewedAt,
    reviewReason: value.reviewReason,
    reviewPolicyVersion: value.reviewPolicyVersion,
    publishedAt: value.publishedAt,
    withdrawnAt: value.withdrawnAt,
    withdrawnReason: value.withdrawnReason,
  };
}

export function parseDecisionOutcomeReviewQueue(
  value: unknown,
  expectedState: DecisionPublicationState,
) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["items", "nextCursor", "hasMore", "state"])
    || value.state !== expectedState
    || !Array.isArray(value.items)
    || value.items.length > 50
    || typeof value.hasMore !== "boolean"
  ) return null;
  const items = value.items.map(parseItem);
  if (items.some((item) => item === null)) return null;

  let nextCursor: { at: string; id: string } | null = null;
  if (value.nextCursor !== null) {
    if (
      !isRecord(value.nextCursor)
      || !hasExactKeys(value.nextCursor, ["at", "id"])
      || !isDate(value.nextCursor.at)
      || !isUuid(value.nextCursor.id)
      || value.hasMore !== true
      || items.length === 0
    ) return null;
    nextCursor = { at: value.nextCursor.at, id: value.nextCursor.id };
  } else if (value.hasMore) {
    return null;
  }

  return { items, nextCursor, hasMore: value.hasMore, state: expectedState };
}

export function parseDecisionOutcomeReviewReceipt(
  value: unknown,
  expected: {
    operationKey: string;
    outcomeId: string;
    publicationState: "published" | "rejected";
  },
) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "receiptVersion",
      "operationKey",
      "outcomeId",
      "threadId",
      "revision",
      "publicationState",
      "reviewedAt",
      "replayed",
    ])
    || value.receiptVersion !== 1
    || value.operationKey !== expected.operationKey
    || value.outcomeId !== expected.outcomeId
    || !isUuid(value.threadId)
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 1
    || value.publicationState !== expected.publicationState
    || !isDate(value.reviewedAt)
    || typeof value.replayed !== "boolean"
  ) return null;
  return {
    outcomeId: value.outcomeId,
    threadId: value.threadId,
    revision: value.revision as number,
    publicationState: value.publicationState,
    reviewedAt: value.reviewedAt,
    replayed: value.replayed,
  };
}
