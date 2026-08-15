const CUSTOM_CATEGORY_KEY = /^custom_[a-z0-9_-]{1,64}$/i;
const UNSAFE_LABEL_CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYER_TYPES = new Set([
  "couple",
  "bride_parents",
  "groom_parents",
  "both_parents",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function customLabel(value) {
  if (typeof value !== "string") return "사용자 항목";
  const normalized = value.trim();
  if (
    normalized.length === 0
    || Array.from(normalized).length > 80
    || UNSAFE_LABEL_CONTROL.test(normalized)
  ) return "사용자 항목";
  return normalized;
}

/**
 * Resolves a route query against the fixed budget registry without coercion.
 * Custom rows are intentionally excluded because a deep link must name one
 * stable planning category that exists for every verified journey.
 */
export function resolveCanonicalBudgetCategoryDeepLink(
  requestedCategory,
  fixedCategories,
) {
  if (typeof requestedCategory !== "string" || !Array.isArray(fixedCategories)) {
    return null;
  }

  let match = null;
  for (const category of fixedCategories) {
    if (
      !isRecord(category)
      || typeof category.key !== "string"
      || typeof category.label !== "string"
    ) return null;
    if (category.key !== requestedCategory) continue;
    if (match !== null) return null;
    match = category.key;
  }
  return match;
}

function exactManwonEditorInput(value) {
  if (value === undefined || value === 0) return "";
  if (
    !Number.isSafeInteger(value)
    || value < 0
    || value > 1_000_000_000
    || value % 10_000 !== 0
  ) return null;
  return String(value / 10_000);
}

/**
 * Builds the existing editor's local fields from a coordinator-verified
 * identity. It never accepts an amount that the manwon editor would round.
 */
export function buildVerifiedBudgetCategoryEditor({
  requestedCategory,
  fixedCategories,
  verifiedIdentity,
}) {
  const categoryKey = resolveCanonicalBudgetCategoryDeepLink(
    requestedCategory,
    fixedCategories,
  );
  if (
    categoryKey === null
    || !isRecord(verifiedIdentity)
    || !Number.isSafeInteger(verifiedIdentity.generation)
    || verifiedIdentity.generation < 0
    || typeof verifiedIdentity.ownerId !== "string"
    || !UUID_PATTERN.test(verifiedIdentity.ownerId)
    || typeof verifiedIdentity.coupleId !== "string"
    || !UUID_PATTERN.test(verifiedIdentity.coupleId)
    || !Number.isSafeInteger(verifiedIdentity.totalBudget)
    || verifiedIdentity.totalBudget < 0
    || verifiedIdentity.totalBudget > 1_000_000_000
    || !Number.isSafeInteger(verifiedIdentity.stateRevision)
    || verifiedIdentity.stateRevision < 0
    || !isRecord(verifiedIdentity.progress)
  ) return null;

  const storedItem = verifiedIdentity.progress[categoryKey];
  if (storedItem !== undefined && !isRecord(storedItem)) return null;
  const item = storedItem ?? {};
  const payerInput = item.payer ?? "couple";
  if (!PAYER_TYPES.has(payerInput)) return null;
  const budgetInput = exactManwonEditorInput(item.budget);
  const spentInput = exactManwonEditorInput(item.spent);
  if (budgetInput === null || spentInput === null) return null;

  return {
    categoryKey,
    editBase: {
      ownerId: verifiedIdentity.ownerId.toLowerCase(),
      coupleId: verifiedIdentity.coupleId.toLowerCase(),
      stateRevision: verifiedIdentity.stateRevision,
    },
    budgetInput,
    spentInput,
    payerInput,
  };
}

/**
 * Keeps the fixed wedding categories first and appends only canonical custom
 * budget rows. Other progress metadata must never affect money totals.
 */
export function listBudgetCategories({ fixedCategories, progress }) {
  if (!Array.isArray(fixedCategories) || !isRecord(progress)) {
    throw new Error("INVALID_BUDGET_CATEGORY_REGISTRY_INPUT");
  }

  const fixed = fixedCategories.map((category) => {
    if (
      !isRecord(category)
      || typeof category.key !== "string"
      || category.key.length === 0
      || typeof category.label !== "string"
      || category.label.length === 0
    ) throw new Error("INVALID_FIXED_BUDGET_CATEGORY");
    return { key: category.key, label: category.label };
  });
  const fixedKeys = new Set(fixed.map((category) => category.key));
  const custom = Object.entries(progress)
    .filter(([key, value]) => (
      !fixedKeys.has(key)
      && CUSTOM_CATEGORY_KEY.test(key)
      && isRecord(value)
    ))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({
      key,
      label: customLabel(value.label),
    }));

  return [...fixed, ...custom];
}
