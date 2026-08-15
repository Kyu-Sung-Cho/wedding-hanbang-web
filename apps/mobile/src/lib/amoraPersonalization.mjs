const DECISION_START_VALUES = Object.freeze([
  "recommend_first",
  "compare_first",
  "ask_each_time",
]);
const ANSWER_DETAIL_VALUES = Object.freeze(["brief", "detailed", "adaptive"]);
const SUPPORT_ORDER_VALUES = Object.freeze([
  "listen_first",
  "action_first",
  "ask_each_time",
]);
const WORK_MODE_VALUES = Object.freeze([
  "together",
  "owner_led",
  "hybrid",
  "ask_each_time",
]);
const FAMILY_ORDER_VALUES = Object.freeze([
  "couple_first",
  "family_input_first",
  "case_by_case",
  "ask_each_time",
]);
const TONE_STYLE_VALUES = Object.freeze([
  "adaptive",
  "warm",
  "calm_clear",
  "friendly_honest",
]);

const PROFILE_KEYS = Object.freeze([
  "preferences",
  "revision",
  "confirmedAt",
  "updatedAt",
]);
const PREFERENCE_KEYS = Object.freeze([
  "decisionStart",
  "answerDetail",
  "supportOrder",
  "workMode",
  "familyOrder",
  "toneStyle",
]);
const PROGRESSIVE_SELECTION_KEYS = Object.freeze([
  "supportOrder",
  "answerDetail",
]);
const BLOCKED_OUTCOME_SELECTION_KEYS = Object.freeze([
  "outcome",
  "supportOrder",
]);
const UNCERTAIN_OUTCOME_SELECTION_KEYS = Object.freeze([
  "outcome",
  "decisionStart",
]);
const CHANGED_OUTCOME_SELECTION_KEYS = Object.freeze([
  "outcome",
  "answerDetail",
]);
const COMPLETED_OUTCOME_SELECTION_KEYS = Object.freeze([
  "outcome",
  "workMode",
]);
const FAMILY_MOMENT_SELECTION_KEYS = Object.freeze([
  "momentType",
  "attentionWindow",
  "familyOrder",
]);
const SINGLE_PREFERENCE_SELECTION_KEYS = Object.freeze(["field", "value"]);
const FAMILY_PERSONALIZATION_MOMENT_TYPES = Object.freeze([
  "sanggyeonrye",
  "family_greeting",
]);
const FAMILY_PERSONALIZATION_ATTENTION_WINDOWS = Object.freeze(["d3", "d1"]);

const DEFAULT_PREFERENCES = Object.freeze({
  decisionStart: "ask_each_time",
  answerDetail: "adaptive",
  supportOrder: "ask_each_time",
  workMode: "ask_each_time",
  familyOrder: "ask_each_time",
  toneStyle: "adaptive",
});

export const DEFAULT_AMORA_PERSONALIZATION_PREFERENCES = DEFAULT_PREFERENCES;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function includes(values, value) {
  return typeof value === "string" && values.includes(value);
}

function parsePreferences(value) {
  if (
    !hasExactKeys(value, PREFERENCE_KEYS)
    || !includes(DECISION_START_VALUES, value.decisionStart)
    || !includes(ANSWER_DETAIL_VALUES, value.answerDetail)
    || !includes(SUPPORT_ORDER_VALUES, value.supportOrder)
    || !includes(WORK_MODE_VALUES, value.workMode)
    || !includes(FAMILY_ORDER_VALUES, value.familyOrder)
    || !includes(TONE_STYLE_VALUES, value.toneStyle)
  ) return null;

  return Object.freeze({
    decisionStart: value.decisionStart,
    answerDetail: value.answerDetail,
    supportOrder: value.supportOrder,
    workMode: value.workMode,
    familyOrder: value.familyOrder,
    toneStyle: value.toneStyle,
  });
}

