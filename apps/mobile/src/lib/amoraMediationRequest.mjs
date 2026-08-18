const MIN_SUMMARY_CHARS = 4;
const MAX_SUMMARY_CHARS = 600;
const DISMISSAL_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DISMISSED_OFFERS = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function normalizeAmoraMediationSummary(value) {
  if (typeof value !== "string") return { ok: false, reason: "invalid" };
  const summary = value.trim();
  if (summary.length < MIN_SUMMARY_CHARS) return { ok: false, reason: "too_short" };
  if (summary.length > MAX_SUMMARY_CHARS) return { ok: false, reason: "too_long" };
  return { ok: true, summary };
}

export function buildAmoraMediationRequestBody(input) {
  const normalized = normalizeAmoraMediationSummary(input?.summary);
  if (!normalized.ok) throw new Error("AMORA_MEDIATION_SUMMARY_INVALID");
  if (input?.senderRole !== "bride" && input?.senderRole !== "groom") {
    throw new Error("AMORA_MEDIATION_ROLE_INVALID");
  }
  const roleLabel = input.memberModelVersion === 2
    ? "사용자"
    : input.senderRole === "bride"
      ? "신부"
      : "신랑";
  return {
    messages: [{
      role: "user",
      content: `[${roleLabel}] [MEDIATION_REQUEST] 내가 직접 작성한 조율 요청 요약: ${normalized.summary}`,
    }],
    coupleId: input.coupleId,
    senderName: input.senderName,
    clientRequestId: input.clientRequestId,
    requestKind: "mediation",
    conflictContext: normalized.summary,
    visibility: input.senderRole === "groom" ? "groom_private" : "bride_private",
  };
}

function normalizeOwnerId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeOfferKeys(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((key) => (
    typeof key === "string"
    && key.startsWith("mediation-offer:v1:")
    && key.length <= 512
  )))].slice(-MAX_DISMISSED_OFFERS);
}

export function createAmoraMediationDismissalRecord(input) {
  const userId = normalizeOwnerId(input?.userId);
  const coupleId = normalizeOwnerId(input?.coupleId);
  const offerKeys = normalizeOfferKeys(input?.offerKeys);
  const dismissedAt = Number.isFinite(input?.nowMs) ? input.nowMs : Date.now();
  if (!userId || !coupleId) throw new Error("AMORA_MEDIATION_DISMISSAL_OWNER_INVALID");
  return JSON.stringify({
    version: 1,
    userId,
    coupleId,
    dismissedAt,
    offerKeys,
  });
}

export function parseAmoraMediationDismissalRecord(raw, expected) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 12_000) return [];
  const expectedUserId = normalizeOwnerId(expected?.userId);
  const expectedCoupleId = normalizeOwnerId(expected?.coupleId);
  const nowMs = Number.isFinite(expected?.nowMs) ? expected.nowMs : Date.now();
  if (!expectedUserId || !expectedCoupleId) return [];
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    if (
      value.version !== 1
      || normalizeOwnerId(value.userId) !== expectedUserId
      || normalizeOwnerId(value.coupleId) !== expectedCoupleId
      || !Number.isFinite(value.dismissedAt)
      || value.dismissedAt > nowMs + (5 * 60 * 1000)
      || nowMs - value.dismissedAt > DISMISSAL_TTL_MS
    ) return [];
    return normalizeOfferKeys(value.offerKeys);
  } catch {
    return [];
  }
}
