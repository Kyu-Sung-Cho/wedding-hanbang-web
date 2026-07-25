import { createHash } from "node:crypto";
import type { ToolExecutionResult } from "@/types/database.types";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import { formatWon } from "@/lib/ai/tools/toolTypes";
import {
  inspectScheduleEvents,
  getEvents,
  ScheduleEventCapacityError,
  ScheduleEventValidationError,
  updateEvent,
  upsertCategoryEvent,
  upsertMomentEvent,
} from "@/utils/scheduleEvents";
import {
  CATEGORY_LABELS,
  CATEGORY_RATIOS,
  STATUS_LABELS,
} from "@/lib/ai/tools/planningConstants";
import type { ScheduleEvent } from "@/types/database.types";
import { CHECKLIST_MAP } from "@/constants/checklists";
import { MOMENTS, type MomentType } from "@/constants/moments";
import { calculateStatus, mergeChecklist } from "@/utils/checklist";
import { isValidScheduleYmd } from "@/utils/scheduleEvents";
import {
  kstMidnightFromYmd,
  todayKstMidnight,
  ymdInKst,
} from "@/lib/utils/kstDate";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import { isValidWeddingWonAmount } from "@/lib/weddingBudget";
const MAX_VENUE_CHARS = 200;
const MAX_ACTION_TITLE_CHARS = 120;
const MAX_ACTION_DESCRIPTION_CHARS = 500;
const MAX_ACTION_HREF_CHARS = 180;
const MAX_ACTION_DUE_DATE_CHARS = 40;

const ACTION_PRIORITIES = new Set(["high", "medium", "low"]);
const ACTION_STATUSES = new Set(["open", "done", "dismissed"]);
const ACTION_SOURCES = new Set([
  "chat",
  "quote",
  "schedule",
  "budget",
  "guardrail",
  "manual",
]);
const PROGRESS_STATUSES = new Set(["not_started", "in_progress", "completed"]);

