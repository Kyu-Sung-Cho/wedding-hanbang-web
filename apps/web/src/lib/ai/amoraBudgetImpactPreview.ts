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
import { SCREEN_CATEGORY_LABELS } from "@/lib/ai/tools/planningConstants";
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

/** 변경 영향 미리보기를 내는 예산 도구인가. 거절 사유 관측(`budget_operation_refused`)에 쓴다. */
export function isAmoraBudgetImpactTool(tool: string): boolean {
  return BUDGET_TOOL_SET.has(tool);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// 카드의 "변경 영향" 은 사용자가 예산 화면과 나란히 읽는 곳이라 화면 이름을 쓴다.
// 모델 문맥용 원명칭(예단·폐백)을 쓰면 같은 행인지 알아볼 수 없다(2026-09-15).
function safeCategoryLabel(key: string, value: Record<string, unknown>): string {
  if (Object.hasOwn(SCREEN_CATEGORY_LABELS, key)) return SCREEN_CATEGORY_LABELS[key];
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
  const progress = context.weddingContext.progress as Record<string, unknown>;
  const hiddenKeys = new Set(Array.isArray(progress.__hidden) ? progress.__hidden : []);
  for (const [key, candidate] of Object.entries(
    progress,
  )) {
    if (key.startsWith("__") || !isRecord(candidate)) continue;
    if (Object.hasOwn(SCREEN_CATEGORY_LABELS, key) && hiddenKeys.has(key)) continue;
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
  // **총예산을 아직 안 정한 커플에게 초과라고 말하지 않는다.**
  //
  // 신규 커플의 총예산은 0이다(`journey?.total_budget ?? 0`). 그 상태에서
  // 첫 항목 예산을 잡으면 배분 합계가 0보다 커지므로 이 두 경고가 무조건
  // 뜬다 — 첫 저장 카드에서 "총예산보다 커요" 를 보게 된다.
  //
  // 아직 정하지 않은 것을 넘었다고 말할 수는 없다. 총예산이 실제로 잡힌
  // 뒤부터 비교한다. 2026-08-25 적대적 검토.
  const totalBudgetIsSet = proposed.summary.totalBudget > 0;
  if (
    totalBudgetIsSet
    && proposed.summary.allocatedBudget > proposed.summary.totalBudget
  ) {
    warnings.push("allocated_over_total");
  }
  if (
    totalBudgetIsSet
    && proposed.summary.recordedSpend > proposed.summary.totalBudget
  ) {
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

export interface AmoraBudgetProposalRefusal {
  /** 순수 연산이 돌려준 고정 오류 코드. 원장·로그에 원문 대신 남길 수 있다. */
  error: string;
  /** 사용자에게 그대로 보여줄 서버 소유 문장. 어떤 항목이 왜 막혔는지 말한다. */
  text: string;
}

// 거절이 아니라 "이미 그 값" 인 경우. 카드 발급 여부는 이 함수가 정하지 않는다.
const NOT_A_REFUSAL = new Set(["no_change"]);

/**
 * 예산 도구 밖에서 카드 발급 전에 거르는 도구와, 거를 거절 코드(리뷰 [2]).
 *
 * 순수 연산이 **같은 정본 문맥만으로** 결론을 내는 거절만 적는다. 승인 때의 실행도 이 문맥의
 * 리비전에 묶여 있어(그 사이 계획이 바뀌면 적용이 따로 거절된다) 발급 때와 결론이 같다.
 * 적지 않은 코드 — 변경하는 구성원 확인(`schedule_actor_missing`)처럼 실행 때의 사정에 달린
 * 것, 입력 모양 오류처럼 표식 검증이 먼저 걸러야 할 것 — 은 지금처럼 카드를 낸다.
 * `update_task_status` 는 넣지 않는다. 체크리스트를 따르는 분야의 거절 문장이 "남은 항목을
 * 완료로 표시해 드릴까요?" 로 되묻는 말이라, 카드 자리에 그대로 두면 누를 곳 없는 제안이 된다.
 */
const AUTHORITATIVE_REFUSALS_BY_TOOL: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["toggle_checklist_item", new Set(["progress_state_invalid", "checklist_item_not_found"])],
  ...(["update_schedule_event", "cancel_schedule_event", "restore_schedule_event"] as const).map(
    (tool) => [tool, new Set([
      "schedule_state_invalid",
      "schedule_event_not_found",
      "schedule_event_cancelled",
      "schedule_event_not_cancelled",
      "schedule_target_changed",
    ])] as const,
  ),
]);

/**
 * 확인 카드를 내기 전에, 누르면 적용될 순수 연산을 같은 정본 문맥으로 미리 돌려 본다.
 *
 * 2026-09-15 운영 재현: 연산이 거절할 것이 확실한 예산안에도 카드가 나갔고, 사용자가
 * 카드를 누른 **뒤에야** "현재 예산 데이터에 확인이 필요한 상태가 있어 예산안을 적용하지
 * 않았어요" 를 받았다. 누를 수 있게 내놓고 누르면 거절하는 것은 약속을 어기는 것이다.
 * 그래서 연산이 실제로 거절하면(같은 값이라 바뀔 게 없는 경우는 제외) 그 거절 문장을
 * 카드 대신 지금 보여준다.
 *
 * 이 함수는 원본 문맥을 바꾸지 않는다. 연산이 예외를 던지면 판단을 하지 않고 null 을
 * 돌려준다 — 그 경우의 처리(카드 발급·미리보기 생략)는 기존 경로가 그대로 정한다.
 *
 * 이름과 달리 예산 도구만 보지 않는다(리뷰 [2]). '안 해요'로 끈 분야의 체크, 취소된 일정을
 * 옮기기·다시 취소하기, 취소되지 않은 일정 복원, 저장값과 다른 제목의 취소도 누른 뒤에야
 * 거절됐다. 그 도구들은 `AUTHORITATIVE_REFUSALS_BY_TOOL` 에 적은 거절만 거른다.
 */
export function findAmoraBudgetProposalRefusal({
  action,
  context,
}: {
  action: { tool: string; input: Record<string, unknown> };
  context: ToolExecutionContext;
}): AmoraBudgetProposalRefusal | null {
  const authoritativeRefusals = AUTHORITATIVE_REFUSALS_BY_TOOL.get(action.tool);
  if (!BUDGET_TOOL_SET.has(action.tool) && !authoritativeRefusals) return null;
  let operation: ReturnType<typeof buildAmoraAtomicToolOperation>;
  try {
    operation = buildAmoraAtomicToolOperation(
      action.tool,
      structuredClone(action.input),
      cloneExecutionContext(context),
      getAmoraToolOperationIdentity(action.tool, action.input).operationKey,
    );
  } catch {
    return null;
  }
  if (operation.result.success) return null;
  const output = operation.result.toolOutput;
  const error = isRecord(output) && typeof output.error === "string" ? output.error : null;
  if (error === null || NOT_A_REFUSAL.has(error)) return null;
  if (authoritativeRefusals && !authoritativeRefusals.has(error)) return null;
  const message = (operation.result.displayMessage ?? "").trim();
  if (!message) return null;
  return {
    error,
    // "다시 확인해 주세요" 로만 끝나는 거절도 있다. 저장 여부를 추측하게 두지 않는다.
    text: /않았어요/u.test(message) ? message : `${message} 아직 반영하지 않았어요.`,
  };
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
