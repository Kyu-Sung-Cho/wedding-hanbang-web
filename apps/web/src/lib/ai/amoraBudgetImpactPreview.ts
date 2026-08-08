import {
  BUDGET_IMPACT_TOOLS,
  parseBudgetImpactPreview,
  type BudgetCategoryImpact,
  type BudgetImpactPreview,
  type BudgetImpactSnapshot,
  type BudgetImpactTool,
  type BudgetImpactWarning,
} from "@hanbang/shared";
import {
  applyAmoraAtomicToolResultToContext,
  buildAmoraAtomicToolOperation,
} from "@/lib/ai/amoraAtomicToolOperation";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import { CATEGORY_LABELS } from "@/lib/ai/tools/planningConstants";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import { isValidWeddingWonAmount } from "@/lib/weddingBudget";

interface BudgetPreviewAction {
  tool: string;
  input: Record<string, unknown>;
  inputDigest: string;
}

interface BuildBudgetImpactPreviewInput {
  action: BudgetPreviewAction;
  sourceRevision: number;
  context: ToolExecutionContext;
}

interface CategorySnapshot {
  key: string;
  label: string;
  budget: number;
  recordedSpend: number;
}

interface JourneyBudgetSnapshot {
  summary: BudgetImpactSnapshot;
  categories: Map<string, CategorySnapshot>;
}

