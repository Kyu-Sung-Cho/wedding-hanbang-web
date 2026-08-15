import { normalizeAmoraCoreCriterionText } from "./amoraCoreCriterion.mjs";

export const AMORA_COUPLE_CRITERION_CONTRACT_VERSION = 1;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && keys.every((key) => expectedKeys.includes(key));
}

function normalizeUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function normalizeIsoTimestamp(value) {
  if (
    typeof value !== "string"
    || !ISO_TIMESTAMP_PATTERN.test(value)
    || Number.isNaN(Date.parse(value))
  ) return null;
  return new Date(value).toISOString() === value ? value : null;
}

function parseCurrentCriterion(value) {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, ["decisionId", "value", "confirmedAt"])) {
    return undefined;
  }

  const decisionId = normalizeUuid(value.decisionId);
  const criterionValue = normalizeAmoraCoreCriterionText(value.value);
  const confirmedAt = normalizeIsoTimestamp(value.confirmedAt);
  if (!decisionId || criterionValue !== value.value || !confirmedAt) return undefined;

  return { decisionId, value: criterionValue, confirmedAt };
}

function parsePendingProposal(value) {
  if (value === null) return null;
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "id",
      "value",
      "revision",
      "proposerUserId",
      "brideUserId",
      "groomUserId",
      "acceptedUserIds",
      "createdAt",
      "updatedAt",
    ])
  ) return undefined;

  const id = normalizeUuid(value.id);
  const proposerUserId = normalizeUuid(value.proposerUserId);
  const brideUserId = normalizeUuid(value.brideUserId);
  const groomUserId = normalizeUuid(value.groomUserId);
  const criterionValue = normalizeAmoraCoreCriterionText(value.value);
  const createdAt = normalizeIsoTimestamp(value.createdAt);
  const updatedAt = normalizeIsoTimestamp(value.updatedAt);
  if (
    !id
    || !proposerUserId
    || !brideUserId
    || !groomUserId
    || brideUserId === groomUserId
    || (proposerUserId !== brideUserId && proposerUserId !== groomUserId)
    || criterionValue !== value.value
    || !Number.isSafeInteger(value.revision)
    || value.revision < 1
    || !Array.isArray(value.acceptedUserIds)
    || value.acceptedUserIds.length !== 1
    || !createdAt
    || !updatedAt
    || Date.parse(updatedAt) < Date.parse(createdAt)
  ) return undefined;

  const acceptedUserId = normalizeUuid(value.acceptedUserIds[0]);
  if (acceptedUserId !== proposerUserId) return undefined;

  return {
    id,
    value: criterionValue,
    revision: value.revision,
    proposerUserId,
    brideUserId,
    groomUserId,
    acceptedUserIds: [acceptedUserId],
    createdAt,
    updatedAt,
  };
}

export function parseAmoraCoupleCriterionResponse(value) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["version", "coupleId", "linked", "current", "proposal"])
    || value.version !== AMORA_COUPLE_CRITERION_CONTRACT_VERSION
    || typeof value.linked !== "boolean"
  ) return null;

  const coupleId = normalizeUuid(value.coupleId);
  const current = parseCurrentCriterion(value.current);
  const proposal = parsePendingProposal(value.proposal);
  if (!coupleId || current === undefined || proposal === undefined) return null;
  if (!value.linked && (current !== null || proposal !== null)) return null;

  return {
    version: AMORA_COUPLE_CRITERION_CONTRACT_VERSION,
    coupleId,
    linked: value.linked,
    current,
    proposal,
  };
}

export function parseAmoraCoupleCriterionProposeRequest(value) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "version",
      "expectedCoupleId",
      "expectedCurrentDecisionId",
      "requestId",
      "value",
    ])
    || value.version !== AMORA_COUPLE_CRITERION_CONTRACT_VERSION
  ) return null;

  const expectedCoupleId = normalizeUuid(value.expectedCoupleId);
  const expectedCurrentDecisionId = value.expectedCurrentDecisionId === null
    ? null
    : normalizeUuid(value.expectedCurrentDecisionId);
  const requestId = normalizeUuid(value.requestId);
  const criterionValue = normalizeAmoraCoreCriterionText(value.value);
  if (
    !expectedCoupleId
    || (value.expectedCurrentDecisionId !== null && !expectedCurrentDecisionId)
    || !requestId
    || criterionValue !== value.value
  ) return null;

  return {
    version: AMORA_COUPLE_CRITERION_CONTRACT_VERSION,
    expectedCoupleId,
    expectedCurrentDecisionId,
    requestId,
    value: criterionValue,
  };
}

export function buildAmoraCoupleCriterionProposeRequest({
  expectedCoupleId,
  expectedCurrentDecisionId,
  requestId,
  value,
}) {
  const criterionValue = normalizeAmoraCoreCriterionText(value);
  if (!criterionValue) return null;
  return parseAmoraCoupleCriterionProposeRequest({
    version: AMORA_COUPLE_CRITERION_CONTRACT_VERSION,
    expectedCoupleId,
    expectedCurrentDecisionId,
    requestId,
    value: criterionValue,
  });
}

function parseProposalMutationRequest(value) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "version",
      "expectedCoupleId",
      "proposalId",
      "expectedRevision",
      "requestId",
    ])
    || value.version !== AMORA_COUPLE_CRITERION_CONTRACT_VERSION
    || !Number.isSafeInteger(value.expectedRevision)
    || value.expectedRevision < 1
  ) return null;

  const expectedCoupleId = normalizeUuid(value.expectedCoupleId);
  const proposalId = normalizeUuid(value.proposalId);
  const requestId = normalizeUuid(value.requestId);
  if (!expectedCoupleId || !proposalId || !requestId) return null;

  return {
    version: AMORA_COUPLE_CRITERION_CONTRACT_VERSION,
    expectedCoupleId,
    proposalId,
    expectedRevision: value.expectedRevision,
    requestId,
  };
}

export function parseAmoraCoupleCriterionAcceptRequest(value) {
  return parseProposalMutationRequest(value);
}

export function buildAmoraCoupleCriterionAcceptRequest(input) {
  return parseProposalMutationRequest({
    version: AMORA_COUPLE_CRITERION_CONTRACT_VERSION,
    ...input,
  });
}

export function parseAmoraCoupleCriterionCancelRequest(value) {
  return parseProposalMutationRequest(value);
}

export function buildAmoraCoupleCriterionCancelRequest(input) {
  return parseProposalMutationRequest({
    version: AMORA_COUPLE_CRITERION_CONTRACT_VERSION,
    ...input,
  });
}
