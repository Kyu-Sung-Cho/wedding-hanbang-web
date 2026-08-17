const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION_ID_PATTERN = /^[0-9A-Za-z_-]{1,200}$/u;
const ACTION_REVISION_PATTERN = /^[1-9][0-9]{0,14}$/u;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function normalizeActionRevision(value) {
  if (value === "none") return null;
  if (typeof value !== "string" || !ACTION_REVISION_PATTERN.test(value)) return undefined;
  const revision = Number(value);
  return Number.isSafeInteger(revision) ? revision : undefined;
}

export function buildChecklistDeepLinkParams(input) {
  if (
    !isRecord(input)
    || typeof input.categoryKey !== "string"
    || input.categoryKey.length < 1
    || input.categoryKey.length > 64
  ) return null;

  const hasActionId = Object.hasOwn(input, "actionId");
  const hasActionRevision = Object.hasOwn(input, "actionRevision");
  if (hasActionId !== hasActionRevision) return null;
  if (!hasActionId) return Object.freeze({ category: input.categoryKey });
  if (
    typeof input.actionId !== "string"
    || !ACTION_ID_PATTERN.test(input.actionId)
    || (
      input.actionRevision !== null
      && (
        !Number.isSafeInteger(input.actionRevision)
        || input.actionRevision < 1
      )
    )
  ) return null;

  return Object.freeze({
    category: input.categoryKey,
    action: input.actionId,
    actionRevision: input.actionRevision === null
      ? "none"
      : String(input.actionRevision),
  });
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

  const hasActionId = input.requestedActionId !== undefined;
  const hasActionRevision = input.requestedActionRevision !== undefined;
  if (hasActionId !== hasActionRevision) return null;

  if (hasActionId) {
    const actionId = input.requestedActionId;
    const actionRevision = normalizeActionRevision(input.requestedActionRevision);
    if (
      typeof actionId !== "string"
      || !ACTION_ID_PATTERN.test(actionId)
      || actionRevision === undefined
      || !Array.isArray(input.availableActions)
    ) return null;

    const matchingActions = input.availableActions.filter((action) => (
      isRecord(action)
      && action.id === actionId
      && action.categoryKey === categoryKey
      && action.sourceRevision === actionRevision
    ));
    if (matchingActions.length !== 1) return null;

    return {
      categoryKey,
      actionId,
      actionRevision,
      handledKey: `${ownerId}:${coupleId}:${categoryKey}:${actionId}:${actionRevision ?? "none"}`,
    };
  }

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
