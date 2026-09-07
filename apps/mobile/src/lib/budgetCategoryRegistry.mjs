const CUSTOM_CATEGORY_KEY = /^custom_[a-z0-9_-]{1,64}$/i;
const UNSAFE_LABEL_CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

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
 * Keeps visible fixed wedding categories first and appends only canonical custom
 * budget rows. Hidden amounts stay stored; other metadata never enters totals.
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
  const hiddenKeys = new Set(Array.isArray(progress.__hidden)
    ? progress.__hidden.filter(key => typeof key === "string")
    : []);
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

  return [...fixed.filter(category => !hiddenKeys.has(category.key)), ...custom];
}