export const AMORA_ATOMIC_TOOL_NAMES = new Set([
  "update_budget",
  "update_wedding_date",
  "update_task_status",
  "update_venue",
  "update_category_budget",
  "apply_budget_plan",
  "add_custom_category",
  "add_schedule_event",
  "update_schedule_event",
  "delete_schedule_event",
  "toggle_checklist_item",
  "add_amora_action",
  "log_wedding_event",
  "update_amora_action",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeOptionalText(value: unknown, maxChars: number): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") return null;
  const normalized = normalizeWhitespace(value).slice(0, maxChars);
  return normalized || null;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function journeyProgressEntryMutation(
  key: string,
  value: Record<string, unknown>,
  context: ToolExecutionContext,
): Record<string, unknown> | null {
  const progress = context.weddingContext.progress as Record<string, unknown>;
  const expectedPresent = Object.prototype.hasOwnProperty.call(progress, key);
  const expected = progress[key];
  if (expectedPresent && !isRecord(expected)) return null;
  return {
    kind: "journey_progress_entry_cas",
    key,
    expectedPresent,
    ...(expectedPresent ? { expected } : {}),
    value,
  };
}

function progressEntryResult(
  toolName: string,
  toolInput: Record<string, unknown>,
  key: string,
  value: Record<string, unknown>,
  toolOutput: Record<string, unknown>,
  displayMessage: string,
): ToolExecutionResult {
  return {
    toolName,
    toolInput,
    toolOutput: {
      ...toolOutput,
      progress_key: key,
      progress_value: value,
    },
    success: true,
    displayMessage,
  };
}

function defaultActionHref(categoryKey: string | null, source: string): string {
  if (source === "quote") return "/wedding/community/quote-check";
  if (source === "budget") return "/wedding/budget";
  if (source === "schedule" || categoryKey === "invitation") {
    return "/wedding/schedule";
  }
  // 가족 조율 페이지는 제거됐다(2026-07-26) — 사회·답례품처럼 가족 합의가 필요한
  // 항목은 일반 안내 대신 아모라와 상황을 정리하는 쪽으로 보낸다.
  if (categoryKey === "mc" || categoryKey === "gift") {
    return "/wedding/chat";
  }
  return "/wedding/lounge";
}

function deterministicActionId(
  context: ToolExecutionContext,
  operationKey: string,
): string | null {
  const requestId = context.requestKey?.match(
    /:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )?.[1];
  if (!requestId || !/^[0-9a-f]{64}$/.test(operationKey)) return null;
  return `act_${requestId.replace(/-/g, "").toLowerCase()}_${operationKey.slice(0, 24)}`;
}

function customCategoryKey(coupleId: string, normalizedLabel: string): string {
  return `custom_${createHash("md5")
    .update(`${coupleId}\n${normalizedLabel}`, "utf8")
    .digest("hex")
    .slice(0, 24)}`;
}

export interface AmoraAtomicToolOperation {
  domainMutation: Record<string, unknown>;
  result: ToolExecutionResult;
}

function noOpFailure(
  toolName: string,
  toolInput: Record<string, unknown>,
  error: string,
  displayMessage: string,
): AmoraAtomicToolOperation {
  return {
    domainMutation: { kind: "none" },
    result: {
      toolName,
      toolInput,
      toolOutput: { error },
      success: false,
      displayMessage,
    },
  };
}

function isValidWonAmount(value: unknown): value is number {
  return isValidWeddingWonAmount(value);
}

function unsupportedOperation(
  toolName: string,
  toolInput: Record<string, unknown>,
): AmoraAtomicToolOperation {
  return {
    domainMutation: { kind: "none" },
    result: {
      toolName,
      toolInput,
      toolOutput: {
        error: "TOOL_ATOMICITY_UNAVAILABLE",
        retryable: false,
      },
      success: false,
      displayMessage:
        "이 변경은 안전한 저장 방식을 준비하는 중이라 지금은 적용하지 않았어요.",
    },
  };
}

function buildWeddingDateOperation(
  toolInput: Record<string, unknown>,
  context: ToolExecutionContext,
): AmoraAtomicToolOperation {
  const nextDate = toolInput.wedding_date;
  if (!isValidScheduleYmd(nextDate)) {
    return noOpFailure(
      "update_wedding_date",
      toolInput,
      "invalid_wedding_date",
      "결혼 날짜를 YYYY-MM-DD 형식의 실제 날짜로 다시 확인해 주세요.",
    );
  }
  const today = ymdInKst();
  if (nextDate < today) {
    return noOpFailure(
      "update_wedding_date",
      toolInput,
      "past_date_rejected",
      "결혼 예정일은 오늘 이후 날짜로 설정해 주세요.",
    );
  }
  const previousDate = context.weddingContext.weddingDate;
  if (previousDate === nextDate) {
    return noOpFailure(
      "update_wedding_date",
      toolInput,
      "no_change",
      "이미 같은 결혼 예정일로 설정되어 있어요.",
    );
  }
  const dDay = Math.round(
    (kstMidnightFromYmd(nextDate).getTime() - todayKstMidnight().getTime())
      / (1000 * 60 * 60 * 24),
  );
  return {
    domainMutation: {
      kind: "journey_wedding_date_cas",
      expected: previousDate,
      value: nextDate,
    },
    result: {
      toolName: "update_wedding_date",
      toolInput,
      toolOutput: {
        wedding_date: nextDate,
        previous_date: previousDate,
        d_day: dDay,
      },
      success: true,
      displayMessage: `결혼 예정일을 ${nextDate}로 변경했어요. (D-${dDay})`,
    },
  };
}

function buildVenueOperation(
  toolInput: Record<string, unknown>,
  context: ToolExecutionContext,
): AmoraAtomicToolOperation {
  if (typeof toolInput.venue !== "string") {
    return noOpFailure(
      "update_venue",
      toolInput,
      "invalid_venue",
      "예식장 이름을 다시 확인해 주세요.",
    );
  }
  const venue = normalizeWhitespace(toolInput.venue);
  if (!venue || venue.length > MAX_VENUE_CHARS) {
    return noOpFailure(
      "update_venue",
      toolInput,
      "invalid_venue",
      "예식장 이름은 1자 이상 200자 이하로 입력해 주세요.",
    );
  }
  const previousVenue = context.weddingContext.venue;
  if (previousVenue === venue) {
    return noOpFailure(
      "update_venue",
      toolInput,
      "no_change",
      "이미 같은 예식장으로 설정되어 있어요.",
    );
  }
  return {
    domainMutation: {
      kind: "journey_venue_cas",
      expected: previousVenue,
      value: venue,
    },
    result: {
      toolName: "update_venue",
      toolInput,
      toolOutput: { venue, previous_venue: previousVenue },
      success: true,
      displayMessage: `예식장을 "${venue}"로 설정했어요.`,
    },
  };
}

function buildTaskStatusOperation(
  toolInput: Record<string, unknown>,
  context: ToolExecutionContext,
): AmoraAtomicToolOperation {
  const category = toolInput.category;
  const status = toolInput.status;
  if (
    typeof category !== "string"
    || !Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, category)
    || typeof status !== "string"
    || !Object.prototype.hasOwnProperty.call(STATUS_LABELS, status)
  ) {
    return noOpFailure(
      "update_task_status",
      toolInput,
      "invalid_task_status",
      "준비 항목과 진행 상태를 다시 확인해 주세요.",
    );
  }
  const progress = context.weddingContext.progress as Record<string, unknown>;
  const existing = progress[category];
  if (existing !== undefined && !isRecord(existing)) {
    return noOpFailure(
      "update_task_status",
      toolInput,
      "progress_state_invalid",
      "현재 준비 상태 데이터에 확인이 필요한 항목이 있어 변경하지 않았어요.",
    );
  }
  const value = {
    ...(existing ?? {}),
    category,
    status,
  };
  if (isRecord(existing) && valuesEqual(existing, value)) {
    return noOpFailure(
      "update_task_status",
      toolInput,
      "no_change",
      "이미 같은 진행 상태로 설정되어 있어요.",
    );
  }
  const domainMutation = journeyProgressEntryMutation(category, value, context);
  if (!domainMutation) {
    return noOpFailure(
      "update_task_status",
      toolInput,
      "progress_state_invalid",
      "현재 준비 상태 데이터에 확인이 필요한 항목이 있어 변경하지 않았어요.",
    );
  }
  return {
    domainMutation,
    result: progressEntryResult(
      "update_task_status",
      toolInput,
      category,
      value,
      {
        category,
        status,
      },
      `${CATEGORY_LABELS[category]} 상태를 "${STATUS_LABELS[status]}"로 변경했어요.`,
    ),
  };
}

function buildCategoryBudgetOperation(
  toolInput: Record<string, unknown>,
  context: ToolExecutionContext,
): AmoraAtomicToolOperation {
  const category = toolInput.category;
  const hasBudget = toolInput.budget !== undefined;
  const hasSpent = toolInput.spent !== undefined;
  if (
    typeof category !== "string"
    || !Object.prototype.hasOwnProperty.call(CATEGORY_RATIOS, category)
    || (!hasBudget && !hasSpent)
    || (hasBudget && !isValidWonAmount(toolInput.budget))
    || (hasSpent && !isValidWonAmount(toolInput.spent))
  ) {
    return noOpFailure(
      "update_category_budget",
      toolInput,
      "invalid_category_budget",
      "예산 항목과 금액을 다시 확인해 주세요.",
    );
  }
  const progress = context.weddingContext.progress as Record<string, unknown>;
  const existing = progress[category];
  if (existing !== undefined && !isRecord(existing)) {
    return noOpFailure(
      "update_category_budget",
      toolInput,
      "progress_state_invalid",
      "현재 예산 데이터에 확인이 필요한 항목이 있어 변경하지 않았어요.",
    );
  }
  if (
    isRecord(existing)
    && typeof existing.status === "string"
    && !PROGRESS_STATUSES.has(existing.status)
  ) {
    return noOpFailure(
      "update_category_budget",
      toolInput,
      "progress_state_invalid",
      "현재 예산 데이터에 확인이 필요한 상태가 있어 변경하지 않았어요.",
    );
  }
  const value: Record<string, unknown> = {
    ...(existing ?? {}),
    category,
    status: isRecord(existing) && typeof existing.status === "string"
      ? existing.status
      : "not_started",
  };
  if (hasBudget) value.budget = toolInput.budget;
  if (hasSpent) value.spent = toolInput.spent;
  if (isRecord(existing) && valuesEqual(existing, value)) {
    return noOpFailure(
      "update_category_budget",
      toolInput,
      "no_change",
      "이미 같은 금액으로 설정되어 있어요.",
    );
  }
  const domainMutation = journeyProgressEntryMutation(category, value, context);
  if (!domainMutation) {
    return noOpFailure(
      "update_category_budget",
      toolInput,
      "progress_state_invalid",
      "현재 예산 데이터에 확인이 필요한 항목이 있어 변경하지 않았어요.",
    );
  }
  const label = CATEGORY_LABELS[category] ?? "예비비";
  return {
    domainMutation,
    result: progressEntryResult(
      "update_category_budget",
      toolInput,
      category,
      value,
      { category, ...(hasBudget ? { budget: toolInput.budget } : {}), ...(hasSpent ? { spent: toolInput.spent } : {}) },
      `${label} 예산 정보를 변경했어요.`,
    ),
  };
}

function buildBudgetPlanOperation(
  toolInput: Record<string, unknown>,
  context: ToolExecutionContext,
): AmoraAtomicToolOperation {
  const totalBudget = toolInput.total_budget;
  const allocations = toolInput.allocations;
  if (
    !isValidWonAmount(totalBudget)
    || !Array.isArray(allocations)
    || allocations.length < 1
    || allocations.length > Object.keys(CATEGORY_RATIOS).length
    || (toolInput.intake_summary !== undefined
      && (
        typeof toolInput.intake_summary !== "string"
        || toolInput.intake_summary.length > 2000
      ))
  ) {
    return noOpFailure(
      "apply_budget_plan",
      toolInput,
      "invalid_budget_plan",
      "총예산과 카테고리 배분을 다시 확인해 주세요.",
    );
  }
  const normalizedAllocations: Array<{ category: string; budget: number }> = [];
  for (const candidate of allocations) {
    if (
      !isRecord(candidate)
      || typeof candidate.category !== "string"
      || !Object.prototype.hasOwnProperty.call(CATEGORY_RATIOS, candidate.category)
      || !isValidWonAmount(candidate.budget)
      || (candidate.rationale !== undefined
        && (typeof candidate.rationale !== "string" || candidate.rationale.length > 500))
    ) {
      return noOpFailure(
        "apply_budget_plan",
        toolInput,
        "invalid_budget_plan",
        "총예산과 카테고리 배분을 다시 확인해 주세요.",
      );
    }
    normalizedAllocations.push({
      category: candidate.category,
      budget: candidate.budget,
    });
  }
  if (
    new Set(normalizedAllocations.map((item) => item.category)).size
      !== normalizedAllocations.length
  ) {
    return noOpFailure(
      "apply_budget_plan",
      toolInput,
      "invalid_budget_plan",
      "같은 예산 카테고리가 두 번 들어가 있어 적용하지 않았어요.",
    );
  }
  const allocated = normalizedAllocations.reduce((sum, item) => sum + item.budget, 0);
  if (allocated > totalBudget) {
    return noOpFailure(
      "apply_budget_plan",
      toolInput,
      "budget_allocations_exceed_total",
      "카테고리 배분 합계가 총예산을 넘어서 적용하지 않았어요.",
    );
  }
  const remainder = totalBudget - allocated;
  const finalAllocations = normalizedAllocations.map((item) => ({ ...item }));
  if (remainder > 0) {
    const reserve = finalAllocations.find((item) => item.category === "reserve");
    if (reserve) reserve.budget += remainder;
    else finalAllocations.push({ category: "reserve", budget: remainder });
  }

  const progress = context.weddingContext.progress as Record<string, unknown>;
  const entries: Record<string, unknown>[] = [];
  let progressChanged = false;
  for (const allocation of finalAllocations) {
    const expectedPresent = Object.prototype.hasOwnProperty.call(progress, allocation.category);
    const existing = progress[allocation.category];
    if (expectedPresent && !isRecord(existing)) {
      return noOpFailure(
        "apply_budget_plan",
        toolInput,
        "progress_state_invalid",
        "현재 예산 데이터에 확인이 필요한 항목이 있어 예산안을 적용하지 않았어요.",
      );
    }
    if (
      isRecord(existing)
      && typeof existing.status === "string"
      && !PROGRESS_STATUSES.has(existing.status)
    ) {
      return noOpFailure(
        "apply_budget_plan",
        toolInput,
        "progress_state_invalid",
        "현재 예산 데이터에 확인이 필요한 상태가 있어 예산안을 적용하지 않았어요.",
      );
    }
    const value = {
      ...(existing ?? {}),
      category: allocation.category,
      status: isRecord(existing) && typeof existing.status === "string"
        ? existing.status
        : "not_started",
      budget: allocation.budget,
    };
    if (!expectedPresent || !valuesEqual(existing, value)) progressChanged = true;
    entries.push({
      key: allocation.category,
      expectedPresent,
      ...(expectedPresent ? { expected: existing } : {}),
      value,
    });
  }
  if (!progressChanged && context.weddingContext.budget === totalBudget) {
    return noOpFailure(
      "apply_budget_plan",
      toolInput,
      "no_change",
      "이미 같은 예산안이 적용되어 있어요.",
    );
  }
  return {
    // intake_summary is intentionally excluded: raw private intake must not be
    // retained in an operational mutation or durable tool result.
    domainMutation: {
      kind: "journey_budget_plan_cas",
      expectedBudget: context.weddingContext.budget,
      valueBudget: totalBudget,
      entries,
    },
    result: {
      toolName: "apply_budget_plan",
      toolInput,
      toolOutput: {
        total_budget: totalBudget,
        previous_budget: context.weddingContext.budget,
        applied_count: finalAllocations.length,
        remainder_to_reserve: remainder,
        allocations: finalAllocations,
      },
      success: true,
      displayMessage: `총예산 ${formatWon(totalBudget)} 기준으로 ${finalAllocations.length}개 항목의 배분을 적용했어요.`,
    },
  };
}

function buildCustomCategoryOperation(
  toolInput: Record<string, unknown>,
  context: ToolExecutionContext,
): AmoraAtomicToolOperation {
  const rawLabel = typeof toolInput.label === "string"
    ? normalizeWhitespace(toolInput.label)
    : "";
  if (!rawLabel || rawLabel.length > 60) {
    return noOpFailure(
      "add_custom_category",
      toolInput,
      "invalid_category_label",
      "추가할 예산 항목 이름을 알려 주세요.",
    );
  }
  const label = rawLabel;
  for (const field of ["budget", "spent"] as const) {
    if (toolInput[field] !== undefined && !isValidWonAmount(toolInput[field])) {
      return noOpFailure(
        "add_custom_category",
        toolInput,
        "invalid_category_amount",
        "카테고리 금액은 0원 이상 정수로 입력해 주세요.",
      );
    }
  }
  const progress = context.weddingContext.progress as Record<string, unknown>;
  const normalizedLabel = label.toLocaleLowerCase("ko-KR");
  const matchingEntry = Object.entries(progress).find(([candidateKey, candidate]) => {
    if (!candidateKey.startsWith("custom_") || !isRecord(candidate)) return false;
    return typeof candidate.label === "string"
      && normalizeWhitespace(candidate.label).toLocaleLowerCase("ko-KR") === normalizedLabel;
  });
  const key = matchingEntry?.[0]
    ?? customCategoryKey(context.coupleId, normalizedLabel);
  const existing = matchingEntry?.[1] ?? progress[key];
  if (existing !== undefined && !isRecord(existing)) {
    return noOpFailure(
      "add_custom_category",
      toolInput,
      "custom_category_collision",
      "같은 카테고리 키에 확인이 필요한 데이터가 있어 추가하지 않았어요.",
    );
  }
  if (
    isRecord(existing)
    && typeof existing.label === "string"
    && normalizeWhitespace(existing.label).toLocaleLowerCase("ko-KR") !== normalizedLabel
  ) {
    return noOpFailure(
      "add_custom_category",
      toolInput,
      "custom_category_collision",
      "같은 카테고리 키가 이미 사용 중이라 추가하지 않았어요.",
    );
  }
  const value: Record<string, unknown> = {
    ...(existing ?? {}),
    category: key,
    label,
    status: isRecord(existing) && typeof existing.status === "string"
      ? existing.status
      : "in_progress",
  };
  if (!PROGRESS_STATUSES.has(String(value.status))) {
    return noOpFailure(
      "add_custom_category",
      toolInput,
      "progress_state_invalid",
      "현재 예산 데이터에 확인이 필요한 상태가 있어 추가하지 않았어요.",
    );
  }
  if (toolInput.budget !== undefined) value.budget = toolInput.budget;
  if (toolInput.spent !== undefined) value.spent = toolInput.spent;
  if (isRecord(existing) && valuesEqual(existing, value)) {
    return noOpFailure(
      "add_custom_category",
      toolInput,
      "no_change",
      "이미 같은 카테고리가 같은 내용으로 저장되어 있어요.",
    );
  }
  const domainMutation = journeyProgressEntryMutation(key, value, context);
  if (!domainMutation) {
    return noOpFailure(
      "add_custom_category",
      toolInput,
      "progress_state_invalid",
      "현재 예산 데이터에 확인이 필요한 항목이 있어 추가하지 않았어요.",
    );
  }
  const created = existing === undefined;
  return {
    domainMutation,
    result: progressEntryResult(
      "add_custom_category",
      toolInput,
      key,
      value,
      { key, label, created },
      created ? `새 예산 항목 "${label}"을 추가했어요.` : `기존 예산 항목 "${label}"을 업데이트했어요.`,
    ),
  };
}

function buildChecklistOperation(
  toolInput: Record<string, unknown>,
  context: ToolExecutionContext,
): AmoraAtomicToolOperation {
  const category = toolInput.category;
  const itemId = toolInput.item_id;
  const done = toolInput.done;
  if (
    typeof category !== "string"
    || typeof itemId !== "string"
    || typeof done !== "boolean"
    || !CHECKLIST_MAP[category]
  ) {
    return noOpFailure(
      "toggle_checklist_item",
      toolInput,
      "invalid_checklist_item",
      "체크리스트 항목을 다시 확인해 주세요.",
    );
  }
  const progress = context.weddingContext.progress as Record<string, unknown>;
  const existing = progress[category];
  if (existing !== undefined && !isRecord(existing)) {
    return noOpFailure(
      "toggle_checklist_item",
      toolInput,
      "progress_state_invalid",
      "현재 체크리스트 데이터에 확인이 필요한 항목이 있어 변경하지 않았어요.",
    );
  }
  const savedChecklist = isRecord(existing) ? existing.checklist : undefined;
  if (savedChecklist !== undefined && !Array.isArray(savedChecklist)) {
    return noOpFailure(
      "toggle_checklist_item",
      toolInput,
      "progress_state_invalid",
      "현재 체크리스트 데이터에 확인이 필요한 항목이 있어 변경하지 않았어요.",
    );
  }
  const existingStatus = isRecord(existing) && typeof existing.status === "string"
    ? existing.status
    : "not_started";
  if (!PROGRESS_STATUSES.has(existingStatus)) {
    return noOpFailure(
      "toggle_checklist_item",
      toolInput,
      "progress_state_invalid",
      "현재 체크리스트 상태를 확인해야 해서 변경하지 않았어요.",
    );
  }
  const merged = mergeChecklist(
    CHECKLIST_MAP[category].items,
    savedChecklist as Parameters<typeof mergeChecklist>[1],
    existingStatus as Parameters<typeof mergeChecklist>[2],
  );
  const target = merged.find((item) => item.id === itemId);
  if (!target) {
    return noOpFailure(
      "toggle_checklist_item",
      toolInput,
      "checklist_item_not_found",
      "해당 체크리스트 항목을 찾지 못했어요.",
    );
  }
  const updated = merged.map((item) => item.id === itemId ? { ...item, done } : item);
  const newStatus = calculateStatus(updated);
  const value = {
    ...(existing ?? {}),
    category,
    status: newStatus,
    checklist: updated,
  };
  if (isRecord(existing) && valuesEqual(existing, value)) {
    return noOpFailure(
      "toggle_checklist_item",
      toolInput,
      "no_change",
      "이미 같은 체크 상태로 저장되어 있어요.",
    );
  }
  const domainMutation = journeyProgressEntryMutation(category, value, context);
  if (!domainMutation) {
    return noOpFailure(
      "toggle_checklist_item",
      toolInput,
      "progress_state_invalid",
      "현재 체크리스트 데이터에 확인이 필요한 항목이 있어 변경하지 않았어요.",
    );
  }
  return {
    domainMutation,
    result: progressEntryResult(
      "toggle_checklist_item",
      toolInput,
      category,
      value,
      {
        category,
        item_id: itemId,
        done,
        new_status: newStatus,
        item_label: target.label,
      },
      `${CATEGORY_LABELS[category]}의 "${target.label}" 항목을 ${done ? "완료" : "미완료"}로 변경했어요.`,
    ),
  };
}

function buildWeddingEventOperation(
  toolInput: Record<string, unknown>,
  context: ToolExecutionContext,
): AmoraAtomicToolOperation {
  const rawMomentType = toolInput.moment_type;
  const definition = typeof rawMomentType === "string"
    ? MOMENTS[rawMomentType as MomentType]
    : undefined;
  if (!definition || definition.trigger !== "event") {
    return noOpFailure(
      "log_wedding_event",
      toolInput,
      "unsupported_moment_type",
      "지원하는 웨딩 일정 종류를 다시 확인해 주세요.",
    );
  }
  const momentType = rawMomentType as string;
  const date = toolInput.date;
  if (!isValidScheduleYmd(date)) {
    return noOpFailure(
      "log_wedding_event",
      toolInput,
      "invalid_date",
      "일정 날짜를 YYYY-MM-DD 형식의 실제 날짜로 알려 주세요.",
    );
  }
  const rawTitle = typeof toolInput.title === "string" && toolInput.title.trim()
    ? normalizeWhitespace(toolInput.title)
    : definition.label;
  if (!rawTitle || rawTitle.length > 60) {
    return noOpFailure(
      "log_wedding_event",
      toolInput,
      "invalid_schedule_event",
      "일정 제목은 60자 이하로 입력해 주세요.",
    );
  }
  const title = rawTitle;
  const memo = toolInput.memo === undefined
    ? undefined
    : typeof toolInput.memo === "string" && toolInput.memo.length <= 300
      ? toolInput.memo
      : null;
  if (memo === null) {
    return noOpFailure(
      "log_wedding_event",
      toolInput,
      "invalid_schedule_event",
      "일정 메모를 다시 확인해 주세요.",
    );
  }
  const progress = context.weddingContext.progress as Record<string, unknown>;
  const inspection = inspectScheduleEvents(progress);
  if (
    inspection.malformedContainer
    || inspection.rejectedCount > 0
    || inspection.truncatedCount > 0
  ) {
    return noOpFailure(
      "log_wedding_event",
      toolInput,
      "schedule_state_invalid",
      "현재 일정 데이터에 확인이 필요한 항목이 있어 변경하지 않았어요.",
    );
  }
  try {
    const mutation = upsertMomentEvent(progress, {
      momentType,
      date,
      title,
      memo,
    });
    return {
      domainMutation: {
        kind: "journey_progress_key_cas",
        key: "__events",
        expectedPresent: Object.prototype.hasOwnProperty.call(progress, "__events"),
        ...(Object.prototype.hasOwnProperty.call(progress, "__events")
          ? { expected: progress.__events }
          : {}),
        value: mutation.newProgress.__events,
      },
      result: {
        toolName: "log_wedding_event",
        toolInput,
        toolOutput: {
          event: mutation.event,
          created: mutation.created,
        },
        success: true,
        displayMessage: mutation.created
          ? `${date} "${title}" 일정을 저장했어요.`
          : `${date} "${title}" 일정을 업데이트했어요.`,
      },
    };
  } catch (error) {
    if (error instanceof ScheduleEventCapacityError) {
      return noOpFailure(
        "log_wedding_event",
        toolInput,
        "schedule_capacity_exceeded",
        "일정 저장 한도에 도달해 추가하지 않았어요.",
      );
    }
    if (error instanceof ScheduleEventValidationError) {
      return noOpFailure(
        "log_wedding_event",
        toolInput,
        "invalid_schedule_event",
        "일정 내용을 다시 확인해 주세요.",
      );
    }
    throw error;
  }
}

function buildAddActionOperation(
  toolInput: Record<string, unknown>,
  context: ToolExecutionContext,
  operationKey: string,
): AmoraAtomicToolOperation {
  const title = typeof toolInput.title === "string"
    ? normalizeWhitespace(toolInput.title)
    : "";
  if (!title || title.length > MAX_ACTION_TITLE_CHARS) {
    return noOpFailure(
      "add_amora_action",
      toolInput,
      "invalid_action_title",
      "저장할 행동 카드의 제목을 알려 주세요.",
    );
  }
  const actionId = deterministicActionId(context, operationKey);
  if (!actionId) {
    return noOpFailure(
      "add_amora_action",
      toolInput,
      "invalid_action_identity",
      "행동 카드의 안전한 저장 식별자를 만들지 못해 적용하지 않았어요.",
    );
  }
  const description = normalizeOptionalText(
    toolInput.description,
    MAX_ACTION_DESCRIPTION_CHARS,
  );
  if (toolInput.description !== undefined && typeof toolInput.description !== "string") {
    return noOpFailure(
      "add_amora_action",
      toolInput,
      "invalid_action_description",
      "행동 카드 설명을 다시 확인해 주세요.",
    );
  }
  if (
    typeof toolInput.description === "string"
    && normalizeWhitespace(toolInput.description).length > MAX_ACTION_DESCRIPTION_CHARS
  ) {
    return noOpFailure(
      "add_amora_action",
      toolInput,
      "invalid_action_description",
      "행동 카드 설명은 500자 이하로 입력해 주세요.",
    );
  }
  const dueDate = normalizeOptionalText(toolInput.due_date, MAX_ACTION_DUE_DATE_CHARS);
  if (
    toolInput.due_date !== undefined
    && (typeof toolInput.due_date !== "string" || !dueDate || !isValidScheduleYmd(dueDate))
  ) {
    return noOpFailure(
      "add_amora_action",
      toolInput,
      "invalid_action_due_date",
      "마감일을 YYYY-MM-DD 형식의 실제 날짜로 알려 주세요.",
    );
  }
  const categoryKey = toolInput.category_key === undefined || toolInput.category_key === "general"
    ? null
    : typeof toolInput.category_key === "string"
        && Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, toolInput.category_key)
      ? toolInput.category_key
      : undefined;
  if (categoryKey === undefined) {
    return noOpFailure(
      "add_amora_action",
      toolInput,
      "invalid_action_category",
      "행동 카드의 관련 준비 항목을 다시 확인해 주세요.",
    );
  }
  const priority = toolInput.priority === undefined ? "medium" : toolInput.priority;
  const source = toolInput.source === undefined ? "chat" : toolInput.source;
  if (
    typeof priority !== "string"
    || !ACTION_PRIORITIES.has(priority)
    || typeof source !== "string"
    || !ACTION_SOURCES.has(source)
  ) {
    return noOpFailure(
      "add_amora_action",
      toolInput,
      "invalid_action_classification",
      "행동 카드의 우선순위와 출처를 다시 확인해 주세요.",
    );
  }
  let href = defaultActionHref(categoryKey, source);
  if (toolInput.href !== undefined) {
    if (
      typeof toolInput.href !== "string"
      || !toolInput.href.startsWith("/")
      || toolInput.href.length > MAX_ACTION_HREF_CHARS
    ) {
      return noOpFailure(
        "add_amora_action",
        toolInput,
        "invalid_action_href",
        "행동 카드 연결 경로를 다시 확인해 주세요.",
      );
    }
    href = toolInput.href;
  }
  const action = {
    id: actionId,
    title,
    description,
    dueDate,
    categoryKey,
    priority,
    status: "open",
    source,
    href,
  };
  return {
    domainMutation: { kind: "amora_action_insert", action },
    result: {
      toolName: "add_amora_action",
      toolInput,
      toolOutput: { action },
      success: true,
      displayMessage: `"${title}"을 아모라 행동 카드로 저장했어요.`,
    },
  };
}