function parseProfile(value) {
  if (!hasExactKeys(value, PROFILE_KEYS)) return null;
  const preferences = parsePreferences(value.preferences);
  if (
    !preferences
    || !Number.isSafeInteger(value.revision)
    || value.revision < 1
    || typeof value.confirmedAt !== "string"
    || !value.confirmedAt
    || typeof value.updatedAt !== "string"
    || !value.updatedAt
  ) return null;

  return Object.freeze({
    preferences,
    revision: value.revision,
    confirmedAt: value.confirmedAt,
    updatedAt: value.updatedAt,
  });
}

function isPreferenceValueForField(field, value) {
  switch (field) {
    case "decisionStart":
      return includes(DECISION_START_VALUES, value);
    case "answerDetail":
      return includes(ANSWER_DETAIL_VALUES, value);
    case "supportOrder":
      return includes(SUPPORT_ORDER_VALUES, value);
    case "workMode":
      return includes(WORK_MODE_VALUES, value);
    case "familyOrder":
      return includes(FAMILY_ORDER_VALUES, value);
    case "toneStyle":
      return includes(TONE_STYLE_VALUES, value);
    default:
      return false;
  }
}

export function parseAmoraPersonalizationEnvelope(value) {
  if (!hasExactKeys(value, ["profile"])) return null;
  if (value.profile === null) return Object.freeze({ profile: null });
  const profile = parseProfile(value.profile);
  return profile ? Object.freeze({ profile }) : null;
}

export function parseAmoraPersonalizationResetEnvelope(value) {
  if (
    !hasExactKeys(value, ["deleted", "profile"])
    || value.deleted !== true
    || value.profile !== null
  ) return null;

  return Object.freeze({ deleted: true, profile: null });
}

export function parseAmoraPersonalizationConflict(value) {
  if (
    !hasExactKeys(value, ["error", "code", "current"])
    || value.code !== "PERSONALIZATION_REVISION_CONFLICT"
    || typeof value.error !== "string"
    || value.error.length < 1
    || value.error.length > 240
  ) return null;
  if (value.current === null) return Object.freeze({ current: null });
  const current = parseProfile(value.current);
  return current ? Object.freeze({ current }) : null;
}

export async function loadOwnerAmoraPersonalization(ownerUserId, fetchForExpectedUser) {
  if (
    typeof ownerUserId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(ownerUserId)
    || typeof fetchForExpectedUser !== "function"
  ) return null;

  try {
    const response = await fetchForExpectedUser(
      ownerUserId,
      "/api/amora/personalization",
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) return null;
    return parseAmoraPersonalizationEnvelope(payload)?.profile?.preferences ?? null;
  } catch {
    return null;
  }
}

export function buildAmoraPersonalizationResetBody(current) {
  const profile = parseProfile(current);
  if (!profile) return null;

  return Object.freeze({ expectedRevision: profile.revision });
}

export function buildSinglePersonalizationPreferenceSaveBody(current, selection) {
  if (
    !hasExactKeys(selection, SINGLE_PREFERENCE_SELECTION_KEYS)
    || !isPreferenceValueForField(selection.field, selection.value)
  ) return null;

  const profile = current === null || current === undefined
    ? null
    : parseProfile(current);
  if (current !== null && current !== undefined && !profile) return null;

  return Object.freeze({
    expectedRevision: profile?.revision ?? null,
    preferences: Object.freeze({
      ...(profile?.preferences ?? DEFAULT_PREFERENCES),
      [selection.field]: selection.value,
    }),
  });
}

export function buildProgressivePersonalizationSaveBody(current, selection) {
  if (
    !hasExactKeys(selection, PROGRESSIVE_SELECTION_KEYS)
    || !includes(SUPPORT_ORDER_VALUES, selection.supportOrder)
    || !includes(ANSWER_DETAIL_VALUES, selection.answerDetail)
  ) return null;

  const profile = current === null || current === undefined
    ? null
    : parseProfile(current);
  if (current !== null && current !== undefined && !profile) return null;

  return Object.freeze({
    expectedRevision: profile?.revision ?? null,
    preferences: Object.freeze({
      ...(profile?.preferences ?? DEFAULT_PREFERENCES),
      supportOrder: selection.supportOrder,
      answerDetail: selection.answerDetail,
    }),
  });
}

