const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

export function buildVerifiedChecklistDeepLink(input) {
  if (
    !isRecord(input)
    || input.checklistOnly !== true
    || typeof input.requestedCategoryKey !== "string"
    || !Array.isArray(input.availableCategoryKeys)
    || !isRecord(input.verifiedIdentity)
  ) return null;

  const ownerId = normalizeUuid(input.verifiedIdentity.ownerId);
  const coupleId = normalizeUuid(input.verifiedIdentity.coupleId);
  const categoryKey = input.requestedCategoryKey;
  if (
    !ownerId
    || !coupleId
    || categoryKey.length < 1
    || categoryKey.length > 64
    || !input.availableCategoryKeys.includes(categoryKey)
  ) return null;

  return {
    categoryKey,
    handledKey: `${ownerId}:${coupleId}:${categoryKey}`,
  };
}

export function buildVerifiedChecklistDeepLinkFocusTarget(input) {
  if (!isRecord(input) || !isRecord(input.deepLink)) return null;

  const { categoryKey, handledKey } = input.deepLink;
  if (
    typeof categoryKey !== "string"
    || categoryKey.length < 1
    || categoryKey.length > 64
    || typeof handledKey !== "string"
    || handledKey.length < 1
    || handledKey.length > 256
    || input.laidOutCategoryKey !== categoryKey
    || input.focusedHandledKey === handledKey
    || typeof input.layoutY !== "number"
    || !Number.isFinite(input.layoutY)
    || input.layoutY < 0
  ) return null;

  return Object.freeze({
    categoryKey,
    handledKey,
    scrollY: Math.max(0, input.layoutY - 8),
  });
}