function buildUpdateActionOperation(
  toolInput: Record<string, unknown>,
): AmoraAtomicToolOperation {
  const actionId = toolInput.action_id;
  if (
    typeof actionId !== "string"
    || !/^[0-9a-z_-]{1,200}$/i.test(actionId)
  ) {
    return noOpFailure(
      "update_amora_action",
      toolInput,
      "invalid_action_id",
      "변경할 행동 카드 식별자를 다시 확인해 주세요.",
    );
  }
  const updates: Record<string, unknown> = {};
  if (toolInput.title !== undefined) {
    if (typeof toolInput.title !== "string") {
      return noOpFailure("update_amora_action", toolInput, "invalid_action_title", "행동 카드 제목을 다시 확인해 주세요.");
    }
    const title = normalizeWhitespace(toolInput.title);
    if (!title || title.length > MAX_ACTION_TITLE_CHARS) return noOpFailure("update_amora_action", toolInput, "invalid_action_title", "행동 카드 제목을 다시 확인해 주세요.");
    updates.title = title;
  }
  if (toolInput.description !== undefined) {
    if (typeof toolInput.description !== "string") {
      return noOpFailure("update_amora_action", toolInput, "invalid_action_description", "행동 카드 설명을 다시 확인해 주세요.");
    }
    if (normalizeWhitespace(toolInput.description).length > MAX_ACTION_DESCRIPTION_CHARS) {
      return noOpFailure("update_amora_action", toolInput, "invalid_action_description", "행동 카드 설명은 500자 이하로 입력해 주세요.");
    }
    updates.description = normalizeOptionalText(toolInput.description, MAX_ACTION_DESCRIPTION_CHARS);
  }
  if (toolInput.due_date !== undefined) {
    if (typeof toolInput.due_date !== "string") {
      return noOpFailure("update_amora_action", toolInput, "invalid_action_due_date", "행동 카드 마감일을 다시 확인해 주세요.");
    }
    const dueDate = normalizeOptionalText(toolInput.due_date, MAX_ACTION_DUE_DATE_CHARS);
    if (dueDate && !isValidScheduleYmd(dueDate)) {
      return noOpFailure("update_amora_action", toolInput, "invalid_action_due_date", "마감일을 YYYY-MM-DD 형식의 실제 날짜로 알려 주세요.");
    }
    updates.dueDate = dueDate;
  }
  if (toolInput.priority !== undefined) {
    if (typeof toolInput.priority !== "string" || !ACTION_PRIORITIES.has(toolInput.priority)) {
      return noOpFailure("update_amora_action", toolInput, "invalid_action_priority", "행동 카드 우선순위를 다시 확인해 주세요.");
    }
    updates.priority = toolInput.priority;
  }
  if (toolInput.status !== undefined) {
    if (typeof toolInput.status !== "string" || !ACTION_STATUSES.has(toolInput.status)) {
      return noOpFailure("update_amora_action", toolInput, "invalid_action_status", "행동 카드 상태를 다시 확인해 주세요.");
    }
    updates.status = toolInput.status;
  }
  if (toolInput.href !== undefined) {
    if (
      typeof toolInput.href !== "string"
      || (toolInput.href !== "" && !toolInput.href.startsWith("/"))
      || toolInput.href.length > MAX_ACTION_HREF_CHARS
    ) {
      return noOpFailure("update_amora_action", toolInput, "invalid_action_href", "행동 카드 연결 경로를 다시 확인해 주세요.");
    }
    updates.href = toolInput.href || null;
  }
  if (Object.keys(updates).length === 0) {
    return noOpFailure(
      "update_amora_action",
      toolInput,
      "no_changes_requested",
      "행동 카드에서 변경할 내용을 알려 주세요.",
    );
  }
  return {
    domainMutation: {
      kind: "amora_action_update",
      actionId,
      updates,
    },
    result: {
      toolName: "update_amora_action",
      toolInput,
      toolOutput: { action_id: actionId, updates },
      success: true,
      displayMessage: "아모라 행동 카드를 변경했어요.",
    },
  };
}