export function buildBlockedOutcomePersonalizationSaveBody(current, selection) {
  if (
    !hasExactKeys(selection, BLOCKED_OUTCOME_SELECTION_KEYS)
    || selection.outcome !== "blocked"
    || !includes(SUPPORT_ORDER_VALUES, selection.supportOrder)
  ) return null;

  const profile = current === null || current === undefined
    ? null
    : parseProfile(current);
  if (current !== null && current !== undefined && !profile) return null;

  return Object.freeze({
    expectedRevision: profile?.revision ?? null,
    preferences: Object.freeze({
      ...(profile?.preferences ?? DEFAULT_PREFERENCES),
      supportOrder: selection.supportOrder,
    }),
  });
}

export function buildUncertainOutcomePersonalizationSaveBody(current, selection) {
  if (
    !hasExactKeys(selection, UNCERTAIN_OUTCOME_SELECTION_KEYS)
    || selection.outcome !== "not_sure"
    || !includes(DECISION_START_VALUES, selection.decisionStart)
  ) return null;

  const profile = current === null || current === undefined
    ? null
    : parseProfile(current);
  if (current !== null && current !== undefined && !profile) return null;

  return Object.freeze({
    expectedRevision: profile?.revision ?? null,
    preferences: Object.freeze({
      ...(profile?.preferences ?? DEFAULT_PREFERENCES),
      decisionStart: selection.decisionStart,
    }),
  });
}

export function buildChangedOutcomePersonalizationSaveBody(current, selection) {
  if (
    !hasExactKeys(selection, CHANGED_OUTCOME_SELECTION_KEYS)
    || selection.outcome !== "changed"
    || !includes(ANSWER_DETAIL_VALUES, selection.answerDetail)
  ) return null;

  const profile = current === null || current === undefined
    ? null
    : parseProfile(current);
  if (current !== null && current !== undefined && !profile) return null;

  return Object.freeze({
    expectedRevision: profile?.revision ?? null,
    preferences: Object.freeze({
      ...(profile?.preferences ?? DEFAULT_PREFERENCES),
      answerDetail: selection.answerDetail,
    }),
  });
}

export function buildCompletedOutcomePersonalizationSaveBody(current, selection) {
  if (
    !hasExactKeys(selection, COMPLETED_OUTCOME_SELECTION_KEYS)
    || selection.outcome !== "completed"
    || !includes(WORK_MODE_VALUES, selection.workMode)
  ) return null;

  const profile = current === null || current === undefined
    ? null
    : parseProfile(current);
  if (current !== null && current !== undefined && !profile) return null;

  return Object.freeze({
    expectedRevision: profile?.revision ?? null,
    preferences: Object.freeze({
      ...(profile?.preferences ?? DEFAULT_PREFERENCES),
      workMode: selection.workMode,
    }),
  });
}

export function canOfferFamilyMomentPersonalization(momentType, attentionWindow) {
  return includes(FAMILY_PERSONALIZATION_MOMENT_TYPES, momentType)
    && includes(FAMILY_PERSONALIZATION_ATTENTION_WINDOWS, attentionWindow);
}

export function buildFamilyMomentPersonalizationSaveBody(current, selection) {
  if (
    !hasExactKeys(selection, FAMILY_MOMENT_SELECTION_KEYS)
    || !canOfferFamilyMomentPersonalization(
      selection.momentType,
      selection.attentionWindow,
    )
    || !includes(FAMILY_ORDER_VALUES, selection.familyOrder)
  ) return null;

  const profile = current === null || current === undefined
    ? null
    : parseProfile(current);
  if (current !== null && current !== undefined && !profile) return null;

  return Object.freeze({
    expectedRevision: profile?.revision ?? null,
    preferences: Object.freeze({
      ...(profile?.preferences ?? DEFAULT_PREFERENCES),
      familyOrder: selection.familyOrder,
    }),
  });
}