const BUDGET_TOOL_SET = new Set<string>(BUDGET_IMPACT_TOOLS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeCategoryLabel(key: string, value: Record<string, unknown>): string {
  const known = CATEGORY_LABELS[key];
  if (known) return known;
  const custom = value.label;
  if (
    typeof custom === "string"
    && custom === custom.trim()
    && custom.length > 0
    && custom.length <= 60
    && !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(custom)
  ) return custom;
  return "사용자 항목";
}

function addSafe(left: number, right: number): number | null {
  const sum = left + right;
  return Number.isSafeInteger(sum) ? sum : null;
}

function snapshotBudget(
  context: ToolExecutionContext,
): JourneyBudgetSnapshot | null {
  const totalBudget = context.weddingContext.budget;
  if (!isValidWeddingWonAmount(totalBudget)) return null;
  let allocatedBudget = 0;
  let recordedSpend = 0;
  const categories = new Map<string, CategorySnapshot>();
  for (const [key, candidate] of Object.entries(
    context.weddingContext.progress as Record<string, unknown>,
  )) {
    if (key.startsWith("__") || !isRecord(candidate)) continue;
    if (
      (candidate.budget !== undefined && !isValidWeddingWonAmount(candidate.budget))
      || (candidate.spent !== undefined && !isValidWeddingWonAmount(candidate.spent))
    ) return null;
    const budget = isValidWeddingWonAmount(candidate.budget)
      ? candidate.budget
      : 0;
    // `cost` is intentionally ignored. Only explicit `spent` is a recorded
    // amount, and even that is not proof that a payment was completed.
    const explicitSpent = isValidWeddingWonAmount(candidate.spent)
      ? candidate.spent
      : 0;
    const nextAllocated = addSafe(allocatedBudget, budget);
    const nextRecorded = addSafe(recordedSpend, explicitSpent);
    if (nextAllocated === null || nextRecorded === null) return null;
    allocatedBudget = nextAllocated;
    recordedSpend = nextRecorded;
    categories.set(key, {
      key,
      label: safeCategoryLabel(key, candidate),
      budget,
      recordedSpend: explicitSpent,
    });
  }
  const unallocatedBudget = totalBudget - allocatedBudget;
  if (!Number.isSafeInteger(unallocatedBudget)) return null;
  return {
    summary: {
      totalBudget,
      allocatedBudget,
      recordedSpend,
      unallocatedBudget,
    },
    categories,
  };
}

function cloneExecutionContext(context: ToolExecutionContext): ToolExecutionContext {
  return {
    ...context,
    weddingContext: {
      ...context.weddingContext,
      progress: structuredClone(context.weddingContext.progress),
    },
  };
}

function buildDelta(
  current: BudgetImpactSnapshot,
  proposed: BudgetImpactSnapshot,
): BudgetImpactSnapshot {
  return {
    totalBudget: proposed.totalBudget - current.totalBudget,
    allocatedBudget: proposed.allocatedBudget - current.allocatedBudget,
    recordedSpend: proposed.recordedSpend - current.recordedSpend,
    unallocatedBudget: proposed.unallocatedBudget - current.unallocatedBudget,
  };
}

function buildCategoryImpacts(
  current: JourneyBudgetSnapshot,
  proposed: JourneyBudgetSnapshot,
): BudgetCategoryImpact[] | null {
  const keys = [...new Set([
    ...current.categories.keys(),
    ...proposed.categories.keys(),
  ])].sort((left, right) => left.localeCompare(right));
  const impacts: BudgetCategoryImpact[] = [];
  for (const key of keys) {
    const before = current.categories.get(key);
    const after = proposed.categories.get(key);
    const currentBudget = before?.budget ?? 0;
    const proposedBudget = after?.budget ?? 0;
    const currentRecordedSpend = before?.recordedSpend ?? 0;
    const proposedRecordedSpend = after?.recordedSpend ?? 0;
    if (
      currentBudget === proposedBudget
      && currentRecordedSpend === proposedRecordedSpend
    ) continue;
    impacts.push({
      key,
      label: after?.label ?? before?.label ?? "사용자 항목",
      currentBudget,
      proposedBudget,
      currentRecordedSpend,
      proposedRecordedSpend,
    });
  }
  return impacts.length <= 40 ? impacts : null;
}

function buildWarnings(
  proposed: JourneyBudgetSnapshot,
): BudgetImpactWarning[] {
  const warnings: BudgetImpactWarning[] = [];
  if (proposed.summary.allocatedBudget > proposed.summary.totalBudget) {
    warnings.push("allocated_over_total");
  }
  if (proposed.summary.recordedSpend > proposed.summary.totalBudget) {
    warnings.push("recorded_spend_over_total");
  }
  if ([...proposed.categories.values()].some(
    (category) => category.budget > 0
      && category.recordedSpend > category.budget,
  )) {
    warnings.push("category_recorded_spend_over_budget");
  }
  return warnings;
}

/**
 * Replays the exact pure atomic operation against a cloned canonical context.
 * This prevents the preview from drifting away from what confirmation applies.
 */
export function buildAmoraBudgetImpactPreview({
  action,
  sourceRevision,
  context,
}: BuildBudgetImpactPreviewInput): BudgetImpactPreview | null {
  if (
    !BUDGET_TOOL_SET.has(action.tool)
    || !Number.isSafeInteger(sourceRevision)
    || sourceRevision < 0
  ) return null;
  let identity: ReturnType<typeof getAmoraToolOperationIdentity>;
  try {
    identity = getAmoraToolOperationIdentity(action.tool, action.input);
  } catch {
    return null;
  }
  if (identity.inputDigest !== action.inputDigest) return null;

  const current = snapshotBudget(context);
  if (!current) return null;
  const proposedContext = cloneExecutionContext(context);
  let operation: ReturnType<typeof buildAmoraAtomicToolOperation>;
  try {
    operation = buildAmoraAtomicToolOperation(
      action.tool,
      action.input,
      proposedContext,
      identity.operationKey,
    );
  } catch {
    return null;
  }
  if (!operation.result.success || operation.domainMutation.kind === "none") {
    return null;
  }
  applyAmoraAtomicToolResultToContext(operation.result, proposedContext);
  const proposed = snapshotBudget(proposedContext);
  if (!proposed) return null;
  const categories = buildCategoryImpacts(current, proposed);
  if (!categories) return null;

  const candidate: BudgetImpactPreview = {
    version: 1,
    kind: "budget_change",
    tool: action.tool as BudgetImpactTool,
    inputDigest: action.inputDigest,
    sourceRevision,
    recordedSpendBasis: "explicit_spent_only",
    current: current.summary,
    proposed: proposed.summary,
    delta: buildDelta(current.summary, proposed.summary),
    categories,
    warnings: buildWarnings(proposed),
  };
  return parseBudgetImpactPreview(candidate, {
    tool: action.tool,
    inputDigest: action.inputDigest,
    sourceRevision,
  });
}
