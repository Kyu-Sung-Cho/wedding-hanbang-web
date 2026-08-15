export const AMORA_ACTION_OUTCOME_FEEDBACK_CONTRACT_VERSION = 1;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION_ID_RE = /^[0-9A-Za-z_-]{1,200}$/;
const OUTCOMES = Object.freeze(["completed", "blocked", "changed", "not_sure"]);
const BLOCKER_CODES = Object.freeze(["time", "partner_check", "missing_info", "other"]);
const UNSAFE_DISPLAY_RE = /[\p{Cc}\p{Zl}\p{Zp}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u2060\u2061\u2062\u2063\u2064\u206A-\u206F\uFEFF]/u;
const UNSAFE_FORMAT_EXCEPT_ZWJ_RE = /(?!\u200D)\p{Cf}/u;
const BARE_ZWJ_RE = /(?:^|[^\p{Extended_Pictographic}])\u200D|\u200D(?:$|[^\p{Extended_Pictographic}])/u;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function isSafeTitle(value) {
  return typeof value === "string"
    && value.trim().length > 0
    && Array.from(value).length <= 120
    && !UNSAFE_DISPLAY_RE.test(value)
    && !UNSAFE_FORMAT_EXCEPT_ZWJ_RE.test(value)
    && !BARE_ZWJ_RE.test(value);
}

function timestampMs(value) {
  if (
    typeof value !== "string"
    || value.length > 40
    || !/^\d{4}-\d{2}-\d{2}T/u.test(value)
  ) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFeedback(value) {
  if (
    !UUID_RE.test(value.outcomeId)
    || typeof value.actionId !== "string"
    || !ACTION_ID_RE.test(value.actionId)
    || !isSafeTitle(value.actionTitle)
    || !isPositiveSafeInteger(value.sourceRevision)
    || !isPositiveSafeInteger(value.actionRevision)
    || !OUTCOMES.includes(value.outcome)
  ) return false;

  if (value.outcome === "blocked") {
    if (!BLOCKER_CODES.includes(value.blockerCode)) return false;
  } else if (value.blockerCode !== undefined) {
    return false;
  }

  if (value.outcome === "completed") {
    if (
      value.actionStatus !== "done"
      || value.actionRevision <= value.sourceRevision
    ) return false;
  } else if (
    value.actionStatus !== "open"
    || value.actionRevision !== value.sourceRevision
  ) {
    return false;
  }

  const recordedAtMs = timestampMs(value.recordedAt);
  const validUntilMs = timestampMs(value.validUntil);
  return recordedAtMs !== null
    && validUntilMs !== null
    && validUntilMs > recordedAtMs;
}

export function validateAmoraActionOutcomeFeedbackResponse(
  value,
  expectedRecipientUserId,
  expectedCoupleId,
  nowMs = Date.now(),
) {
  if (
    !UUID_RE.test(expectedRecipientUserId)
    || !UUID_RE.test(expectedCoupleId)
    || !Number.isFinite(nowMs)
    || !isRecord(value)
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (value.version !== AMORA_ACTION_OUTCOME_FEEDBACK_CONTRACT_VERSION) {
    return { ok: false, reason: "version" };
  }
  if (value.recipientUserId !== expectedRecipientUserId) {
    return { ok: false, reason: "owner" };
  }
  if (value.coupleId !== expectedCoupleId) {
    return { ok: false, reason: "couple" };
  }
  if (value.state !== "none" && value.state !== "ready") {
    return { ok: false, reason: "state" };
  }
  if (value.state === "none") {
    if (!hasOnlyKeys(value, ["version", "state", "recipientUserId", "coupleId"])) {
      return { ok: false, reason: "state" };
    }
  } else {
    if (!hasOnlyKeys(value, ["version", "state", "recipientUserId", "coupleId", "feedback"])) {
      return { ok: false, reason: "state" };
    }
    if (
      !isRecord(value.feedback)
      || !hasOnlyKeys(value.feedback, [
        "outcomeId",
        "actionId",
        "actionTitle",
        "sourceRevision",
        "actionRevision",
        "actionStatus",
        "outcome",
        "blockerCode",
        "recordedAt",
        "validUntil",
      ])
      || !isFeedback(value.feedback)
    ) {
      return { ok: false, reason: "feedback" };
    }
    const validUntilMs = timestampMs(value.feedback.validUntil);
    if (validUntilMs === null || validUntilMs <= nowMs) {
      return { ok: false, reason: "expired" };
    }
  }
  return { ok: true, value };
}