export function buildAmoraAtomicToolOperation(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: ToolExecutionContext,
  operationKey = getAmoraToolOperationIdentity(toolName, toolInput).operationKey,
): AmoraAtomicToolOperation {
  if (toolName === "update_wedding_date") {
    return buildWeddingDateOperation(toolInput, context);
  }
  if (toolName === "update_venue") {
    return buildVenueOperation(toolInput, context);
  }
  if (toolName === "update_task_status") {
    return buildTaskStatusOperation(toolInput, context);
  }
  if (toolName === "update_category_budget") {
    return buildCategoryBudgetOperation(toolInput, context);
  }
  if (toolName === "apply_budget_plan") {
    return buildBudgetPlanOperation(toolInput, context);
  }
  if (toolName === "add_custom_category") {
    return buildCustomCategoryOperation(toolInput, context);
  }
  if (toolName === "toggle_checklist_item") {
    return buildChecklistOperation(toolInput, context);
  }
  if (toolName === "log_wedding_event") {
    return buildWeddingEventOperation(toolInput, context);
  }
  if (toolName === "add_amora_action") {
    return buildAddActionOperation(toolInput, context, operationKey);
  }
  if (toolName === "update_amora_action") {
    return buildUpdateActionOperation(toolInput);
  }
  if (toolName === "delete_schedule_event") {
    if (toolInput.confirmed !== true) {
      return {
        domainMutation: { kind: "none" },
        result: {
          toolName,
          toolInput,
          toolOutput: {
            requires_confirmation: true,
            confirmation_field: "confirmed",
          },
          success: false,
          displayMessage: "일정을 삭제하려면 삭제할 항목을 먼저 확인해 주세요.",
        },
      };
    }
    const progress = context.weddingContext.progress as Record<string, unknown>;
    const inspection = inspectScheduleEvents(progress);
    if (
      inspection.malformedContainer
      || inspection.rejectedCount > 0
      || inspection.truncatedCount > 0
    ) {
      return noOpFailure(
        toolName,
        toolInput,
        "schedule_state_invalid",
        "현재 일정 데이터에 확인이 필요한 항목이 있어 변경하지 않았어요.",
      );
    }
    const eventId = toolInput.event_id;
    const existing = typeof eventId === "string"
      ? inspection.events.find((event) => event.id === eventId)
      : undefined;
    if (!existing) {
      return noOpFailure(
        toolName,
        toolInput,
        "schedule_event_not_found",
        "삭제할 일정을 찾지 못했어요. 현재 일정을 다시 확인해 주세요.",
      );
    }
    return {
      domainMutation: {
        kind: "journey_progress_key_cas",
        key: "__events",
        expectedPresent: true,
        expected: progress.__events,
        value: inspection.events.filter((event) => event.id !== existing.id),
      },
      result: {
        toolName,
        toolInput,
        toolOutput: { deleted_event: existing },
        success: true,
        displayMessage: `“${existing.title}” (${existing.date}) 일정을 삭제했어요.`,
      },
    };
  }

  if (toolName === "update_schedule_event") {
    const progress = context.weddingContext.progress as Record<string, unknown>;
    const inspection = inspectScheduleEvents(progress);
    if (
      inspection.malformedContainer
      || inspection.rejectedCount > 0
      || inspection.truncatedCount > 0
    ) {
      return noOpFailure(
        toolName,
        toolInput,
        "schedule_state_invalid",
        "현재 일정 데이터에 확인이 필요한 항목이 있어 변경하지 않았어요.",
      );
    }
    const eventId = toolInput.event_id;
    if (typeof eventId !== "string") {
      return noOpFailure(
        toolName,
        toolInput,
        "invalid_schedule_event",
        "수정할 일정을 다시 확인해 주세요.",
      );
    }
    const existing = inspection.events.find((event) => event.id === eventId);
    if (!existing) {
      return noOpFailure(
        toolName,
        toolInput,
        "schedule_event_not_found",
        "수정할 일정을 찾지 못했어요. 현재 일정을 다시 확인해 주세요.",
      );
    }
    const updates: Partial<ScheduleEvent> = {};
    if (toolInput.date !== undefined) updates.date = toolInput.date as string;
    if (toolInput.title !== undefined) updates.title = toolInput.title as string;
    if (toolInput.memo !== undefined) updates.memo = toolInput.memo as string;
    try {
      const newProgress = updateEvent(progress, eventId, updates);
      const updated = getEvents(newProgress).find((event) => event.id === eventId)!;
      return {
        domainMutation: {
          kind: "journey_progress_key_cas",
          key: "__events",
          expectedPresent: true,
          expected: progress.__events,
          value: newProgress.__events,
        },
        result: {
          toolName,
          toolInput,
          toolOutput: { event: updated, updates },
          success: true,
          displayMessage: `“${updated.title}” 일정을 수정했어요.`,
        },
      };
    } catch (error) {
      if (error instanceof ScheduleEventValidationError) {
        return noOpFailure(
          toolName,
          toolInput,
          "invalid_schedule_event",
          "일정 날짜와 제목을 다시 확인해 주세요.",
        );
      }
      throw error;
    }
  }

  if (toolName === "add_schedule_event") {
    const progress = context.weddingContext.progress as Record<string, unknown>;
    const inspection = inspectScheduleEvents(progress);
    if (
      inspection.malformedContainer
      || inspection.rejectedCount > 0
      || inspection.truncatedCount > 0
    ) {
      return noOpFailure(
        toolName,
        toolInput,
        "schedule_state_invalid",
        "현재 일정 데이터에 확인이 필요한 항목이 있어 변경하지 않았어요.",
      );
    }

    const date = toolInput.date;
    const title = toolInput.title;
    const memo = toolInput.memo;
    const categoryKey = toolInput.category_key;
    if (
      typeof date !== "string"
      || typeof title !== "string"
      || (memo !== undefined && typeof memo !== "string")
      || (categoryKey !== undefined && typeof categoryKey !== "string")
    ) {
      return noOpFailure(
        toolName,
        toolInput,
        "invalid_schedule_event",
        "일정 날짜와 제목을 다시 확인해 주세요.",
      );
    }

    try {
      const mutation = upsertCategoryEvent(
        progress,
        { date, title, memo, categoryKey },
        CATEGORY_LABELS[categoryKey ?? ""],
      );
      return {
        domainMutation: {
          kind: "journey_progress_key_cas",
          key: "__events",
          expectedPresent: Object.prototype.hasOwnProperty.call(progress, "__events"),
          ...(Object.prototype.hasOwnProperty.call(progress, "__events")
            ? { expected: progress.__events }
            : {}),
          value: mutation.newProgress.__events,
        },
        result: {
          toolName,
          toolInput,
          toolOutput: {
            event: mutation.event,
            ...(mutation.created
              ? {}
              : { upserted: true, replaced_event_id: mutation.event.id }),
          },
          success: true,
          displayMessage: mutation.created
            ? `${date}에 “${title}” 일정을 추가했어요.`
            : `${CATEGORY_LABELS[categoryKey ?? ""] ?? title} 일정을 ${date}로 업데이트했어요.`,
        },
      };
    } catch (error) {
      if (error instanceof ScheduleEventCapacityError) {
        return noOpFailure(
          toolName,
          toolInput,
          "schedule_capacity_exceeded",
          "일정 저장 한도에 도달해 기존 일정을 정리한 뒤 다시 시도해 주세요.",
        );
      }
      if (error instanceof ScheduleEventValidationError) {
        return noOpFailure(
          toolName,
          toolInput,
          "invalid_schedule_event",
          "일정 날짜와 제목을 다시 확인해 주세요.",
        );
      }
      throw error;
    }
  }

  if (toolName !== "update_budget") {
    return unsupportedOperation(toolName, toolInput);
  }

  const nextBudget = toolInput.total_budget;
  if (!isValidWonAmount(nextBudget)) {
    return {
      domainMutation: { kind: "none" },
      result: {
        toolName,
        toolInput,
        toolOutput: { error: "invalid_budget_amount" },
        success: false,
        displayMessage: "총예산은 0원 이상 1조원 이하의 원 단위 정수여야 해요.",
      },
    };
  }

  const previousBudget = context.weddingContext.budget;
  if (!isValidWonAmount(previousBudget)) {
    return {
      domainMutation: { kind: "none" },
      result: {
        toolName,
        toolInput,
        toolOutput: { error: "invalid_existing_budget" },
        success: false,
        displayMessage: "저장된 예산 값의 안전한 정리가 먼저 필요해요. 잠시 후 다시 시도해주세요.",
      },
    };
  }
  if (previousBudget === nextBudget) {
    return noOpFailure(
      toolName,
      toolInput,
      "no_change",
      "이미 같은 총예산으로 설정되어 있어요.",
    );
  }
  return {
    domainMutation: {
      kind: "journey_total_budget_cas",
      expected: previousBudget,
      value: nextBudget,
    },
    result: {
      toolName,
      toolInput,
      toolOutput: {
        total_budget: nextBudget,
        previous_budget: previousBudget,
      },
      success: true,
      displayMessage:
        `총예산을 ${formatWon(previousBudget)}에서 ${formatWon(nextBudget)}으로 변경했어요.`,
    },
  };
}

