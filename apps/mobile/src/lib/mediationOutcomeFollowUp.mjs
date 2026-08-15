const OUTCOMES = new Set(["resolved", "changed", "blocked", "stop"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

export function buildMediationOutcomeBody(card, outcome) {
  if (
    !isRecord(card)
    || !hasOnlyKeys(card, ["id", "revision", "sourceDigest", "outcomeIdempotencyKey"])
    || typeof card.id !== "string"
    || !UUID_RE.test(card.id)
    || !Number.isSafeInteger(card.revision)
    || card.revision < 1
    || typeof card.sourceDigest !== "string"
    || !SHA256_RE.test(card.sourceDigest)
    || typeof card.outcomeIdempotencyKey !== "string"
    || !UUID_RE.test(card.outcomeIdempotencyKey)
    || typeof outcome !== "string"
    || !OUTCOMES.has(outcome)
  ) return null;
  return {
    cardId: card.id,
    cardRevision: card.revision,
    sourceDigest: card.sourceDigest,
    outcome,
    idempotencyKey: card.outcomeIdempotencyKey,
  };
}

export function isCurrentMediationOutcomeContext(captured, current) {
  return isRecord(captured)
    && isRecord(current)
    && typeof captured.ownerUserId === "string"
    && captured.ownerUserId === current.ownerUserId
    && typeof captured.coupleId === "string"
    && captured.coupleId === current.coupleId
    && Number.isSafeInteger(captured.sessionGeneration)
    && captured.sessionGeneration >= 0
    && captured.sessionGeneration === current.sessionGeneration;
}

export function matchCanonicalMediationOutcomeReceipt(posted, reread) {
  if (!isRecord(posted) || !isRecord(reread)) return null;
  const keys = [
    "id",
    "cardId",
    "cardRevision",
    "sourceDigest",
    "outcome",
    "recordedAt",
    "idempotencyKey",
  ];
  if (!hasOnlyKeys(posted, keys) || !hasOnlyKeys(reread, keys)) return null;
  const postedKeys = Object.keys(posted).sort();
  const rereadKeys = Object.keys(reread).sort();
  if (
    postedKeys.length !== rereadKeys.length
    || postedKeys.some((key, index) => key !== rereadKeys[index])
    || postedKeys.some((key) => posted[key] !== reread[key])
  ) return null;
  return reread;
}

export function isReceiptForMediationOutcomeRequest(receipt, request) {
  return isRecord(receipt)
    && isRecord(request)
    && receipt.cardId === request.cardId
    && receipt.cardRevision === request.cardRevision
    && receipt.sourceDigest === request.sourceDigest
    && receipt.outcome === request.outcome
    && receipt.idempotencyKey === request.idempotencyKey;
}

export function isMediationOutcomeCardAdvanced(previousCard, refreshed) {
  if (!isRecord(previousCard) || !isRecord(refreshed)) return false;
  if (refreshed.state === "none") return true;
  if (refreshed.state !== "ready" || !isRecord(refreshed.card)) return false;
  return typeof previousCard.id === "string"
    && typeof previousCard.sourceDigest === "string"
    && typeof refreshed.card.id === "string"
    && typeof refreshed.card.sourceDigest === "string"
    && refreshed.card.id !== previousCard.id
    && refreshed.card.sourceDigest !== previousCard.sourceDigest;
}

export function resolveMediationOutcomeSurface(status, validatedState) {
  return status === 200 && validatedState === "ready" ? "ready" : "fallback";
}
