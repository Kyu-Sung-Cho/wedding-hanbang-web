const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TODAY_ONE_ACTIONS = new Set([
  "open_source",
  "snooze",
  "dismiss",
  "mute_source",
]);

const TODAY_ONE_NATIVE_KIND_PRESENTATIONS = Object.freeze({
  schedule_moment: Object.freeze({ recordLabel: "일정", icon: "schedule" }),
  budget_guardrail: Object.freeze({ recordLabel: "예산", icon: "budget" }),
  decision_follow_up: Object.freeze({ recordLabel: "결정", icon: "decision" }),
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isBoundedText(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isIsoTimestamp(value) {
  return typeof value === "string"
    && value.length <= 40
    && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && Number.isFinite(Date.parse(value));
}

export function canRenderTodayOneFallback(
  expectedOwnerUserId,
  verifiedOwnerUserId,
  expectedCoupleId,
  verifiedCoupleId,
) {
  return typeof expectedOwnerUserId === "string"
    && typeof verifiedOwnerUserId === "string"
    && typeof expectedCoupleId === "string"
    && typeof verifiedCoupleId === "string"
    && UUID_RE.test(expectedOwnerUserId)
    && UUID_RE.test(verifiedOwnerUserId)
    && UUID_RE.test(expectedCoupleId)
    && UUID_RE.test(verifiedCoupleId)
    && expectedOwnerUserId.toLowerCase() === verifiedOwnerUserId.toLowerCase()
    && expectedCoupleId.toLowerCase() === verifiedCoupleId.toLowerCase();
}

export function parseTodayOneEnvelope(value) {
  if (!isRecord(value)) return null;
  if (value.available === false) {
    return Object.keys(value).length === 1 ? { available: false } : null;
  }
  if (
    value.available !== true
    || !("result" in value)
    || !hasOnlyKeys(value, ["available", "result", "error", "code"])
    || (value.error !== undefined && !isBoundedText(value.error, 240))
    || (value.code !== undefined && !isBoundedText(value.code, 80))
  ) {
    return null;
  }
  return {
    available: true,
    result: value.result,
    ...(value.error === undefined ? {} : { error: value.error }),
    ...(value.code === undefined ? {} : { code: value.code }),
  };
}

function parsePreference(value) {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ["enabled", "optedInAt", "pausedUntil", "dailyLimit"])
    || typeof value.enabled !== "boolean"
    || value.dailyLimit !== 1
    || !(value.optedInAt === null || isIsoTimestamp(value.optedInAt))
    || !(value.pausedUntil === null || isIsoTimestamp(value.pausedUntil))
    || value.enabled !== (value.optedInAt !== null)
    || (value.pausedUntil !== null && !value.enabled)
  ) {
    return null;
  }
  return {
    enabled: value.enabled,
    optedInAt: value.optedInAt,
    pausedUntil: value.pausedUntil,
    dailyLimit: 1,
  };
}

export function parseTodayOnePreferenceEnvelope(value) {
  if (!isRecord(value)) return null;
  if (value.available === false) {
    return Object.keys(value).length === 1 ? { available: false } : null;
  }
  if (
    value.available !== true
    || !hasOnlyKeys(value, ["available", "preference"])
  ) {
    return null;
  }
  const preference = parsePreference(value.preference);
  return preference ? { available: true, preference } : null;
}

/**
 * 공유 계약의 surface 값을 이 앱이 실제로 열 수 있는 화면 경로로 옮긴다.
 *
 * `/dashboard` 는 서버가 내려주는 계약값이고 웹도 같은 문자열을 쓴다. 그래서 계약은
 * 그대로 두고, 여는 순간에만 이 앱의 화면 이름으로 바꾼다 — 첫 화면이 `dashboard` 에서
 * `웨딩 라운지` 로 합쳐졌고(파운더 결정, CLAUDE.md) `(tabs)/dashboard` 라우트는 없다.
 * 이 매핑이 없으면 "오늘의 한 가지"의 원본 열기가 존재하지 않는 화면으로 간다.
 */
export function getTodayOneNativeRoute(href) {
  if (href === "/schedule" || href === "/budget") return href;
  if (href === "/dashboard") return "/(tabs)/lounge";
  return null;
}

export function getTodayOneNativeKindPresentation(kind) {
  return typeof kind === "string"
    && Object.prototype.hasOwnProperty.call(TODAY_ONE_NATIVE_KIND_PRESENTATIONS, kind)
    ? TODAY_ONE_NATIVE_KIND_PRESENTATIONS[kind]
    : null;
}

export function isTodayOneCareCardCurrent(card, nowMs = Date.now()) {
  if (!isRecord(card) || !Number.isFinite(nowMs) || !isIsoTimestamp(card.expiresAt)) {
    return false;
  }
  return Date.parse(card.expiresAt) > nowMs;
}

function isSafeRevision(value, minimum) {
  return Number.isSafeInteger(value) && value >= minimum;
}

export function buildTodayOneActionBody(card, action) {
  if (
    !isRecord(card)
    || !hasOnlyKeys(card, ["id", "revision", "sourceRevision"])
    || typeof card.id !== "string"
    || !UUID_RE.test(card.id)
    || !isSafeRevision(card.revision, 1)
    || !isSafeRevision(card.sourceRevision, 0)
    || typeof action !== "string"
    || !TODAY_ONE_ACTIONS.has(action)
  ) {
    return null;
  }
  return {
    cardId: card.id,
    expectedRevision: card.revision,
    expectedSourceRevision: card.sourceRevision,
    action,
  };
}
