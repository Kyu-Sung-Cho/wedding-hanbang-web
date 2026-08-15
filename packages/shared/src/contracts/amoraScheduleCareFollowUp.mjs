export const AMORA_SCHEDULE_CARE_FOLLOW_UP_CONTRACT_VERSION = 1;
export const AMORA_SCHEDULE_CARE_FOLLOW_UP_METADATA_KEY =
  "amora_schedule_care_follow_up_v1";
export const AMORA_SCHEDULE_CARE_ACTION_DRAFT_METADATA_KEY =
  "amora_schedule_care_action_draft_v1";
export const AMORA_SCHEDULE_CARE_FOLLOW_UP_ANSWER_PREFIX = " ";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_UNICODE_RE = /[\p{Cf}\p{Zl}\p{Zp}]/u;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  return actual.length === canonical.length
    && actual.every((key, index) => key === canonical[index]);
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function isNonnegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function hasForbiddenControl(value, allowNewline) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return true;
    if (
      (codePoint >= 0 && codePoint <= 31 && !(allowNewline && codePoint === 10))
      || (codePoint >= 127 && codePoint <= 159)
    ) return true;
  }
  return false;
}

function isSafeSingleLine(value, maxLength) {
  return typeof value === "string"
    && value.trim().length > 0
    && value === value.trim()
    && Array.from(value).length <= maxLength
    && !hasForbiddenControl(value, false)
    && !FORBIDDEN_UNICODE_RE.test(value);
}

function isSafeMultilinePrompt(value) {
  return typeof value === "string"
    && value.trim().length > 0
    && value.includes("\n")
    && value.endsWith("\n\n내 답:")
    && Array.from(value).length <= 1_400
    && !hasForbiddenControl(value, true)
    && !FORBIDDEN_UNICODE_RE.test(value);
}

function isSafeAnswer(value) {
  return typeof value === "string"
    && value.trim().length > 0
    && value === value.trim()
    && Array.from(value).length <= 4_000
    && !hasForbiddenControl(value, true)
    && !FORBIDDEN_UNICODE_RE.test(value);
}

function parseIsoTimestamp(value) {
  if (
    typeof value !== "string"
    || value.length > 40
    || !/^\d{4}-\d{2}-\d{2}T/u.test(value)
  ) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
    ? timestamp
    : null;
}

function valid(value) {
  return Object.freeze({ ok: true, value });
}

function invalid(reason) {
  return Object.freeze({ ok: false, reason });
}

export function validateAmoraScheduleCareFollowUpBinding(value) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["cardId", "cardRevision", "sourceRevision"])
    || typeof value.cardId !== "string"
    || !UUID_RE.test(value.cardId)
    || !isPositiveSafeInteger(value.cardRevision)
    || !isNonnegativeSafeInteger(value.sourceRevision)
  ) return invalid("binding");

  return valid(Object.freeze({
    cardId: value.cardId.toLowerCase(),
    cardRevision: value.cardRevision,
    sourceRevision: value.sourceRevision,
  }));
}

export function validateAmoraScheduleCareFollowUpPreview(value, expected) {
  if (
    !isRecord(expected)
    || !hasExactKeys(expected, ["recipientUserId", "coupleId", "nowMs"])
    || typeof expected.recipientUserId !== "string"
    || !UUID_RE.test(expected.recipientUserId)
    || typeof expected.coupleId !== "string"
    || !UUID_RE.test(expected.coupleId)
    || !isNonnegativeSafeInteger(expected.nowMs)
    || !isRecord(value)
    || !hasExactKeys(value, [
      "version",
      "state",
      "recipientUserId",
      "coupleId",
      "binding",
      "expiresAt",
      "prompt",
    ])
  ) return invalid("invalid");

  if (value.version !== AMORA_SCHEDULE_CARE_FOLLOW_UP_CONTRACT_VERSION) {
    return invalid("version");
  }
  if (value.state !== "ready") return invalid("state");
  if (value.recipientUserId !== expected.recipientUserId.toLowerCase()) {
    return invalid("owner");
  }
  if (value.coupleId !== expected.coupleId.toLowerCase()) {
    return invalid("couple");
  }
  const binding = validateAmoraScheduleCareFollowUpBinding(value.binding);
  if (!binding.ok) return invalid("binding");
  const expiresAtMs = parseIsoTimestamp(value.expiresAt);
  if (expiresAtMs === null || expiresAtMs <= expected.nowMs) {
    return invalid("expired");
  }
  if (!isSafeMultilinePrompt(value.prompt)) return invalid("prompt");

  return valid(Object.freeze({
    version: AMORA_SCHEDULE_CARE_FOLLOW_UP_CONTRACT_VERSION,
    state: "ready",
    recipientUserId: value.recipientUserId,
    coupleId: value.coupleId,
    binding: binding.value,
    expiresAt: value.expiresAt,
    prompt: value.prompt,
  }));
}

export function validateAmoraScheduleCareActionDraft(value) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["version", "title", "reason", "completionCriterion"])
    || value.version !== AMORA_SCHEDULE_CARE_FOLLOW_UP_CONTRACT_VERSION
    || !isSafeSingleLine(value.title, 120)
    || !isSafeSingleLine(value.reason, 220)
    || !isSafeSingleLine(value.completionCriterion, 220)
  ) return invalid("draft");

  return valid(Object.freeze({
    version: AMORA_SCHEDULE_CARE_FOLLOW_UP_CONTRACT_VERSION,
    title: value.title,
    reason: value.reason,
    completionCriterion: value.completionCriterion,
  }));
}

export function extractAmoraScheduleCareFollowUpAnswer(content, prompt) {
  if (
    typeof content !== "string"
    || !isSafeMultilinePrompt(prompt)
    || !content.startsWith(prompt)
  ) return null;
  const suffix = content.slice(prompt.length);
  if (Array.from(suffix).length > 4_001 || hasForbiddenControl(suffix, true)) return null;
  const answer = suffix.trim();
  return isSafeAnswer(answer) ? answer : null;
}

export const splitAmoraScheduleCareFollowUpAnswer =
  extractAmoraScheduleCareFollowUpAnswer;

export function buildAmoraScheduleCareFollowUpPrivateMetadata(binding) {
  const validation = validateAmoraScheduleCareFollowUpBinding(binding);
  if (!validation.ok) return null;
  return Object.freeze({
    version: AMORA_SCHEDULE_CARE_FOLLOW_UP_CONTRACT_VERSION,
    card_id: validation.value.cardId,
    card_revision: validation.value.cardRevision,
    source_revision: validation.value.sourceRevision,
  });
}

export function parseAmoraScheduleCareFollowUpPrivateMetadata(value) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["version", "card_id", "card_revision", "source_revision"])
    || value.version !== AMORA_SCHEDULE_CARE_FOLLOW_UP_CONTRACT_VERSION
  ) return null;
  const binding = validateAmoraScheduleCareFollowUpBinding({
    cardId: value.card_id,
    cardRevision: value.card_revision,
    sourceRevision: value.source_revision,
  });
  if (!binding.ok) return null;
  return Object.freeze({
    version: AMORA_SCHEDULE_CARE_FOLLOW_UP_CONTRACT_VERSION,
    card_id: binding.value.cardId,
    card_revision: binding.value.cardRevision,
    source_revision: binding.value.sourceRevision,
  });
}