export function applyAmoraAtomicToolResultToContext(
  result: ToolExecutionResult,
  context: ToolExecutionContext,
): void {
  if (!result.success) return;
  if (
    result.toolName === "update_budget"
    && typeof result.toolOutput.total_budget === "number"
    && isValidWeddingWonAmount(result.toolOutput.total_budget)
  ) {
    context.weddingContext.budget = result.toolOutput.total_budget;
  }
  if (
    result.toolName === "apply_budget_plan"
    && typeof result.toolOutput.total_budget === "number"
    && isValidWeddingWonAmount(result.toolOutput.total_budget)
  ) {
    context.weddingContext.budget = result.toolOutput.total_budget;
    const allocations = result.toolOutput.allocations;
    if (Array.isArray(allocations)) {
      const progress = context.weddingContext.progress as Record<string, unknown>;
      const next = { ...progress };
      for (const allocation of allocations) {
        if (
          isRecord(allocation)
          && typeof allocation.category === "string"
          && isValidWonAmount(allocation.budget)
        ) {
          const existing = isRecord(progress[allocation.category])
            ? progress[allocation.category] as Record<string, unknown>
            : {};
          next[allocation.category] = {
            ...existing,
            category: allocation.category,
            status: typeof existing.status === "string" ? existing.status : "not_started",
            budget: allocation.budget,
          };
        }
      }
      context.weddingContext.progress = next as ToolExecutionContext["weddingContext"]["progress"];
    }
  }
  if (
    result.toolName === "update_wedding_date"
    && typeof result.toolOutput.wedding_date === "string"
    && isValidScheduleYmd(result.toolOutput.wedding_date)
  ) {
    context.weddingContext.weddingDate = result.toolOutput.wedding_date;
  }
  if (
    result.toolName === "update_venue"
    && typeof result.toolOutput.venue === "string"
  ) {
    context.weddingContext.venue = result.toolOutput.venue;
  }
  if (
    typeof result.toolOutput.progress_key === "string"
    && isRecord(result.toolOutput.progress_value)
  ) {
    context.weddingContext.progress = {
      ...(context.weddingContext.progress as Record<string, unknown>),
      [result.toolOutput.progress_key]: result.toolOutput.progress_value,
    } as ToolExecutionContext["weddingContext"]["progress"];
  }
  if (
    ["add_schedule_event", "update_schedule_event", "log_wedding_event"].includes(
      result.toolName,
    )
    && result.toolOutput.event
    && typeof result.toolOutput.event === "object"
    && !Array.isArray(result.toolOutput.event)
  ) {
    const event = result.toolOutput.event as ScheduleEvent;
    const progress = context.weddingContext.progress as Record<string, unknown>;
    const inspection = inspectScheduleEvents(progress);
    let replaced = false;
    const events = inspection.events.map((candidate) => {
      if (candidate.id !== event.id) return candidate;
      replaced = true;
      return event;
    });
    context.weddingContext.progress = {
      ...progress,
      __events: replaced ? events : [...events, event],
    } as unknown as ToolExecutionContext["weddingContext"]["progress"];
  }
  if (
    result.toolName === "delete_schedule_event"
    && result.toolOutput.deleted_event
    && typeof result.toolOutput.deleted_event === "object"
    && !Array.isArray(result.toolOutput.deleted_event)
  ) {
    const deleted = result.toolOutput.deleted_event as ScheduleEvent;
    const progress = context.weddingContext.progress as Record<string, unknown>;
    const events = inspectScheduleEvents(progress).events.filter(
      (candidate) => candidate.id !== deleted.id,
    );
    context.weddingContext.progress = {
      ...progress,
      __events: events,
    } as unknown as ToolExecutionContext["weddingContext"]["progress"];
  }
  if (
    result.toolName === "add_amora_action"
    && isRecord(result.toolOutput.action)
  ) {
    const action = result.toolOutput.action;
    const progress = context.weddingContext.progress as Record<string, unknown>;
    const current = Array.isArray(progress.__amora_actions)
      ? progress.__amora_actions.filter(isRecord)
      : [];
    context.weddingContext.progress = {
      ...progress,
      __amora_actions: [
        action,
        ...current.filter((candidate) => candidate.id !== action.id),
      ].slice(0, 80),
    } as unknown as ToolExecutionContext["weddingContext"]["progress"];
  }
  if (
    result.toolName === "update_amora_action"
    && isRecord(result.toolOutput.action)
  ) {
    const action = result.toolOutput.action;
    const progress = context.weddingContext.progress as Record<string, unknown>;
    const current = Array.isArray(progress.__amora_actions)
      ? progress.__amora_actions.filter(isRecord)
      : [];
    context.weddingContext.progress = {
      ...progress,
      __amora_actions: current.map((candidate) =>
        candidate.id === action.id ? action : candidate
      ),
    } as unknown as ToolExecutionContext["weddingContext"]["progress"];
  }
}
