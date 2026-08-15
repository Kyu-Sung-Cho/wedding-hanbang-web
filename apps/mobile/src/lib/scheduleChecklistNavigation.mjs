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
