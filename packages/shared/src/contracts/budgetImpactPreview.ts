export const BUDGET_IMPACT_PREVIEW_VERSION = 1 as const;

export const BUDGET_IMPACT_TOOLS = [
  "update_budget",
  "update_category_budget",
  "apply_budget_plan",
  "add_custom_category",
] as const;

export type BudgetImpactTool = (typeof BUDGET_IMPACT_TOOLS)[number];

export type BudgetImpactWarning =
  | "allocated_over_total"
  | "recorded_spend_over_total"
  | "category_recorded_spend_over_budget";

export interface BudgetImpactSnapshot {
  totalBudget: number;
  allocatedBudget: number;
  recordedSpend: number;
  unallocatedBudget: number;
}

export interface BudgetCategoryImpact {
  key: string;
  label: string;
  currentBudget: number;
  proposedBudget: number;
  currentRecordedSpend: number;
  proposedRecordedSpend: number;
}

export interface BudgetImpactPreview {
  version: typeof BUDGET_IMPACT_PREVIEW_VERSION;
  kind: "budget_change";
  tool: BudgetImpactTool;
  inputDigest: string;
  sourceRevision: number;
  /** Only an explicit `spent` value counts; legacy `cost` is never payment evidence. */
  recordedSpendBasis: "explicit_spent_only";
  current: BudgetImpactSnapshot;
  proposed: BudgetImpactSnapshot;
  delta: BudgetImpactSnapshot;
  categories: BudgetCategoryImpact[];
  warnings: BudgetImpactWarning[];
}

export interface BudgetImpactPreviewBinding {
  tool: string;
  inputDigest: string;
  sourceRevision: number;
}

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const CATEGORY_KEY_PATTERN = /^[a-z0-9_-]{1,80}$/i;
const UNSAFE_TEXT_PATTERN = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const TOOL_SET = new Set<string>(BUDGET_IMPACT_TOOLS);
const WARNING_SET = new Set<BudgetImpactWarning>([
  "allocated_over_total",
  "recorded_spend_over_total",
  "category_recorded_spend_over_budget",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSignedSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function parseSnapshot(
  value: unknown,
  signed: boolean,
): BudgetImpactSnapshot | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "totalBudget",
    "allocatedBudget",
    "recordedSpend",
    "unallocatedBudget",
  ])) return null;
  const moneyGuard = signed ? isSignedSafeInteger : isNonNegativeSafeInteger;
  if (
    !moneyGuard(value.totalBudget)
    || !moneyGuard(value.allocatedBudget)
    || !moneyGuard(value.recordedSpend)
    || !isSignedSafeInteger(value.unallocatedBudget)
  ) return null;
  if (
    !signed
    && value.unallocatedBudget !== value.totalBudget - value.allocatedBudget
  ) return null;
  return value as unknown as BudgetImpactSnapshot;
}

function parseCategory(value: unknown): BudgetCategoryImpact | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "key",
    "label",
    "currentBudget",
    "proposedBudget",
    "currentRecordedSpend",
    "proposedRecordedSpend",
  ])) return null;
  if (
    typeof value.key !== "string"
    || !CATEGORY_KEY_PATTERN.test(value.key)
    || typeof value.label !== "string"
    || value.label !== value.label.trim()
    || value.label.length < 1
    || value.label.length > 60
    || UNSAFE_TEXT_PATTERN.test(value.label)
    || !isNonNegativeSafeInteger(value.currentBudget)
    || !isNonNegativeSafeInteger(value.proposedBudget)
    || !isNonNegativeSafeInteger(value.currentRecordedSpend)
    || !isNonNegativeSafeInteger(value.proposedRecordedSpend)
    || (
      value.currentBudget === value.proposedBudget
      && value.currentRecordedSpend === value.proposedRecordedSpend
    )
  ) return null;
  return value as unknown as BudgetCategoryImpact;
}

/**
 * Parses persisted assistant metadata as an untrusted boundary and binds it to
 * the exact pending action plus the proposal-time journey revision.
 */
export function parseBudgetImpactPreview(
  value: unknown,
  binding: BudgetImpactPreviewBinding,
): BudgetImpactPreview | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version",
    "kind",
    "tool",
    "inputDigest",
    "sourceRevision",
    "recordedSpendBasis",
    "current",
    "proposed",
    "delta",
    "categories",
    "warnings",
  ])) return null;
  if (
    value.version !== BUDGET_IMPACT_PREVIEW_VERSION
    || value.kind !== "budget_change"
    || typeof value.tool !== "string"
    || !TOOL_SET.has(value.tool)
    || value.tool !== binding.tool
    || typeof value.inputDigest !== "string"
    || !SHA256_HEX_PATTERN.test(value.inputDigest)
    || value.inputDigest !== binding.inputDigest
    || !isNonNegativeSafeInteger(value.sourceRevision)
    || value.sourceRevision !== binding.sourceRevision
    || value.recordedSpendBasis !== "explicit_spent_only"
  ) return null;

  const current = parseSnapshot(value.current, false);
  const proposed = parseSnapshot(value.proposed, false);
  const delta = parseSnapshot(value.delta, true);
  if (!current || !proposed || !delta) return null;
  for (const key of [
    "totalBudget",
    "allocatedBudget",
    "recordedSpend",
    "unallocatedBudget",
  ] as const) {
    if (delta[key] !== proposed[key] - current[key]) return null;
  }

  if (!Array.isArray(value.categories) || value.categories.length > 40) {
    return null;
  }
  const categories = value.categories.map(parseCategory);
  if (categories.some((category) => category === null)) return null;
  const categoryKeys = categories.map((category) => category!.key);
  if (new Set(categoryKeys).size !== categoryKeys.length) return null;

  if (!Array.isArray(value.warnings) || value.warnings.length > 3) return null;
  const warnings = value.warnings;
  if (
    warnings.some(
      (warning): boolean => typeof warning !== "string"
        || !WARNING_SET.has(warning as BudgetImpactWarning),
    )
    || new Set(warnings).size !== warnings.length
  ) return null;

  if (
    current.totalBudget === proposed.totalBudget
    && current.allocatedBudget === proposed.allocatedBudget
    && current.recordedSpend === proposed.recordedSpend
    && categories.length === 0
  ) return null;

  return value as unknown as BudgetImpactPreview;
}
