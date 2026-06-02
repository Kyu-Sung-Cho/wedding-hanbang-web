import { createClient } from "@supabase/supabase-js";
import type { ToolExecutionResult, ScheduleEvent } from "@/types/database.types";
import { CHECKLIST_MAP } from "@/constants/checklists";
import { mergeChecklist, calculateStatus } from "@/utils/checklist";
import {
  getNationalTotal, getSeoulTotal, getLatestPeriodId,
  VENUE_NECESSARY, SDM_PACKAGES, DRESS_PRICES, MAKEUP_PRICES,
  OPTION_PRICES, SEASONAL_DATA, PRICE_PERIODS,
  getVenueOptionalItems, getRegionalCosts, REGION_LABELS,
} from "@/constants/marketPrices";
import {
  analyzeAmoraQuoteCheck,
  getQuoteCheckItems,
  type AmoraQuoteCategory,
  type AmoraQuoteRegion,
} from "@/lib/amora/quoteCheck";
import {
  getAmoraActions,
  createAmoraActionId,
  withAddedAmoraAction,
  withUpdatedAmoraAction,
  getActionStatusLabel,
  type AmoraActionItem,
  type AmoraActionPriority,
  type AmoraActionSource,
  type AmoraActionStatus,
} from "@/lib/amora/actions";
import {
  HIDDEN_COSTS, RED_FLAGS, getGradeFromScore, estimateHiddenCosts,
  type HiddenCostItem, type RedFlag,
} from "@/constants/hiddenCosts";
import {
  ymdInKst,
  kstMidnightFromYmd,
  todayKstMidnight,
  addDaysUtc,
} from "@/lib/utils/kstDate";

export const CATEGORY_LABELS: Record<string, string> = {
  meeting: "상견례",
  venue: "예식장",
  studio: "스튜디오",
  dress: "드레스/턱시도",
  makeup: "메이크업",
  ring: "예물(반지)",
  hanbok: "한복",
  yedan: "예단",
  honeymoon: "신혼여행",
  houseware: "혼수(가전/가구)",
  housing: "신혼집",
  invitation: "청첩장",
  snap: "본식 스냅/영상",
  shoes: "웨딩 구두",
  bouquet: "부케/꽃장식",
  gift: "답례품",
  mc: "사회/축가",
  ham: "함",
  pyebaek: "폐백",
};

const STATUS_LABELS: Record<string, string> = {
  not_started: "시작전",
  in_progress: "진행중",
  completed: "완료",
};

const CATEGORY_RATIOS: Record<string, number> = {
  meeting: 0.01,
  venue: 0.20,
  studio: 0.09,
  dress: 0.07,
  makeup: 0.04,
  ring: 0.10,
  hanbok: 0.03,
  yedan: 0.04,
  honeymoon: 0.10,
  houseware: 0.06,
  housing: 0.10,
  invitation: 0.02,
  snap: 0.04,
  shoes: 0.01,
  bouquet: 0.01,
  gift: 0.02,
  mc: 0.01,
  ham: 0.01,
  pyebaek: 0.01,
  reserve: 0.03,
};

function hasFinalConsonant(value: string): boolean {
  const chars = [...value.trim()];
  const last = chars[chars.length - 1];
  if (!last) return false;
  const code = last.charCodeAt(0) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
}

function subjectParticle(value: string) {
  return hasFinalConsonant(value) ? "이" : "가";
}

function objectParticle(value: string) {
  return hasFinalConsonant(value) ? "을" : "를";
}

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function formatWon(amount: number): string {
  return `${Math.round(amount / 10000).toLocaleString()}만원`;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HH_00_RE = /^\d{2}:00$/;

function isValidHourTime(value: string): boolean {
  if (!HH_00_RE.test(value)) return false;
  const hour = Number(value.slice(0, 2));
  return Number.isInteger(hour) && hour >= 0 && hour <= 23;
}

function toValidYmd(year: number, month: number, day: number): string | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 2000 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const ymd = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return ymdInKst(kstMidnightFromYmd(ymd)) === ymd ? ymd : null;
}

function isValidYmd(value: string): boolean {
  return YMD_RE.test(value) && ymdInKst(kstMidnightFromYmd(value)) === value;
}

function resolveMonthDayToFuture(
  month: number,
  day: number,
  todayYmd: string,
  modifier?: string
): string | null {
  const thisYear = Number(todayYmd.slice(0, 4));
  let year = thisYear;

  if (modifier) {
    const compact = modifier.replace(/\s+/g, "");
    if (compact === "내년") year = thisYear + 1;
    else if (compact === "내후년") year = thisYear + 2;
  } else {
    const candidate = toValidYmd(year, month, day);
    if (candidate && candidate < todayYmd) year += 1;
  }

  return toValidYmd(year, month, day);
}

function extractRequestedBookingDate(text: string | undefined, todayYmd = ymdInKst()): string | null {
  if (!text) return null;

  const candidates: Array<{ index: number; ymd: string }> = [];
  const addCandidate = (index: number | undefined, ymd: string | null) => {
    if (index !== undefined && ymd && YMD_RE.test(ymd)) {
      candidates.push({ index, ymd });
    }
  };

  for (const match of text.matchAll(/\[date:(\d{4}-\d{2}-\d{2})\]/gi)) {
    addCandidate(match.index, match[1]);
  }

  for (const match of text.matchAll(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/g)) {
    addCandidate(match.index, toValidYmd(Number(match[1]), Number(match[2]), Number(match[3])));
  }

  for (const match of text.matchAll(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/g)) {
    addCandidate(match.index, toValidYmd(Number(match[1]), Number(match[2]), Number(match[3])));
  }

  for (const match of text.matchAll(/(내후년|내년|올해|이번\s*해|금년)?\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/g)) {
    const prefix = text.slice(Math.max(0, (match.index ?? 0) - 8), match.index ?? 0);
    if (/\d{4}\s*년\s*$/.test(prefix)) continue;
    addCandidate(
      match.index,
      resolveMonthDayToFuture(Number(match[2]), Number(match[3]), todayYmd, match[1])
    );
  }

  candidates.sort((a, b) => a.index - b.index);
  return candidates.at(-1)?.ymd ?? null;
}

interface ExecutionContext {
  coupleId: string;
  currentUserText?: string;
  weddingContext: {
    weddingDate: string | null;
    budget: number;
    venue: string | null;
    progress: Record<string, { category: string; status: string }>;
  };
}

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolExecutionResult> {
  try {
    switch (toolName) {
      case "update_budget":
        return await executeUpdateBudget(toolInput, context);
      case "update_wedding_date":
        return await executeUpdateWeddingDate(toolInput, context);
      case "update_task_status":
        return await executeUpdateTaskStatus(toolInput, context);
      case "update_venue":
        return await executeUpdateVenue(toolInput, context);
      case "update_category_budget":
        return await executeUpdateCategoryBudget(toolInput, context);
      case "apply_budget_plan":
        return await executeApplyBudgetPlan(toolInput, context);
      case "add_custom_category":
        return await executeAddCustomCategory(toolInput, context);
      case "delete_category":
        return await executeDeleteCategory(toolInput, context);
      case "reset_category":
        return await executeResetCategory(toolInput, context);
      case "get_budget_summary":
        return executeGetBudgetSummary(context);
      case "get_schedule_summary":
        return executeGetScheduleSummary(context);
      case "get_wedding_info":
        return executeGetWeddingInfo(context);
      case "add_schedule_event":
        return await executeAddScheduleEvent(toolInput, context);
      case "update_schedule_event":
        return await executeUpdateScheduleEvent(toolInput, context);
      case "delete_schedule_event":
        return await executeDeleteScheduleEvent(toolInput, context);
      case "toggle_checklist_item":
        return await executeToggleChecklistItem(toolInput, context);
      case "get_schedule_events":
        return executeGetScheduleEvents(toolInput, context);
      case "add_amora_action":
        return await executeAddAmoraAction(toolInput, context);
      case "get_amora_actions":
        return executeGetAmoraActions(toolInput, context);
      case "update_amora_action":
        return await executeUpdateAmoraAction(toolInput, context);
      case "search_vendors":
        return await executeSearchVendors(toolInput, context);
      case "check_vendor_availability":
        return await executeCheckVendorAvailability(toolInput);
      case "recommend_vendors":
        return await executeRecommendVendors(toolInput, context);
      case "get_vendor_detail":
        return await executeGetVendorDetail(toolInput);
      case "get_available_slots":
        return await executeGetAvailableSlots(toolInput);
      case "create_booking":
        return await executeCreateBooking(toolInput, context);
      case "get_my_bookings":
        return await executeGetMyBookings(toolInput, context);
      case "cancel_booking":
        return await executeCancelBooking(toolInput, context);
      case "get_market_price":
        return executeGetMarketPrice(toolInput);
      case "search_nearby_places":
        return await executeSearchNearbyPlaces(toolInput);
      case "analyze_quote":
        return executeAnalyzeQuoteWithTrustEngine(toolInput);
      default:
        return {
          toolName,
          toolInput,
          toolOutput: {},
          success: false,
          displayMessage: `알 수 없는 도구: ${toolName}`,
        };
    }
  } catch (err) {
    return {
      toolName,
      toolInput,
      toolOutput: { error: String(err) },
      success: false,
      displayMessage: "처리 중 오류가 발생했습니다.",
    };
  }
}

async function executeUpdateBudget(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const newBudget = input.total_budget as number;
  const oldBudget = ctx.weddingContext.budget;

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ total_budget: newBudget })
    .eq("couple_id", ctx.coupleId);

  if (error) throw error;

  // 컨텍스트도 업데이트
  ctx.weddingContext.budget = newBudget;

  return {
    toolName: "update_budget",
    toolInput: input,
    toolOutput: { total_budget: newBudget, previous_budget: oldBudget },
    success: true,
    displayMessage: `총 예산이 ${formatWon(oldBudget)}에서 ${formatWon(newBudget)}으로 변경되었습니다.`,
  };
}

async function executeUpdateWeddingDate(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const newDate = input.wedding_date as string;
  const oldDate = ctx.weddingContext.weddingDate;

  // 1) YYYY-MM-DD 포맷 검증
  if (typeof newDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    return {
      toolName: "update_wedding_date",
      toolInput: input,
      toolOutput: {
        error: "invalid_format",
        message: `'wedding_date'는 YYYY-MM-DD 형식이어야 합니다. 받은 값: ${String(newDate)}`,
      },
      success: false,
      displayMessage: `날짜 형식이 잘못되었습니다. 다시 시도해주세요.`,
    };
  }

  // 2) 유효한 달력 날짜인지 (예: 2026-02-31 거부)
  const parsed = new Date(`${newDate}T00:00:00`);
  if (isNaN(parsed.getTime())) {
    return {
      toolName: "update_wedding_date",
      toolInput: input,
      toolOutput: { error: "invalid_date", message: `유효하지 않은 날짜: ${newDate}` },
      success: false,
      displayMessage: `유효하지 않은 날짜입니다: ${newDate}`,
    };
  }

  // 3) 과거 날짜 거부 — AI 연도 추론 실수 방어 (오늘 자정 기준)
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (parsed < todayStart) {
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return {
      toolName: "update_wedding_date",
      toolInput: input,
      toolOutput: {
        error: "past_date_rejected",
        attempted: newDate,
        today: todayIso,
        message: `${newDate}는 오늘(${todayIso}) 이전입니다. 결혼 예정일은 미래 날짜여야 합니다. 사용자에게 정확한 연도를 다시 확인하세요. (예: '내년 3월 12일' → ${now.getFullYear() + 1}-03-12)`,
      },
      success: false,
      displayMessage: `과거 날짜(${newDate})는 결혼 예정일로 설정할 수 없습니다.`,
    };
  }

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ wedding_date: newDate })
    .eq("couple_id", ctx.coupleId);

  if (error) throw error;

  ctx.weddingContext.weddingDate = newDate;

  const dDay = Math.ceil(
    (parsed.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  return {
    toolName: "update_wedding_date",
    toolInput: input,
    toolOutput: { wedding_date: newDate, previous_date: oldDate, d_day: dDay },
    success: true,
    displayMessage: `결혼 예정일이 ${newDate}로 변경되었습니다. (D-${dDay})`,
  };
}

async function executeUpdateTaskStatus(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const category = input.category as string;
  const status = input.status as string;
  const label = CATEGORY_LABELS[category] || category;
  const statusLabel = STATUS_LABELS[status] || status;

  const newProgress = {
    ...ctx.weddingContext.progress,
    [category]: { category, status },
  };

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ progress: newProgress })
    .eq("couple_id", ctx.coupleId);

  if (error) throw error;

  ctx.weddingContext.progress = newProgress;

  return {
    toolName: "update_task_status",
    toolInput: input,
    toolOutput: { category, status, label, statusLabel },
    success: true,
    displayMessage: `${label} 상태가 "${statusLabel}"(으)로 변경되었습니다.`,
  };
}

async function executeUpdateCategoryBudget(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const category = input.category as string;
  const label = CATEGORY_LABELS[category] || category;

  const existing = ctx.weddingContext.progress[category] ?? { category, status: "not_started" };
  const updates: Record<string, unknown> = { ...existing, category };
  const changes: string[] = [];

  if (input.budget !== undefined) {
    const newBudget = input.budget as number;
    updates.budget = newBudget;
    changes.push(`예산 ${formatWon(newBudget)}`);
  }
  if (input.spent !== undefined) {
    const newSpent = input.spent as number;
    updates.spent = newSpent;
    changes.push(`지출 ${formatWon(newSpent)}`);
  }

  const newProgress = {
    ...ctx.weddingContext.progress,
    [category]: updates,
  };

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ progress: newProgress })
    .eq("couple_id", ctx.coupleId);
  if (error) throw error;

  ctx.weddingContext.progress = newProgress as unknown as ExecutionContext["weddingContext"]["progress"];

  return {
    toolName: "update_category_budget",
    toolInput: input,
    toolOutput: { category, label, ...updates },
    success: true,
    displayMessage: `${label} ${changes.join(", ")}(으)로 설정되었습니다.`,
  };
}

// 예산 인터뷰 후 카테고리 일괄 배분 — 가중치 반영된 plan 한 번에 적용.
// allocations 합계가 total_budget 보다 작으면 잔여분은 reserve(예비비)로 자동 배정.
// intake_summary 는 decision_nodes 에 preference 로 저장돼 나중에 vendor 매칭 시 자동 참조됨.
async function executeApplyBudgetPlan(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const totalBudget = input.total_budget as number;
  const allocations = (input.allocations ?? []) as Array<{
    category: string;
    budget: number;
    rationale?: string;
  }>;
  const intakeSummary = (input.intake_summary as string | undefined) ?? "";

  if (!Array.isArray(allocations) || allocations.length === 0) {
    throw new Error("allocations 가 비어 있어 예산 계획을 적용할 수 없습니다.");
  }

  // 합계 검증 — 초과 시 차단, 미달 시 잔여분 reserve 로 보강
  const allocSum = allocations.reduce((acc, a) => acc + (Number(a.budget) || 0), 0);
  if (allocSum > totalBudget) {
    throw new Error(
      `카테고리 합계(${formatWon(allocSum)})가 총 예산(${formatWon(totalBudget)})을 초과합니다.`
    );
  }

  // 잔여분이 있으면 reserve 에 자동 추가
  const remainder = totalBudget - allocSum;
  const finalAllocations = [...allocations];
  if (remainder > 0) {
    const reserveIdx = finalAllocations.findIndex((a) => a.category === "reserve");
    if (reserveIdx >= 0) {
      finalAllocations[reserveIdx] = {
        ...finalAllocations[reserveIdx],
        budget: finalAllocations[reserveIdx].budget + remainder,
      };
    } else {
      finalAllocations.push({
        category: "reserve",
        budget: remainder,
        rationale: "총 예산 잔여분 자동 배정",
      });
    }
  }

  // progress 갱신 — 기존 status/checklist 보존하면서 budget 만 덮어쓰기
  const newProgress: Record<string, unknown> = { ...ctx.weddingContext.progress };
  for (const alloc of finalAllocations) {
    const existing = (newProgress[alloc.category] ?? {
      category: alloc.category,
      status: "not_started",
    }) as Record<string, unknown>;
    newProgress[alloc.category] = {
      ...existing,
      category: alloc.category,
      budget: alloc.budget,
    };
  }

  const admin = getAdminClient();

  // 총 예산 + progress 한 번에 갱신
  const { error: journeyError } = await admin
    .from("wedding_journeys")
    .update({ total_budget: totalBudget, progress: newProgress })
    .eq("couple_id", ctx.coupleId);
  if (journeyError) throw journeyError;

  // 컨텍스트도 즉시 동기화
  ctx.weddingContext.budget = totalBudget;
  ctx.weddingContext.progress = newProgress as ExecutionContext["weddingContext"]["progress"];

  // intake_summary 를 decision_nodes 에 preference 로 저장 (있을 때만)
  // 다음 vendor 추천 / 갈등 중재 시 system prompt 에 자동 주입됨.
  if (intakeSummary && intakeSummary.trim().length > 0) {
    try {
      await admin.from("decision_nodes").insert({
        couple_id: ctx.coupleId,
        category: "preference",
        decision_type: "considering",
        title: "예산 인터뷰에서 드러난 우선순위",
        value: intakeSummary.trim(),
        reasoning: allocations
          .filter((a) => a.rationale && a.rationale.trim().length > 0)
          .map((a) => `${CATEGORY_LABELS[a.category] ?? a.category}: ${a.rationale}`)
          .join(" / "),
        confidence: 0.85,
        source: "amora_budget_intake",
      });
    } catch (insightErr) {
      // 저장 실패해도 예산 적용 자체는 성공으로 처리 — 사용자 흐름 우선
      console.warn("budget intake summary 저장 실패(무시):", insightErr);
    }
  }

  const lines = finalAllocations
    .filter((a) => a.budget > 0)
    .map((a) => `  • ${CATEGORY_LABELS[a.category] ?? a.category}: ${formatWon(a.budget)}`)
    .join("\n");

  return {
    toolName: "apply_budget_plan",
    toolInput: input,
    toolOutput: {
      total_budget: totalBudget,
      applied_count: finalAllocations.length,
      remainder_to_reserve: remainder,
    },
    success: true,
    displayMessage: `총 예산 ${formatWon(totalBudget)} 기준 카테고리 ${finalAllocations.length}개 배분 적용 완료${remainder > 0 ? ` (잔여 ${formatWon(remainder)} 예비비로 자동 배정)` : ""}.\n${lines}`,
  };
}

// 커스텀 카테고리 추가
async function executeAddCustomCategory(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const label = input.label as string;
  const key = `custom_${Date.now()}`;
  const updates: Record<string, unknown> = {
    category: key,
    label,
    status: "in_progress",
  };
  const changes: string[] = [];

  if (input.budget !== undefined) {
    updates.budget = input.budget as number;
    changes.push(`예산 ${formatWon(input.budget as number)}`);
  }
  if (input.spent !== undefined) {
    updates.spent = input.spent as number;
    changes.push(`지출 ${formatWon(input.spent as number)}`);
  }

  const newProgress = {
    ...ctx.weddingContext.progress,
    [key]: updates,
  };

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ progress: newProgress })
    .eq("couple_id", ctx.coupleId);
  if (error) throw error;

  ctx.weddingContext.progress = newProgress as unknown as ExecutionContext["weddingContext"]["progress"];

  const desc = changes.length > 0 ? ` (${changes.join(", ")})` : "";
  return {
    toolName: "add_custom_category",
    toolInput: input,
    toolOutput: { key, label, ...updates },
    success: true,
    displayMessage: `새 카테고리 "${label}"${subjectParticle(label)} 추가되었습니다${desc}.`,
  };
}

async function executeDeleteCategory(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const key = input.category as string;
  const isKnown = key in CATEGORY_LABELS;
  const progress = ctx.weddingContext.progress as Record<string, unknown>;
  const label = isKnown
    ? CATEGORY_LABELS[key]
    : (progress[key] as Record<string, unknown>)?.label as string ?? key;

  if (isKnown) {
    // 고정 카테고리: __hidden 리스트에 추가 + progress에서 데이터 제거
    const hiddenList: string[] = (progress.__hidden as string[]) ?? [];
    if (hiddenList.includes(key)) {
      return {
        toolName: "delete_category",
        toolInput: input,
        toolOutput: { deleted: false },
        success: false,
        displayMessage: `"${label}"은(는) 이미 삭제되어 있습니다.`,
      };
    }
    const { [key]: _removed, ...rest } = progress;
    const newProgress = { ...rest, __hidden: [...hiddenList, key] };

    const admin = getAdminClient();
    const { error } = await admin
      .from("wedding_journeys")
      .update({ progress: newProgress })
      .eq("couple_id", ctx.coupleId);
    if (error) throw error;

    ctx.weddingContext.progress = newProgress as unknown as ExecutionContext["weddingContext"]["progress"];
  } else {
    // 커스텀 카테고리: progress에서 완전히 제거
    if (!progress[key]) {
      return {
        toolName: "delete_category",
        toolInput: input,
        toolOutput: { deleted: false },
        success: false,
        displayMessage: `"${key}" 카테고리를 찾을 수 없습니다.`,
      };
    }
    const { [key]: _removed, ...rest } = progress;

    const admin = getAdminClient();
    const { error } = await admin
      .from("wedding_journeys")
      .update({ progress: rest })
      .eq("couple_id", ctx.coupleId);
    if (error) throw error;

    ctx.weddingContext.progress = rest as unknown as ExecutionContext["weddingContext"]["progress"];
  }

  return {
    toolName: "delete_category",
    toolInput: input,
    toolOutput: { key, label, deleted: true },
    success: true,
    displayMessage: `"${label}" 카테고리가 삭제되었습니다.`,
  };
}

async function executeResetCategory(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const key = input.category as string;
  const progress = ctx.weddingContext.progress as Record<string, unknown>;
  const isKnown = key in CATEGORY_LABELS;
  const label = isKnown
    ? CATEGORY_LABELS[key]
    : (progress[key] as Record<string, unknown>)?.label as string ?? key;

  const { [key]: _removed, ...rest } = progress;

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ progress: rest })
    .eq("couple_id", ctx.coupleId);
  if (error) throw error;

  ctx.weddingContext.progress = rest as unknown as ExecutionContext["weddingContext"]["progress"];

  return {
    toolName: "reset_category",
    toolInput: input,
    toolOutput: { key, label, reset: true },
    success: true,
    displayMessage: `"${label}" 카테고리의 데이터가 초기화되었습니다.`,
  };
}

async function executeUpdateVenue(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const venue = input.venue as string;
  const oldVenue = ctx.weddingContext.venue;

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ venue })
    .eq("couple_id", ctx.coupleId);

  if (error) throw error;

  ctx.weddingContext.venue = venue;

  return {
    toolName: "update_venue",
    toolInput: input,
    toolOutput: { venue, previous_venue: oldVenue },
    success: true,
    displayMessage: `예식장이 "${venue}"(으)로 설정되었습니다.`,
  };
}

function executeGetBudgetSummary(ctx: ExecutionContext): ToolExecutionResult {
  const total = ctx.weddingContext.budget;
  const progress = ctx.weddingContext.progress;

  const categories = Object.entries(CATEGORY_RATIOS).map(([key, ratio]) => {
    const allocated = Math.round(total * ratio);
    const p = progress[key];
    let spent = 0;
    if (p?.status === "completed") spent = allocated;
    else if (p?.status === "in_progress") spent = Math.round(allocated * 0.4);

    return {
      key,
      label: CATEGORY_LABELS[key] || key,
      allocated,
      spent,
      status: p?.status || "not_started",
    };
  });

  const totalSpent = categories.reduce((s, c) => s + c.spent, 0);
  const remaining = total - totalSpent;

  return {
    toolName: "get_budget_summary",
    toolInput: {},
    toolOutput: {
      total_budget: total,
      total_spent: totalSpent,
      remaining,
      categories,
    },
    success: true,
    displayMessage: `총 예산 ${formatWon(total)} / 사용 ${formatWon(totalSpent)} / 잔여 ${formatWon(remaining)}`,
  };
}

function executeGetScheduleSummary(ctx: ExecutionContext): ToolExecutionResult {
  const progress = ctx.weddingContext.progress;
  const allKeys = Object.keys(CATEGORY_LABELS);

  const completed = allKeys.filter(
    (k) => progress[k]?.status === "completed"
  );
  const inProgress = allKeys.filter(
    (k) => progress[k]?.status === "in_progress"
  );
  const notStarted = allKeys.filter(
    (k) => !progress[k] || progress[k].status === "not_started"
  );

  return {
    toolName: "get_schedule_summary",
    toolInput: {},
    toolOutput: {
      total: allKeys.length,
      completed: completed.map((k) => CATEGORY_LABELS[k]),
      in_progress: inProgress.map((k) => CATEGORY_LABELS[k]),
      not_started: notStarted.map((k) => CATEGORY_LABELS[k]),
      progress_percent: Math.round((completed.length / allKeys.length) * 100),
    },
    success: true,
    displayMessage: `전체 ${allKeys.length}개 중 완료 ${completed.length}개, 진행중 ${inProgress.length}개, 시작전 ${notStarted.length}개 (${Math.round((completed.length / allKeys.length) * 100)}%)`,
  };
}

// ---- 일정 이벤트 관련 도구 ----

function getEventsFromProgress(progress: Record<string, unknown>): ScheduleEvent[] {
  return ((progress as Record<string, unknown>).__events as ScheduleEvent[] | undefined) ?? [];
}

function getCategoryEventSourceKey(categoryKey: string): string {
  return `category:${categoryKey}`;
}

function normalizeEventText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function findCategoryScheduleEvent(
  events: ScheduleEvent[],
  categoryKey: string | undefined
): ScheduleEvent | undefined {
  if (!categoryKey || categoryKey === "general") return undefined;

  const sourceKey = getCategoryEventSourceKey(categoryKey);
  const label = normalizeEventText(CATEGORY_LABELS[categoryKey]);

  return (
    events.find((event) => event.sourceKey === sourceKey) ??
    (label
      ? events.find(
          (event) =>
            event.categoryKey === categoryKey &&
            normalizeEventText(event.title) === label
        )
      : undefined) ??
    (label
      ? events.find(
          (event) =>
            event.categoryKey === categoryKey &&
            normalizeEventText(event.title).startsWith(label)
        )
      : undefined)
  );
}

async function executeAddScheduleEvent(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const date = input.date as string;
  const title = input.title as string;
  const memo = input.memo as string | undefined;
  const categoryKey = input.category_key as string | undefined;

  const events = getEventsFromProgress(ctx.weddingContext.progress as Record<string, unknown>);
  const now = new Date().toISOString();
  const existingCategoryEvent = findCategoryScheduleEvent(events, categoryKey);
  const sourceKey =
    categoryKey && categoryKey !== "general"
      ? getCategoryEventSourceKey(categoryKey)
      : undefined;

  if (existingCategoryEvent) {
    const updatedEvent: ScheduleEvent = {
      ...existingCategoryEvent,
      date,
      title,
      memo: memo ?? existingCategoryEvent.memo,
      categoryKey,
      sourceKey,
      updatedAt: now,
    };
    const updatedEvents = events.map((event) =>
      event.id === existingCategoryEvent.id ? updatedEvent : event
    );
    const newProgress = { ...ctx.weddingContext.progress, __events: updatedEvents };

    const admin = getAdminClient();
    const { error } = await admin
      .from("wedding_journeys")
      .update({ progress: newProgress })
      .eq("couple_id", ctx.coupleId);
    if (error) throw error;

    ctx.weddingContext.progress = newProgress as unknown as ExecutionContext["weddingContext"]["progress"];

    return {
      toolName: "add_schedule_event",
      toolInput: input,
      toolOutput: { event: updatedEvent, upserted: true, replaced_event_id: existingCategoryEvent.id },
      success: true,
      displayMessage: `${CATEGORY_LABELS[categoryKey ?? ""] ?? title} 일정이 ${date}로 업데이트되었습니다.`,
    };
  }

  const newEvent: ScheduleEvent = {
    id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    date, title, memo, categoryKey, sourceKey, createdAt: now, updatedAt: now,
  };

  const newProgress = { ...ctx.weddingContext.progress, __events: [...events, newEvent] };

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ progress: newProgress })
    .eq("couple_id", ctx.coupleId);
  if (error) throw error;

  ctx.weddingContext.progress = newProgress as unknown as ExecutionContext["weddingContext"]["progress"];

  return {
    toolName: "add_schedule_event", toolInput: input,
    toolOutput: { event: newEvent },
    success: true,
    displayMessage: `${date}에 "${title}" 일정이 추가되었습니다.`,
  };
}

async function executeUpdateScheduleEvent(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const eventId = input.event_id as string;
  const events = getEventsFromProgress(ctx.weddingContext.progress as Record<string, unknown>);
  const existing = events.find((e) => e.id === eventId);
  if (!existing) {
    return {
      toolName: "update_schedule_event", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: `일정을 찾을 수 없습니다 (ID: ${eventId})`,
    };
  }

  const updates: Partial<ScheduleEvent> = {};
  if (input.date) updates.date = input.date as string;
  if (input.title) updates.title = input.title as string;
  if (input.memo !== undefined) updates.memo = input.memo as string;

  const updatedEvents = events.map((e) =>
    e.id === eventId ? { ...e, ...updates, updatedAt: new Date().toISOString() } : e
  );
  const newProgress = { ...ctx.weddingContext.progress, __events: updatedEvents };

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ progress: newProgress })
    .eq("couple_id", ctx.coupleId);
  if (error) throw error;

  ctx.weddingContext.progress = newProgress as unknown as ExecutionContext["weddingContext"]["progress"];
  const updated = updatedEvents.find((e) => e.id === eventId)!;

  return {
    toolName: "update_schedule_event", toolInput: input,
    toolOutput: { event: updated, updates },
    success: true,
    displayMessage: `"${updated.title}" 일정이 수정되었습니다.`,
  };
}

async function executeDeleteScheduleEvent(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const eventId = input.event_id as string;
  const events = getEventsFromProgress(ctx.weddingContext.progress as Record<string, unknown>);
  const existing = events.find((e) => e.id === eventId);
  if (!existing) {
    return {
      toolName: "delete_schedule_event", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: `일정을 찾을 수 없습니다 (ID: ${eventId})`,
    };
  }

  const newProgress = {
    ...ctx.weddingContext.progress,
    __events: events.filter((e) => e.id !== eventId),
  };

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ progress: newProgress })
    .eq("couple_id", ctx.coupleId);
  if (error) throw error;

  ctx.weddingContext.progress = newProgress as unknown as ExecutionContext["weddingContext"]["progress"];

  return {
    toolName: "delete_schedule_event", toolInput: input,
    toolOutput: { deleted_event: existing },
    success: true,
    displayMessage: `"${existing.title}" (${existing.date}) 일정이 삭제되었습니다.`,
  };
}

async function executeToggleChecklistItem(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const category = input.category as string;
  const itemId = input.item_id as string;
  const done = input.done as boolean;
  const label = CATEGORY_LABELS[category] || category;

  const template = CHECKLIST_MAP[category];
  if (!template) {
    return {
      toolName: "toggle_checklist_item", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: `알 수 없는 카테고리: ${category}`,
    };
  }

  const existing = ctx.weddingContext.progress[category];
  const merged = mergeChecklist(
    template.items,
    (existing as { checklist?: { id: string; label: string; done: boolean }[] })?.checklist,
    (existing?.status as "not_started" | "in_progress" | "completed") ?? "not_started"
  );
  const updated = merged.map((c) => (c.id === itemId ? { ...c, done } : c));
  const newStatus = calculateStatus(updated);
  const item = updated.find((c) => c.id === itemId);

  if (!item) {
    return {
      toolName: "toggle_checklist_item", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: `항목을 찾을 수 없습니다 (ID: ${itemId})`,
    };
  }

  const newProgress = {
    ...ctx.weddingContext.progress,
    [category]: {
      ...(existing ?? { category }),
      category, status: newStatus, checklist: updated,
    },
  };

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ progress: newProgress })
    .eq("couple_id", ctx.coupleId);
  if (error) throw error;

  ctx.weddingContext.progress = newProgress as ExecutionContext["weddingContext"]["progress"];

  return {
    toolName: "toggle_checklist_item", toolInput: input,
    toolOutput: { category, item_id: itemId, done, new_status: newStatus, item_label: item.label },
    success: true,
    displayMessage: `${label} - "${item.label}" ${done ? "완료" : "미완료"}로 변경되었습니다.`,
  };
}

function executeGetScheduleEvents(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): ToolExecutionResult {
  const events = getEventsFromProgress(ctx.weddingContext.progress as Record<string, unknown>);
  const today = ymdInKst();
  const fromDate = (input.from_date as string) || today;

  let toDate = input.to_date as string;
  if (!toDate) {
    toDate = ymdInKst(addDaysUtc(kstMidnightFromYmd(fromDate), 30));
  }

  const filtered = events
    .filter((e) => e.date >= fromDate && e.date <= toDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    toolName: "get_schedule_events", toolInput: input,
    toolOutput: {
      events: filtered,
      count: filtered.length,
      from_date: fromDate,
      to_date: toDate,
    },
    success: true,
    displayMessage: filtered.length > 0
      ? `${fromDate} ~ ${toDate} 기간에 ${filtered.length}개 일정: ${filtered.map((e) => `${e.date} ${e.title}`).join(", ")}`
      : `${fromDate} ~ ${toDate} 기간에 등록된 일정이 없습니다.`,
  };
}

function normalizeActionPriority(value: unknown): AmoraActionPriority {
  return value === "high" || value === "low" || value === "medium" ? value : "medium";
}

function normalizeActionSource(value: unknown): AmoraActionSource {
  if (
    value === "quote" ||
    value === "schedule" ||
    value === "budget" ||
    value === "guardrail" ||
    value === "manual" ||
    value === "chat"
  ) {
    return value;
  }
  return "chat";
}

function normalizeActionStatus(value: unknown): AmoraActionStatus | undefined {
  if (value === "open" || value === "done" || value === "dismissed") return value;
  return undefined;
}

function getDefaultActionHref(categoryKey?: string, source?: AmoraActionSource) {
  if (source === "quote") return "/community/quote-check";
  if (source === "budget") return "/budget";
  if (source === "schedule") return "/schedule";
  if (categoryKey === "invitation") return "/schedule";
  if (categoryKey === "mc" || categoryKey === "gift") return "/scripts";
  return "/lounge";
}

async function saveProgress(ctx: ExecutionContext, progress: Record<string, unknown>) {
  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ progress })
    .eq("couple_id", ctx.coupleId);
  if (error) throw error;
  ctx.weddingContext.progress = progress as unknown as ExecutionContext["weddingContext"]["progress"];
}

async function executeAddAmoraAction(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const title = String(input.title ?? "").trim();
  if (!title) {
    return {
      toolName: "add_amora_action",
      toolInput: input,
      toolOutput: { error: "title is required" },
      success: false,
      displayMessage: "저장할 행동 제목이 필요합니다.",
    };
  }

  const categoryKey = input.category_key && input.category_key !== "general"
    ? String(input.category_key)
    : undefined;
  const source = normalizeActionSource(input.source);
  const href = typeof input.href === "string" && input.href.startsWith("/")
    ? input.href
    : getDefaultActionHref(categoryKey, source);
  const actionId = createAmoraActionId();

  const newProgress = withAddedAmoraAction(ctx.weddingContext.progress as Record<string, unknown>, {
    id: actionId,
    title: title.slice(0, 80),
    description: typeof input.description === "string" ? input.description.slice(0, 300) : undefined,
    dueDate: typeof input.due_date === "string" ? input.due_date : undefined,
    categoryKey,
    priority: normalizeActionPriority(input.priority),
    source,
    href,
  });

  await saveProgress(ctx, newProgress);

  const actions = getAmoraActions(newProgress);
  const action = actions.find((item) => item.id === actionId);

  return {
    toolName: "add_amora_action",
    toolInput: input,
    toolOutput: { action, actions_count: actions.filter((item) => item.status === "open").length },
    success: true,
    displayMessage: `"${title}"${objectParticle(title)} 아모라 행동 카드에 저장했습니다.`,
  };
}

function executeGetAmoraActions(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): ToolExecutionResult {
  const status = typeof input.status === "string" ? input.status : "open";
  const allActions = getAmoraActions(ctx.weddingContext.progress as Record<string, unknown>);
  const actions = status === "all"
    ? allActions
    : allActions.filter((item) => item.status === status);

  return {
    toolName: "get_amora_actions",
    toolInput: input,
    toolOutput: {
      actions,
      count: actions.length,
      open_count: allActions.filter((item) => item.status === "open").length,
    },
    success: true,
    displayMessage: actions.length > 0
      ? `아모라가 기억한 행동 ${actions.length}개: ${actions.slice(0, 5).map((item) => item.title).join(", ")}`
      : "현재 열려 있는 아모라 행동 카드가 없습니다.",
  };
}

async function executeUpdateAmoraAction(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const actionId = String(input.action_id ?? "");
  const currentProgress = ctx.weddingContext.progress as Record<string, unknown>;
  const currentActions = getAmoraActions(currentProgress);
  const existing = currentActions.find((item) => item.id === actionId);

  if (!existing) {
    return {
      toolName: "update_amora_action",
      toolInput: input,
      toolOutput: { error: "action not found", action_id: actionId },
      success: false,
      displayMessage: "수정할 아모라 행동 카드를 찾지 못했습니다.",
    };
  }

  const updates: Partial<Pick<AmoraActionItem, "title" | "description" | "dueDate" | "priority" | "status" | "href">> = {};
  if (typeof input.title === "string") updates.title = input.title.slice(0, 80);
  if (typeof input.description === "string") updates.description = input.description.slice(0, 300);
  if (typeof input.due_date === "string") updates.dueDate = input.due_date;
  if (typeof input.href === "string" && input.href.startsWith("/")) updates.href = input.href;
  if (input.priority !== undefined) updates.priority = normalizeActionPriority(input.priority);
  if (input.status !== undefined) {
    const status = normalizeActionStatus(input.status);
    if (status) updates.status = status;
  }

  const newProgress = withUpdatedAmoraAction(currentProgress, actionId, updates);
  await saveProgress(ctx, newProgress);
  const updated = getAmoraActions(newProgress).find((item) => item.id === actionId);

  return {
    toolName: "update_amora_action",
    toolInput: input,
    toolOutput: { action: updated },
    success: true,
    displayMessage: updated
      ? `"${updated.title}" 행동 카드가 ${getActionStatusLabel(updated.status)} 상태로 변경되었습니다.`
      : "아모라 행동 카드가 수정되었습니다.",
  };
}

function executeGetWeddingInfo(ctx: ExecutionContext): ToolExecutionResult {
  const { weddingDate, budget, venue, progress } = ctx.weddingContext;

  let dDay: number | null = null;
  if (weddingDate) {
    dDay = Math.ceil(
      (new Date(weddingDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
  }

  const allKeys = Object.keys(CATEGORY_LABELS);
  const completedCount = allKeys.filter(
    (k) => progress[k]?.status === "completed"
  ).length;

  return {
    toolName: "get_wedding_info",
    toolInput: {},
    toolOutput: {
      wedding_date: weddingDate,
      d_day: dDay,
      venue,
      total_budget: budget,
      progress_percent: Math.round((completedCount / allKeys.length) * 100),
      completed_count: completedCount,
      total_categories: allKeys.length,
    },
    success: true,
    displayMessage: weddingDate
      ? `결혼 예정일: ${weddingDate} (D-${dDay}) / 예산: ${formatWon(budget)} / 진행률: ${Math.round((completedCount / allKeys.length) * 100)}%`
      : `결혼 예정일 미설정 / 예산: ${formatWon(budget)}`,
  };
}

// ── 업체 검색/추천 도구 ──

const VENDOR_CATEGORY_MAP: Record<string, string> = {
  "스튜디오": "studio", "드레스": "dress", "메이크업": "makeup",
  "예식장": "venue", "한복": "hanbok", "예물": "jewelry", "신혼여행": "honeymoon", "기타": "other",
};

async function executeSearchVendors(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const admin = getAdminClient();
  let query = admin
    .from("vendors")
    .select("id, name, category, location, region, price_range, price_min, price_max, rating, review_count, tags, ai_recommend")
    .eq("status", "approved")
    .limit((input.limit as number) || 5);

  if (input.category) {
    const dbCat = VENDOR_CATEGORY_MAP[input.category as string] || (input.category as string);
    query = query.eq("category", dbCat);
  }
  if (input.location) {
    query = query.or(`location.ilike.%${input.location}%,region.ilike.%${input.location}%`);
  }
  if (input.price_max) {
    query = query.lte("price_min", input.price_max as number);
  }
  if (input.price_min) {
    query = query.gte("price_max", input.price_min as number);
  }
  if (input.search) {
    query = query.or(`name.ilike.%${input.search}%,tags.cs.{${input.search}}`);
  }

  query = query.order("rating", { ascending: false });

  const { data: vendors, error } = await query;
  if (error) throw error;

  const results = (vendors ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    category: v.category,
    location: v.location || v.region,
    priceRange: v.price_range,
    rating: v.rating,
    reviewCount: v.review_count,
    tags: v.tags,
    aiRecommend: v.ai_recommend,
    link: `/vendors/${v.id}`,
  }));

  // 검색 로그 기록
  if (ctx.coupleId) {
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .eq("couple_id", ctx.coupleId)
      .limit(1)
      .single();
    if (profile) {
      await admin.from("search_logs").insert({
        user_id: profile.id,
        query: (input.search as string) || (input.category as string) || "AI 검색",
        category: (input.category as string) || null,
        result_count: results.length,
      }).then(() => {});
    }
  }

  return {
    toolName: "search_vendors",
    toolInput: input,
    toolOutput: { vendors: results, count: results.length },
    success: true,
    displayMessage: results.length > 0
      ? `${results.length}개 업체를 찾았습니다: ${results.map((v) => `${v.name}(${v.priceRange})`).join(", ")}`
      : "조건에 맞는 업체가 없습니다.",
  };
}

async function executeCheckVendorAvailability(
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const admin = getAdminClient();
  const vendorId = input.vendor_id as string;
  const productId = input.product_id as string | undefined;
  const targetDay = input.day as number | undefined;

  // 업체 이름 조회
  const { data: vendor } = await admin
    .from("vendors")
    .select("name")
    .eq("id", vendorId)
    .single();

  if (!vendor) {
    return {
      toolName: "check_vendor_availability", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: "업체를 찾을 수 없습니다.",
    };
  }

  // 타임슬롯 조회 — product 가 자체 일정을 정의했으면 그것만 사용, 아니면 vendor 일정.
  // ⚠️ 이전 폴백 버그: "product_timeslots 에서 그 시간 슬롯 없으면 vendor 로 떨어짐"
  // → 상품이 제공 안 하는 시간에도 예약 가능해짐. 이번엔 "product 가 슬롯 자체를
  // 하나도 안 정의했을 때만" vendor 로 폴백.
  type SlotRow2 = { day: number; hour: number; available: boolean; max_bookings: number };
  const fetchSlotsFor = async (table: string, fk: string, value: string): Promise<SlotRow2[]> => {
    let q = admin
      .from(table)
      .select("day, hour, available, max_bookings")
      .eq(fk, value)
      .eq("available", true);
    if (targetDay !== undefined) q = q.eq("day", targetDay);
    const { data } = await q;
    return (data ?? []) as SlotRow2[];
  };
  // "엔티티가 자체 active 일정 row 를 정의했는가" — available=false row 만 있으면
  // 사실상 정의 안 한 것과 동일하게 취급해 vendor 로 폴백 (이전엔 모든 row 가
  // 비활성이어도 product 권위로 잡혀 vendor 슬롯이 가려지는 버그 있었음).
  const hasAnyRows = async (table: string, fk: string, value: string): Promise<boolean> => {
    const { count } = await admin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(fk, value)
      .eq("available", true);
    return (count ?? 0) > 0;
  };

  let slots: SlotRow2[] = [];
  const productOwnsSchedule = productId ? await hasAnyRows("product_timeslots", "product_id", productId) : false;
  if (productOwnsSchedule && productId) {
    slots = await fetchSlotsFor("product_timeslots", "product_id", productId);
  } else {
    slots = await fetchSlotsFor("vendor_timeslots", "vendor_id", vendorId);
  }

  // 향후 7일 예약 수 확인 — KST 기준 (서버 UTC 자정 ≠ 한국 자정)
  const today = todayKstMidnight();
  const dateStrings: string[] = [];
  const dayToDate = new Map<number, string>();
  // KST 자정의 Date 객체에서 getUTCDay() 를 그대로 쓰면 전날 요일이 나옴.
  // YMD 문자열을 UTC로 다시 만든 뒤 getUTCDay() 로 KST 요일을 정확히 구함.
  const kstDayOfWeek = (ymd: string): number => {
    const [y, m, d] = ymd.split("-").map(Number);
    return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 0=월 ~ 6=일
  };
  for (let i = 0; i < 7; i++) {
    const dateStr = ymdInKst(addDaysUtc(today, i));
    const day = kstDayOfWeek(dateStr);
    dateStrings.push(dateStr);
    if (!dayToDate.has(day)) dayToDate.set(day, dateStr);
  }

  const { data: bookings } = await admin
    .from("vendor_bookings")
    .select("booking_date, booking_time")
    .eq("vendor_id", vendorId)
    .in("booking_date", dateStrings)
    .neq("status", "cancelled");

  const bookingCountMap = new Map<string, number>();
  for (const b of bookings ?? []) {
    const key = `${b.booking_date}:${b.booking_time}`;
    bookingCountMap.set(key, (bookingCountMap.get(key) ?? 0) + 1);
  }

  const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
  const availableSlots = slots.map((s) => {
    const dateStr = dayToDate.get(s.day);
    const timeStr = `${String(s.hour).padStart(2, "0")}:00`;
    const currentBookings = dateStr ? (bookingCountMap.get(`${dateStr}:${timeStr}`) ?? 0) : 0;
    const remaining = s.max_bookings - currentBookings;
    return {
      day: s.day,
      dayLabel: DAYS[s.day],
      hour: s.hour,
      time: timeStr,
      date: dateStr,
      maxBookings: s.max_bookings,
      currentBookings,
      remaining,
      available: remaining > 0,
    };
  }).filter((s) => s.available);

  return {
    toolName: "check_vendor_availability",
    toolInput: input,
    toolOutput: { vendorName: vendor.name, slots: availableSlots, count: availableSlots.length },
    success: true,
    displayMessage: availableSlots.length > 0
      ? `${vendor.name}의 예약 가능 시간 ${availableSlots.length}개: ${availableSlots.slice(0, 5).map((s) => `${s.dayLabel} ${s.time}(잔여${s.remaining}석)`).join(", ")}${availableSlots.length > 5 ? " ..." : ""}`
      : `${vendor.name}은(는) 현재 예약 가능한 시간이 없습니다.`,
  };
}

async function executeRecommendVendors(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const admin = getAdminClient();
  const category = input.category as string;
  const limit = (input.limit as number) || 3;
  const dbCat = VENDOR_CATEGORY_MAP[category] || category;
  const mood = input.mood as string | undefined;
  const preferredDay = input.preferred_day as number | undefined;
  const preferredTime = input.preferred_time as string | undefined;
  const priceMax = input.price_max as number | undefined;
  const location = input.location as string | undefined;

  // 고객 예산 (해당 카테고리)
  const categoryProgress = ctx.weddingContext.progress[dbCat];
  const categoryBudget = (categoryProgress as Record<string, unknown>)?.budget as number | undefined;
  const totalBudget = ctx.weddingContext.budget;
  const ratio = CATEGORY_RATIOS[dbCat] ?? 0.05;
  const estimatedBudget = priceMax || categoryBudget || Math.round(totalBudget * ratio);

  // 이미 본 업체 제외 (고객 이벤트 데이터)
  let viewedVendorIds: string[] = [];
  if (ctx.coupleId) {
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .eq("couple_id", ctx.coupleId)
      .limit(1)
      .single();

    if (profile) {
      const { data: viewed } = await admin
        .from("customer_events")
        .select("vendor_id")
        .eq("user_id", profile.id)
        .eq("event_type", "vendor_view")
        .not("vendor_id", "is", null)
        .limit(50);
      viewedVendorIds = (viewed ?? []).map((v) => v.vendor_id).filter(Boolean);
    }
  }

  // 업체 검색 (예산 범위에 맞게, 더 많이 가져와서 필터링)
  let query = admin
    .from("vendors")
    .select("id, name, category, location, region, price_range, price_min, price_max, rating, review_count, tags, ai_recommend, description")
    .eq("status", "approved")
    .eq("category", dbCat)
    .order("rating", { ascending: false })
    .limit((limit + viewedVendorIds.length) * 2);

  if (estimatedBudget > 0) {
    query = query.lte("price_min", Math.round(estimatedBudget * 1.3));
  }

  // 지역 필터
  if (location) {
    query = query.or(`location.ilike.%${location}%,region.ilike.%${location}%`);
  }

  const { data: vendors, error } = await query;
  if (error) throw error;

  // 이미 본 업체 필터링
  let candidates = (vendors ?? []).filter((v) => !viewedVendorIds.includes(v.id));

  // 분위기/스타일 매칭 점수 계산
  if (mood) {
    const moodKeywords = mood.toLowerCase().split(/[,\s]+/).filter(Boolean);
    const scored = candidates.map((v) => {
      const vendorText = [
        ...(v.tags ?? []),
        v.description ?? "",
        v.name ?? "",
      ].join(" ").toLowerCase();

      let moodScore = 0;
      for (const kw of moodKeywords) {
        if (vendorText.includes(kw)) moodScore += 2;
      }
      if (v.tags) {
        for (const tag of v.tags as string[]) {
          for (const kw of moodKeywords) {
            if (tag.toLowerCase().includes(kw)) moodScore += 3;
          }
        }
      }
      return { ...v, _moodScore: moodScore };
    });
    scored.sort((a, b) => {
      if (b._moodScore !== a._moodScore) return b._moodScore - a._moodScore;
      return (b.rating ?? 0) - (a.rating ?? 0);
    });
    candidates = scored;
  }

  // 시간 가용성 필터 (선호 요일/시간이 있는 경우)
  let availableVendorIds: Set<string> | null = null;
  if (preferredDay !== undefined || preferredTime) {
    const timeHours: number[] = [];
    if (preferredTime === "morning") {
      for (let h = 9; h < 12; h++) timeHours.push(h);
    } else if (preferredTime === "afternoon") {
      for (let h = 12; h < 17; h++) timeHours.push(h);
    } else if (preferredTime === "evening") {
      for (let h = 17; h < 21; h++) timeHours.push(h);
    }

    const candidateIds = candidates.map((v) => v.id);
    if (candidateIds.length > 0) {
      let slotQuery = admin
        .from("vendor_timeslots")
        .select("vendor_id")
        .in("vendor_id", candidateIds)
        .eq("available", true);

      if (preferredDay !== undefined) {
        slotQuery = slotQuery.eq("day", preferredDay);
      }
      if (timeHours.length > 0) {
        slotQuery = slotQuery.in("hour", timeHours);
      }

      const { data: availableSlots } = await slotQuery;
      availableVendorIds = new Set((availableSlots ?? []).map((s) => s.vendor_id));
    }
  }

  // 최종 필터링: 시간 가용성 있는 업체 우선
  if (availableVendorIds) {
    const available = candidates.filter((v) => availableVendorIds!.has(v.id));
    if (available.length >= limit) {
      candidates = available;
    } else {
      const notAvailable = candidates.filter((v) => !availableVendorIds!.has(v.id));
      candidates = [...available, ...notAvailable];
    }
  }

  const selected = candidates.slice(0, limit);

  // 추천 이유 생성
  const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
  const results = selected.map((v) => {
    const reasons: string[] = [];
    if (v.ai_recommend) reasons.push("AI 추천 업체");
    if (mood) {
      const moodScore = (v as Record<string, unknown>)._moodScore as number ?? 0;
      if (moodScore > 0) reasons.push(`'${mood}' 분위기 매칭`);
    }
    if (availableVendorIds?.has(v.id)) {
      const timeLabel = preferredTime === "morning" ? "오전" : preferredTime === "afternoon" ? "오후" : preferredTime === "evening" ? "저녁" : "";
      const dayLabel = preferredDay !== undefined ? `${DAYS[preferredDay]}요일` : "";
      reasons.push(`${dayLabel} ${timeLabel} 예약 가능`.trim());
    }
    if (v.rating >= 4.5) reasons.push(`높은 평점 ${v.rating}점`);
    if (estimatedBudget > 0 && v.price_min <= estimatedBudget) reasons.push("예산 범위 내");
    if (location && ((v.location ?? "").includes(location) || (v.region ?? "").includes(location))) {
      reasons.push(`${location} 지역`);
    }
    if (v.review_count > 10) reasons.push(`리뷰 ${v.review_count}개`);
    if (reasons.length === 0) reasons.push("카테고리 인기 업체");

    return {
      id: v.id,
      name: v.name,
      location: v.location || v.region,
      priceRange: v.price_range,
      rating: v.rating,
      reviewCount: v.review_count,
      tags: v.tags,
      description: v.description?.slice(0, 100),
      reasons,
      link: `/vendors/${v.id}`,
    };
  });

  const filterDesc = [
    mood ? `분위기: ${mood}` : "",
    preferredDay !== undefined ? `요일: ${DAYS[preferredDay]}` : "",
    preferredTime ? `시간: ${preferredTime === "morning" ? "오전" : preferredTime === "afternoon" ? "오후" : "저녁"}` : "",
    location ? `지역: ${location}` : "",
  ].filter(Boolean).join(", ");

  return {
    toolName: "recommend_vendors",
    toolInput: input,
    toolOutput: {
      vendors: results,
      count: results.length,
      estimatedBudget,
      category,
      filters: filterDesc || undefined,
    },
    success: true,
    displayMessage: results.length > 0
      ? `${category} 추천 업체 ${results.length}개${filterDesc ? ` (${filterDesc})` : ""}:\n${results.map((v, i) => `${i + 1}. ${v.name} (${v.priceRange}, ${v.rating}점) - ${v.reasons.join(", ")}`).join("\n")}`
      : `${category} 카테고리에 조건에 맞는 업체가 없습니다.`,
  };
}

// ── 업체 상세 & 예약 도구 ──

async function executeGetVendorDetail(
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const admin = getAdminClient();
  const vendorId = input.vendor_id as string;

  // 업체 기본 정보
  const { data: vendor } = await admin
    .from("vendors")
    .select("id, name, category, location, price_range")
    .eq("id", vendorId)
    .single();

  if (!vendor) {
    return {
      toolName: "get_vendor_detail", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: "업체를 찾을 수 없습니다.",
    };
  }

  // 상품 조회
  const { data: products } = await admin
    .from("vendor_products")
    .select("id, name, description, price, discount_price, duration_minutes, is_popular, includes")
    .eq("vendor_id", vendorId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  // 스태프 조회
  const { data: staff } = await admin
    .from("vendor_staff")
    .select("id, name, role, description")
    .eq("vendor_id", vendorId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const productList = (products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description?.slice(0, 80) || "",
    price: p.price,
    discountPrice: p.discount_price || null,
    duration: p.duration_minutes || null,
    isPopular: p.is_popular || false,
    includes: p.includes || [],
  }));

  const staffList = (staff ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role || null,
    description: s.description?.slice(0, 60) || "",
  }));

  return {
    toolName: "get_vendor_detail",
    toolInput: input,
    toolOutput: {
      vendorId: vendor.id,
      vendorName: vendor.name,
      category: vendor.category,
      location: vendor.location,
      priceRange: vendor.price_range,
      products: productList,
      staff: staffList,
    },
    success: true,
    displayMessage: `${vendor.name}의 상품 ${productList.length}개, 스태프 ${staffList.length}명`,
  };
}

async function executeGetAvailableSlots(
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const admin = getAdminClient();
  const vendorId = input.vendor_id as string;
  const productId = input.product_id as string | undefined;
  // target_month / target_date: AI 가 사용자 발화에서 추출해 넘기는 필터.
  // ⚠️ defensive: AI 가 종종 과거 연도(예: 2025-08)를 보내는 경우 있음 — 모델이
  // 현재 연도를 정확히 모를 때. 아래 range 계산 단계에서 과거이면 다음 미래
  // 인스턴스 (가장 가까운 같은 달) 로 자동 재매핑.
  let targetMonth = (input.target_month as string | undefined)?.match(/^\d{4}-\d{2}$/)
    ? (input.target_month as string)
    : undefined;
  let targetDate = (input.target_date as string | undefined)?.match(/^\d{4}-\d{2}-\d{2}$/)
    ? (input.target_date as string)
    : undefined;
  const staffId = input.staff_id as string | undefined;

  // 업체 이름
  const { data: vendor } = await admin
    .from("vendors")
    .select("name")
    .eq("id", vendorId)
    .single();

  if (!vendor) {
    return {
      toolName: "get_available_slots", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: "업체를 찾을 수 없습니다.",
    };
  }

  // 타임슬롯 조회 (우선순위: staff > product > vendor).
  // "엔티티가 자체 일정 row 정의했을 때만" 폴백 (특정 시간 누락이 아닌 row 존재 여부).
  type SlotRow = { day: number; hour: number; available: boolean; max_bookings: number };
  const fetchSlots = async (table: string, fk: string, value: string) => {
    const { data } = await admin
      .from(table)
      .select("day, hour, available, max_bookings")
      .eq(fk, value)
      .eq("available", true);
    return (data ?? []) as SlotRow[];
  };
  // "엔티티가 자체 active 일정 row 를 정의했는가" — available=false row 만 있으면
  // 사실상 정의 안 한 것과 동일하게 취급해 vendor 로 폴백.
  const hasAnyRows = async (table: string, fk: string, value: string): Promise<boolean> => {
    const { count } = await admin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(fk, value)
      .eq("available", true);
    return (count ?? 0) > 0;
  };

  let slots: SlotRow[] = [];
  let slotSource: "staff" | "product" | "vendor" = "vendor";
  const staffOwnsSchedule = staffId ? await hasAnyRows("staff_timeslots", "staff_id", staffId) : false;
  const productOwnsSchedule = productId ? await hasAnyRows("product_timeslots", "product_id", productId) : false;
  if (staffOwnsSchedule && staffId) {
    slots = await fetchSlots("staff_timeslots", "staff_id", staffId);
    slotSource = "staff";
  } else if (productOwnsSchedule && productId) {
    slots = await fetchSlots("product_timeslots", "product_id", productId);
    slotSource = "product";
  } else {
    slots = await fetchSlots("vendor_timeslots", "vendor_id", vendorId);
    slotSource = "vendor";
  }

  // 조회 범위 동적 생성 — target_month/target_date 가 있으면 그 주변,
  // 없으면 향후 90일. 이전 버그: 90일 고정 윈도우라 "내년 8월" 같은 먼 미래
  // 쿼리에서 주간 반복 슬롯이 있어도 0개 반환.
  //
  // 정책:
  //  - target_date 있음 → 그 날 ±14일 (인접일 fallback 커버)
  //  - target_month 있음 → 전월 1일 ~ 다음 월 말일 (3개월 윈도우)
  //  - 둘 다 없음 → 오늘 ~ 오늘+90일 (기본)
  //  - rangeStart 가 오늘보다 과거면 오늘로 잘라냄 (과거 슬롯 무효)
  //
  // 모든 비교/포맷은 KST 기준 — 서버는 UTC라 자정 근처에서 ±1일 어긋남.
  const today = todayKstMidnight();
  const todayYmd = ymdInKst(today);
  const todayYear = Number(todayYmd.slice(0, 4));
  const todayMonthIdx = Number(todayYmd.slice(5, 7)) - 1;
  let rangeStart = today;
  let rangeEnd = addDaysUtc(today, 89);

  // AI 가 과거 연-월/일을 보내는 경우 미래의 같은 월/일로 자동 재매핑.
  // 사용자 의도는 "그 달/날짜" 인데 AI 가 연도를 잘못 추론할 수 있음.
  const remapToFuture = (year: number, monthIdx: number): number => {
    if (year > todayYear) return year;
    if (year === todayYear && monthIdx >= todayMonthIdx) return year;
    // 과거 → 올해 또는 내년의 같은 월
    return monthIdx >= todayMonthIdx ? todayYear : todayYear + 1;
  };

  if (targetDate) {
    // KST 자정으로 파싱 — Vercel UTC + "T00:00:00" 조합은 한국 사용자에게 어제로 보임
    let td = kstMidnightFromYmd(targetDate);
    if (!isNaN(td.getTime())) {
      // 과거 날짜면 같은 월·일의 미래 인스턴스로 재매핑
      if (td < today) {
        const tdYmd = ymdInKst(td);
        const tdYear = Number(tdYmd.slice(0, 4));
        const tdMonthIdx = Number(tdYmd.slice(5, 7)) - 1;
        const tdDay = Number(tdYmd.slice(8, 10));
        const effYear = remapToFuture(tdYear, tdMonthIdx);
        targetDate = `${effYear}-${String(tdMonthIdx + 1).padStart(2, "0")}-${String(tdDay).padStart(2, "0")}`;
        td = kstMidnightFromYmd(targetDate);
      }
      rangeStart = addDaysUtc(td, -14);
      rangeEnd = addDaysUtc(td, 14);
    }
  } else if (targetMonth) {
    const [reqY, m] = targetMonth.split("-").map(Number);
    if (Number.isFinite(reqY) && Number.isFinite(m) && m >= 1 && m <= 12) {
      const effYear = remapToFuture(reqY, m - 1);
      // 전월 1일 ~ 다음월 말일 — KST 기준 YMD 문자열로 만들고 KST 자정으로 변환
      const prevMonth = m - 1; // m-2+1
      const prevMonthYear = prevMonth < 1 ? effYear - 1 : effYear;
      const prevMonthM = prevMonth < 1 ? 12 : prevMonth;
      const nextMonth = m + 1;
      const nextMonthYear = nextMonth > 12 ? effYear + 1 : effYear;
      const nextMonthM = nextMonth > 12 ? 1 : nextMonth;
      // 다음월 1일 - 1일 = 다음월 말일. KST 기준으로 계산.
      const nextMonthFirstYmd = `${nextMonthYear}-${String(nextMonthM).padStart(2, "0")}-01`;
      rangeStart = kstMidnightFromYmd(`${prevMonthYear}-${String(prevMonthM).padStart(2, "0")}-01`);
      rangeEnd = addDaysUtc(kstMidnightFromYmd(nextMonthFirstYmd), -1);
      // 필터에 사용될 targetMonth 도 effective 연도로 동기화
      targetMonth = `${effYear}-${String(m).padStart(2, "0")}`;
    }
  }
  if (rangeStart < today) rangeStart = today;
  // 하드 캡 — 너무 먼 미래 쿼리 방어 (180일 이내)
  const HARD_CAP = addDaysUtc(today, 180);
  if (rangeEnd > HARD_CAP) rangeEnd = HARD_CAP;

  // KST 기준 YYYY-MM-DD 포맷. getDay 도 KST 요일이 나오도록 ymd 문자열로 다시 파싱
  // (단순 Date.getUTCDay 는 KST 자정 ≠ UTC 자정 차이 때문에 ±1일 어긋날 위험).
  const fmtYMD = (d: Date) => ymdInKst(d);
  const dayOfWeekKst = (ymd: string): number => {
    // ymd "YYYY-MM-DD" → ISO 요일 (0=월, 6=일)
    const parts = ymd.split("-").map(Number);
    const utc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    const day = new Date(utc).getUTCDay(); // 0=일, 6=토
    return (day + 6) % 7;
  };

  const dateStrings: string[] = [];
  const dayToDates = new Map<number, string[]>();
  for (let d = new Date(rangeStart); d <= rangeEnd; d = addDaysUtc(d, 1)) {
    const dateStr = fmtYMD(d);
    const day = dayOfWeekKst(dateStr); // 0=월 ~ 6=일
    dateStrings.push(dateStr);
    if (!dayToDates.has(day)) dayToDates.set(day, []);
    dayToDates.get(day)!.push(dateStr);
  }

  // 예약 수 카운트 쿼리
  let bookingQuery = admin
    .from("vendor_bookings")
    .select("booking_date, booking_time")
    .eq("vendor_id", vendorId)
    .in("booking_date", dateStrings)
    .neq("status", "cancelled");

  if (staffId) {
    bookingQuery = bookingQuery.eq("staff_id", staffId);
  } else if (productId) {
    bookingQuery = bookingQuery.eq("product_id", productId);
  }

  const { data: bookings } = await bookingQuery;

  const bookingCountMap = new Map<string, number>();
  for (const b of bookings ?? []) {
    const key = `${b.booking_date}:${b.booking_time}`;
    bookingCountMap.set(key, (bookingCountMap.get(key) ?? 0) + 1);
  }

  const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
  const availableSlots: {
    date: string;
    dayLabel: string;
    hour: number;
    time: string;
    remaining: number;
  }[] = [];

  for (const slot of slots) {
    const dates = dayToDates.get(slot.day) ?? [];
    for (const dateStr of dates) {
      const timeStr = `${String(slot.hour).padStart(2, "0")}:00`;
      const currentBookings = bookingCountMap.get(`${dateStr}:${timeStr}`) ?? 0;
      const remaining = slot.max_bookings - currentBookings;
      if (remaining > 0) {
        availableSlots.push({
          date: dateStr,
          dayLabel: DAYS[slot.day],
          hour: slot.hour,
          time: timeStr,
          remaining,
        });
      }
    }
  }

  // 날짜+시간 순으로 정렬
  availableSlots.sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);

  // 사용자 지정 기간(month/date)이 있으면 필터링.
  // 비어있을 때 인접 월(전월/다음월) 슬롯을 fallbackSlots 로 따로 전달해
  // AI 가 "8월은 없는데 7/9월은 있어요" 식으로 자연스럽게 안내하게 함.
  const monthOf = (s: string) => s.slice(0, 7); // YYYY-MM
  let primarySlots = availableSlots;
  let fallbackSlots: typeof availableSlots = [];
  let filterLabel = "";

  if (targetDate) {
    filterLabel = targetDate;
    primarySlots = availableSlots.filter((s) => s.date === targetDate);
    if (primarySlots.length === 0) {
      // 그 날 없으면 예약은 진행하지 않고, 같은 달의 "이후 날짜"를 먼저 제안한다.
      // 이전 날짜를 먼저 보여주면 사용자가 요청 날짜와 다른 날로 예약된 것처럼 느낄 수 있다.
      const sameMonthSlots = availableSlots.filter((s) => monthOf(s.date) === monthOf(targetDate));
      const afterSlots = sameMonthSlots.filter((s) => s.date > targetDate).slice(0, 8);
      const beforeSlots = sameMonthSlots
        .filter((s) => s.date < targetDate)
        .sort((a, b) => b.date.localeCompare(a.date) || a.hour - b.hour)
        .slice(0, Math.max(0, 8 - afterSlots.length));
      fallbackSlots = [...afterSlots, ...beforeSlots];
    }
  } else if (targetMonth) {
    filterLabel = `${targetMonth.slice(5, 7)}월`;
    primarySlots = availableSlots.filter((s) => monthOf(s.date) === targetMonth);
    if (primarySlots.length === 0) {
      // 인접 월 (전월·다음월) 슬롯 모음
      const [y, m] = targetMonth.split("-").map(Number);
      const prevMonth = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
      const nextMonth = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
      fallbackSlots = availableSlots.filter((s) => {
        const mo = monthOf(s.date);
        return mo === prevMonth || mo === nextMonth;
      });
    }
  }

  const firstDate = primarySlots[0]?.date;
  const lastDate = primarySlots[primarySlots.length - 1]?.date;
  const fallbackFirstDate = fallbackSlots[0]?.date;
  const fallbackLastDate = fallbackSlots[fallbackSlots.length - 1]?.date;

  // displayMessage 분기: 1) 필터된 슬롯 있음 / 2) 없는데 인접 슬롯은 있음 / 3) 다 없음
  let displayMessage: string;
  if (primarySlots.length > 0) {
    displayMessage = filterLabel
      ? `${vendor.name} ${filterLabel} 예약 가능 시간 ${primarySlots.length}개 (${firstDate} ~ ${lastDate})`
      : `${vendor.name} 예약 가능 시간 ${primarySlots.length}개 (${firstDate} ~ ${lastDate})`;
  } else if (fallbackSlots.length > 0) {
    displayMessage = targetDate
      ? `${vendor.name} ${filterLabel}에는 빈 시간이 없어요. 예약은 진행하지 않았고, 다른 날짜 후보 ${fallbackSlots.length}개를 참고용으로 보여드릴게요.`
      : `${vendor.name} ${filterLabel}에는 빈 시간이 없어요. 대신 ${fallbackFirstDate} ~ ${fallbackLastDate} 중 ${fallbackSlots.length}개 슬롯이 가능해요.`;
  } else {
    displayMessage = filterLabel
      ? `${vendor.name}은(는) ${filterLabel}에 예약 가능한 시간이 없습니다.`
      : `${vendor.name}은(는) 조회 범위 (${fmtYMD(rangeStart)} ~ ${fmtYMD(rangeEnd)}) 내에 예약 가능한 시간이 없습니다.`;
  }

  return {
    toolName: "get_available_slots",
    toolInput: input,
    toolOutput: {
      vendorId,
      vendorName: vendor.name,
      productId: productId || null,
      staffId: staffId || null,
      slots: primarySlots,
      count: primarySlots.length,
      requestedDate: targetDate ?? null,
      exactDateAvailable: targetDate ? primarySlots.length > 0 : null,
      // 필터 결과가 0이고 인접 월 슬롯이 있을 때만 fallback 노출 (UI 도 활용 가능)
      fallbackSlots: primarySlots.length === 0 ? fallbackSlots : [],
      filterLabel: filterLabel || null,
      // debug breadcrumbs (root cause 추적용 — 안정화되면 제거)
      _debug: {
        slotSource,
        slotsLoaded: slots.length,
        rangeStart: fmtYMD(rangeStart),
        rangeEnd: fmtYMD(rangeEnd),
        expanded: availableSlots.length,
        primary: primarySlots.length,
        fallback: fallbackSlots.length,
        targetMonthResolved: targetMonth ?? null,
        targetDateResolved: targetDate ?? null,
      },
    },
    success: true,
    displayMessage,
  };
}

async function executeCreateBooking(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const admin = getAdminClient();
  const vendorId = input.vendor_id as string;
  const productId = (input.product_id as string) || null;
  const staffId = (input.staff_id as string) || null;
  const date = input.date as string;
  const time = input.time as string;
  const memo = (input.memo as string) || "";

  if (!vendorId || !isValidYmd(date) || !isValidHourTime(time)) {
    return {
      toolName: "create_booking", toolInput: input,
      toolOutput: { error: "invalid_booking_input" },
      success: false,
      displayMessage: "예약을 만들려면 업체, 정확한 날짜(YYYY-MM-DD), 정각 시간(HH:00)이 필요합니다.",
    };
  }

  const todayYmd = ymdInKst();
  if (date < todayYmd) {
    return {
      toolName: "create_booking", toolInput: input,
      toolOutput: { error: "past_booking_date", attemptedDate: date, today: todayYmd },
      success: false,
      displayMessage: `예약 날짜 ${date}는 오늘(${todayYmd})보다 이전이라 예약을 진행하지 않았습니다. 미래 날짜로 다시 확인해 주세요.`,
    };
  }

  const requestedDate = extractRequestedBookingDate(ctx.currentUserText, todayYmd);
  if (requestedDate && requestedDate !== date) {
    return {
      toolName: "create_booking", toolInput: input,
      toolOutput: {
        error: "requested_date_mismatch",
        requestedDate,
        attemptedDate: date,
      },
      success: false,
      displayMessage:
        `사용자가 요청한 날짜는 ${requestedDate}인데 예약 시도 날짜가 ${date}라서 예약을 진행하지 않았습니다. ` +
        "정확한 요청 날짜의 가능 시간만 다시 확인해 주세요.",
    };
  }

  // 업체 이름·카테고리 (카테고리는 예산 자동 차감 매핑용)
  const { data: vendor } = await admin
    .from("vendors")
    .select("name, category")
    .eq("id", vendorId)
    .single();

  if (!vendor) {
    return {
      toolName: "create_booking", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: "업체를 찾을 수 없습니다.",
    };
  }

  // 커플 프로필 정보 (이름, 연락처)
  const { data: profiles } = await admin
    .from("profiles")
    .select("name, role, phone")
    .eq("couple_id", ctx.coupleId);

  const brideProfile = profiles?.find((p) => p.role === "bride");
  const groomProfile = profiles?.find((p) => p.role === "groom");
  const brideName = brideProfile?.name || "";
  const groomName = groomProfile?.name || "";
  const contactPhone = brideProfile?.phone || groomProfile?.phone || "";

  // 상품 가격 조회
  let amount = 0;
  let productName = "";
  if (productId) {
    const { data: product } = await admin
      .from("vendor_products")
      .select("name, price, discount_price")
      .eq("id", productId)
      .single();
    if (product) {
      productName = product.name;
      amount = product.discount_price || product.price || 0;
    }
  }

  // 스태프 이름 조회
  let staffName = "";
  if (staffId) {
    const { data: staff } = await admin
      .from("vendor_staff")
      .select("name, role")
      .eq("id", staffId)
      .single();
    if (staff) {
      staffName = staff.role ? `${staff.name} ${staff.role}` : staff.name;
    }
  }

  // Atomic booking via Postgres RPC — TOCTOU 방어.
  // 이전엔 SELECT max_bookings → COUNT existing → INSERT 를 3단계 client 호출로
  // 수행해 동시 호출 시 둘 다 capacity 통과 → 둘 다 INSERT → 초과 발생.
  // RPC 안에서 SELECT ... FOR UPDATE 로 timeslot row 락 + COUNT + INSERT 를
  // 단일 트랜잭션 처리 → 동시 호출 직렬화. slot fallback 로직 (staff > product
  // > vendor, "엔티티가 자체 일정 row 정의했을 때만" 폴백) 도 RPC 내부에 포함.
  // (migration: supabase/migrations/20260517000000_atomic_booking_rpc.sql)
  const { data: bookingIdResult, error: rpcError } = await admin.rpc("create_booking_atomic", {
    p_vendor_id: vendorId,
    p_couple_id: ctx.coupleId,
    p_booking_date: date,
    p_booking_time: time,
    p_product_id: productId ?? null,
    p_staff_id: staffId ?? null,
    p_booking_type: "consultation",
    p_bride_name: brideName,
    p_groom_name: groomName,
    p_contact_phone: contactPhone,
    p_amount: amount,
    p_memo: memo,
  });

  if (rpcError) {
    const msg = rpcError.message || "";
    if (msg.includes("slot_unavailable")) {
      return {
        toolName: "create_booking", toolInput: input,
        toolOutput: {}, success: false,
        displayMessage: "해당 시간은 예약이 불가능합니다.",
      };
    }
    if (msg.includes("slot_full")) {
      return {
        toolName: "create_booking", toolInput: input,
        toolOutput: {}, success: false,
        displayMessage: "해당 시간의 예약이 마감되었습니다. 다른 시간을 선택해 주세요.",
      };
    }
    throw rpcError;
  }

  // RPC 는 UUID 반환. 하위 auto-sync 코드는 booking.id 형태로 참조하므로 객체로 래핑.
  const booking = { id: bookingIdResult as unknown as string };

  // 예약 성공 후 자동 동기화:
  //  1) 일정(__events)에 투어/상담 이벤트 자동 추가 → /schedule 캘린더에 즉시 노출
  //  2) 해당 카테고리(progress[category].spent)에 예약 금액 누적 → /budget 진행률 즉시 갱신
  // 둘 다 wedding_journeys.progress JSON 한 번의 UPDATE 로 일괄 처리.
  // 실패해도 예약 자체는 이미 성공이므로 silent.
  let scheduleAdded = false;
  let budgetUpdated = false;
  // 예산 초과 — 카테고리 budget 설정돼 있고 누적 spent 가 초과할 때만.
  // 차단이 아닌 알림. 사용자가 결정한 예약은 그대로 진행, displayMessage 에 자연 문구.
  let budgetExceededBy = 0;
  let categoryBudgetLimit = 0;
  let categoryLabelForOver = "";
  // client-side authStore.journey.progress merge 용 — chatStore 가 받아 즉시 갱신.
  // (이 없으면 /schedule, /budget 페이지가 새로고침 전까지 stale 상태)
  let syncedEvent: ScheduleEvent | null = null;
  let syncedCategoryKey: string | null = null;
  let syncedNewSpent: number | null = null;
  try {
    const categoryKey = (vendor.category as string | null) ?? null;

    // 최신 progress 조회 (ctx.weddingContext.progress 가 stale 일 수 있어 fresh fetch)
    const { data: journeyRow } = await admin
      .from("wedding_journeys")
      .select("progress")
      .eq("couple_id", ctx.coupleId)
      .single();
    const progress: Record<string, unknown> = (journeyRow?.progress as Record<string, unknown>) ?? {};

    // 1) 일정 이벤트 — 시간은 title 맨 앞에 배치해 캘린더 뷰에서 바로 보이게.
    //    (ScheduleEvent 타입에 별도 time 필드 없음. memo 에 묻히면 사용자가 못 봄)
    const events = (progress.__events as ScheduleEvent[] | undefined) ?? [];
    const nowIso = new Date().toISOString();
    const vendorLabel = `${vendor.name}${productName ? ` ${productName}` : ""}`;
    const eventTitle = `${time} ${vendorLabel} 투어/상담${staffName ? ` (${staffName})` : ""}`;
    const newEvent: ScheduleEvent = {
      id: `evt_booking_${booking.id.slice(0, 8)}`,
      date,
      title: eventTitle,
      memo: `예약 자동 등록 · booking ${booking.id.slice(0, 8)}${amount > 0 ? ` · ${(amount / 10000).toLocaleString()}만원` : ""}`,
      categoryKey: categoryKey ?? undefined,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const nextProgress: Record<string, unknown> = {
      ...progress,
      __events: [...events, newEvent],
    };

    // 2) 예산 카테고리 spent 누적 (categoryKey 있고 amount > 0 일 때만)
    let computedNewSpent: number | null = null;
    if (categoryKey && amount > 0) {
      const cat = (progress[categoryKey] as Record<string, unknown> | undefined) ?? {};
      const prevSpent = (cat.spent as number | undefined) ?? 0;
      const catBudget = (cat.budget as number | undefined) ?? 0;
      const newSpent = prevSpent + amount;
      computedNewSpent = newSpent;
      nextProgress[categoryKey] = {
        ...cat,
        spent: newSpent,
      };
      budgetUpdated = true;
      // 카테고리 예산이 설정돼 있고 누적 spent 가 한도 넘으면 알림 데이터 저장.
      // (catBudget=0 이면 사용자가 카테고리 예산 미설정 — 비교 불가, skip)
      if (catBudget > 0 && newSpent > catBudget) {
        budgetExceededBy = newSpent - catBudget;
        categoryBudgetLimit = catBudget;
        categoryLabelForOver = (cat.label as string | undefined) || categoryKey;
      }
    }

    const { error: progressErr } = await admin
      .from("wedding_journeys")
      .update({ progress: nextProgress })
      .eq("couple_id", ctx.coupleId);

    if (!progressErr) {
      scheduleAdded = true;
      ctx.weddingContext.progress = nextProgress as unknown as ExecutionContext["weddingContext"]["progress"];
      // server-side commit 성공 시에만 client merge 데이터 채움
      syncedEvent = newEvent;
      syncedCategoryKey = categoryKey;
      syncedNewSpent = computedNewSpent;
    }
  } catch (syncErr) {
    // sync 실패해도 예약 자체는 성공 상태 유지 — 사용자에게 동기화 실패만 자연스럽게 알림
    console.error("[create_booking] auto-sync (schedule+budget) failed (non-fatal):", syncErr);
  }

  // 자동 동기화 결과를 응답 메시지에 반영
  const syncNote = scheduleAdded
    ? budgetUpdated
      ? " (일정·예산에 자동 반영했어요)"
      : " (일정에 자동 등록했어요)"
    : "";

  // 카테고리 예산 초과 알림 — 차단이 아닌 정보 제공. 사용자가 결정하도록.
  const overNote = budgetExceededBy > 0
    ? `\n\n⚠️ 다만 ${categoryLabelForOver} 카테고리 예산 ${formatWon(categoryBudgetLimit)} 중에 ${formatWon(budgetExceededBy)} 초과예요. 다른 카테고리 줄이거나 총 예산 조정 검토해보시겠어요?`
    : "";

  return {
    toolName: "create_booking",
    toolInput: input,
    toolOutput: {
      bookingId: booking.id,
      vendorName: vendor.name,
      productName,
      staffName,
      date,
      time,
      amount,
      status: "pending",
      scheduleAdded,
      budgetUpdated,
      budgetExceededBy,
      categoryBudgetLimit,
      categoryLabel: categoryLabelForOver || null,
      // client (chatStore) 가 authStore.journey.progress 즉시 merge 용. server commit
      // 성공한 경우에만 채워짐. /schedule, /budget 페이지의 stale 문제 회피.
      syncedEvent,
      syncedCategoryKey,
      syncedNewSpent,
    },
    success: true,
    displayMessage: `${vendor.name} 예약이 접수되었습니다! (${date} ${time}${productName ? ` / ${productName}` : ""}${staffName ? ` / ${staffName}` : ""})${syncNote}${overNote}`,
  };
}

// ===== 내 예약 목록 조회 =====
async function executeGetMyBookings(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const admin = getAdminClient();
  const statusFilter = (input.status as string) || null;

  let query = admin
    .from("vendor_bookings")
    .select("id, vendor_id, product_id, staff_id, booking_date, booking_time, status, amount, memo, created_at")
    .eq("couple_id", ctx.coupleId)
    .order("booking_date", { ascending: true });

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  } else {
    query = query.neq("status", "cancelled");
  }

  const { data: bookings, error } = await query.limit(20);

  if (error) throw error;

  if (!bookings || bookings.length === 0) {
    return {
      toolName: "get_my_bookings", toolInput: input,
      toolOutput: { bookings: [] }, success: true,
      displayMessage: statusFilter ? `${statusFilter} 상태의 예약이 없습니다.` : "현재 예약이 없습니다.",
    };
  }

  // 업체/상품 이름 매핑
  const vendorIds = [...new Set(bookings.map(b => b.vendor_id))];
  const productIds = [...new Set(bookings.filter(b => b.product_id).map(b => b.product_id!))];

  const { data: vendors } = await admin.from("vendors").select("id, name").in("id", vendorIds);
  const vendorMap = new Map((vendors ?? []).map(v => [v.id, v.name]));

  let productMap = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: products } = await admin.from("vendor_products").select("id, name").in("id", productIds);
    productMap = new Map((products ?? []).map(p => [p.id, p.name]));
  }

  const enriched = bookings.map(b => ({
    bookingId: b.id,
    vendorName: vendorMap.get(b.vendor_id) ?? "알 수 없음",
    productName: b.product_id ? (productMap.get(b.product_id) ?? "") : "",
    date: b.booking_date,
    time: b.booking_time,
    status: b.status,
    amount: b.amount ?? 0,
  }));

  return {
    toolName: "get_my_bookings", toolInput: input,
    toolOutput: { bookings: enriched },
    success: true,
    displayMessage: `${enriched.length}건의 예약이 있습니다.`,
  };
}

// ===== 예약 취소 =====
async function executeCancelBooking(
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ToolExecutionResult> {
  const admin = getAdminClient();
  const bookingId = input.booking_id as string;

  // booking_id 형식 방어 — AI 가 placeholder/추측 id 보내는 경우 silent skip.
  // (현실 발생 케이스: 사용자 "응 취소해줘" 같은 vague 발화에 AI 가 cancel_booking
  // 을 두 번 호출 — 한 번은 진짜 id, 한 번은 hallucinated id. 두 번째 fail 카드가
  // 사용자에게 노이즈로 노출되는 문제. UUID 형식 아니면 hidden=true 로 표시해
  // BookingCancelCard 가 렌더 자체를 skip.)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!bookingId || typeof bookingId !== "string" || !UUID_RE.test(bookingId)) {
    return {
      toolName: "cancel_booking", toolInput: input,
      toolOutput: { hidden: true, reason: "invalid_booking_id" },
      success: true,
      displayMessage: "",
    };
  }

  // 예약 조회 (본인 커플의 예약인지 확인). create_booking 의 sync 역연산에 필요한
  // amount 도 같이 가져옴 (spent 차감 계산).
  const { data: booking, error: fetchError } = await admin
    .from("vendor_bookings")
    .select("id, vendor_id, product_id, booking_date, booking_time, status, amount")
    .eq("id", bookingId)
    .eq("couple_id", ctx.coupleId)
    .single();

  if (fetchError || !booking) {
    // 같은 turn 중복 호출 또는 hallucinated id 케이스 — UI 노이즈 회피로 hidden.
    return {
      toolName: "cancel_booking", toolInput: input,
      toolOutput: { hidden: true, reason: "not_found_or_unauthorized" },
      success: true,
      displayMessage: "",
    };
  }

  if (booking.status === "cancelled") {
    return {
      toolName: "cancel_booking", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: "이미 취소된 예약입니다.",
    };
  }

  // 취소 불가 상태 체크
  const nonCancellable = ["in_service", "service_completed", "settled", "completed"];
  if (nonCancellable.includes(booking.status)) {
    return {
      toolName: "cancel_booking", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: "진행 중이거나 완료된 예약은 취소할 수 없습니다. 업체에 직접 문의해주세요.",
    };
  }

  // 예약 취소
  const { error: updateError } = await admin
    .from("vendor_bookings")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", bookingId);

  if (updateError) throw updateError;

  // 업체 (name + category) / 상품 이름 조회 — category 는 spent 차감 매핑용
  const { data: vendor } = await admin
    .from("vendors")
    .select("name, category")
    .eq("id", booking.vendor_id)
    .single();
  const vendorName = vendor?.name ?? "업체";
  const categoryKey = (vendor?.category as string | null) ?? null;
  let productName = "";
  if (booking.product_id) {
    const { data: product } = await admin.from("vendor_products").select("name").eq("id", booking.product_id).single();
    productName = product?.name ?? "";
  }

  // create_booking 자동 동기화 역연산:
  //  1) __events 에서 `evt_booking_{id 앞 8자}` 제거
  //  2) progress[category].spent 에서 amount 차감 (음수 방지 — Math.max(0, ...))
  // 둘 다 단일 progress UPDATE 로. 실패해도 취소 자체는 이미 성공 상태 유지.
  const eventIdToRemove = `evt_booking_${bookingId.slice(0, 8)}`;
  const cancelAmount = (booking.amount as number | undefined) ?? 0;
  let scheduleRemoved = false;
  let budgetReverted = false;
  let syncedNewSpent: number | null = null;
  try {
    const { data: journeyRow } = await admin
      .from("wedding_journeys")
      .select("progress")
      .eq("couple_id", ctx.coupleId)
      .single();
    const progress: Record<string, unknown> = (journeyRow?.progress as Record<string, unknown>) ?? {};
    const nextProgress: Record<string, unknown> = { ...progress };

    // 1) events 제거
    const events = (progress.__events as ScheduleEvent[] | undefined) ?? [];
    const filtered = events.filter((e) => e.id !== eventIdToRemove);
    if (filtered.length !== events.length) {
      nextProgress.__events = filtered;
      scheduleRemoved = true;
    }

    // 2) spent 차감 (categoryKey 있고 amount > 0 일 때만)
    if (categoryKey && cancelAmount > 0) {
      const cat = (progress[categoryKey] as Record<string, unknown> | undefined) ?? {};
      const prevSpent = (cat.spent as number | undefined) ?? 0;
      const newSpent = Math.max(0, prevSpent - cancelAmount);
      syncedNewSpent = newSpent;
      nextProgress[categoryKey] = {
        ...cat,
        spent: newSpent,
      };
      budgetReverted = true;
    }

    // 변경 사항 있을 때만 UPDATE (불필요 round-trip 회피)
    if (scheduleRemoved || budgetReverted) {
      const { error: progressErr } = await admin
        .from("wedding_journeys")
        .update({ progress: nextProgress })
        .eq("couple_id", ctx.coupleId);
      if (progressErr) {
        scheduleRemoved = false;
        budgetReverted = false;
        syncedNewSpent = null;
      } else {
        ctx.weddingContext.progress = nextProgress as unknown as ExecutionContext["weddingContext"]["progress"];
      }
    }
  } catch (syncErr) {
    console.error("[cancel_booking] auto-revert (schedule+budget) failed (non-fatal):", syncErr);
  }

  const revertNote = scheduleRemoved
    ? budgetReverted
      ? " (일정·예산에서도 자동 정리했어요)"
      : " (일정에서도 자동 정리했어요)"
    : "";

  return {
    toolName: "cancel_booking",
    toolInput: input,
    toolOutput: {
      bookingId,
      vendorName,
      productName,
      date: booking.booking_date,
      time: booking.booking_time,
      status: "cancelled",
      // client (chatStore) 가 authStore.journey.progress 즉시 merge 용.
      scheduleRemoved,
      budgetReverted,
      syncedEventIdRemoved: scheduleRemoved ? eventIdToRemove : null,
      syncedCategoryKey: budgetReverted ? categoryKey : null,
      syncedNewSpent,
    },
    success: true,
    displayMessage: `${vendorName} 예약이 취소되었습니다. (${booking.booking_date} ${booking.booking_time}${productName ? ` / ${productName}` : ""})${revertNote}`,
  };
}

// ===== 시세 정보 조회 =====
function executeGetMarketPrice(input: Record<string, unknown>): ToolExecutionResult {
  const category = input.category as string;
  const scope = (input.scope as "national" | "seoul") ?? "national";
  const pid = getLatestPeriodId();
  const period = PRICE_PERIODS.find(p => p.id === pid)!;
  const scopeLabel = scope === "seoul" ? "서울" : "전국";

  let displayMessage = "";
  let toolOutput: Record<string, unknown> = {};

  switch (category) {
    case "total": {
      const nat = getNationalTotal(pid);
      const seoul = getSeoulTotal(pid);
      displayMessage = `[${period.label} 기준 총 비용]\n전국 평균: ${nat.total}만원 (식대 ${nat.meal} + 스드메 ${nat.sdm} + 대관료 ${nat.rental} + 꽃장식 ${nat.decoration})\n서울 평균: ${seoul.total}만원 (식대 ${seoul.meal} + 스드메 ${seoul.sdm} + 대관료 ${seoul.rental} + 꽃장식 ${seoul.decoration})`;
      toolOutput = { national: nat, seoul };
      break;
    }
    case "venue": {
      const nec = VENUE_NECESSARY.find(v => v.periodId === pid && v.scope === scope);
      const opt = getVenueOptionalItems(pid, scope);
      if (nec) {
        displayMessage = `[${scopeLabel} 예식장 시세 - ${period.label}]\n대관료: ${nec.rental}만원\n1인당 식대: ${nec.perPersonMeal}만원\n최소보증인원: ${nec.minGuests}명\n식대총액: ${nec.totalFood}만원\n\n주요 선택항목:\n- 생화꽃장식: ${opt.items["생화꽃장식"]}만원\n- 축가: ${opt.items["축가/축하공연"]}만원\n- 사회자: ${opt.items["본식 사회자"]}만원\n- 웨딩케이크: ${opt.items["웨딩케이크"]}만원\n- 폐백음식: ${opt.items["폐백 음식"]}만원\n- 부케: ${opt.items["부케"]}만원`;
        toolOutput = { necessary: nec, optional: opt.items };
      }
      break;
    }
    case "sdm": {
      const pkgs = SDM_PACKAGES.filter(s => s.periodId === pid);
      displayMessage = `[스드메 패키지 시세 - ${period.label}]\n` +
        pkgs.map(p => `${p.region}: 패키지 ${p.packageMedian}만원 / 드메 ${p.dmPackageMedian}만원 / 스튜디오 ${p.studioBasic}만원`).join("\n");
      toolOutput = { packages: pkgs };
      break;
    }
    case "studio": {
      const studioOpts = OPTION_PRICES.filter(o => o.category === "studio");
      const priceKey = scope === "seoul" ? "seoulPrice" : "nationalPrice";
      displayMessage = `[${scopeLabel} 스튜디오 옵션 시세]\n` +
        studioOpts.filter(o => o[priceKey] > 0).map(o => `- ${o.name}: ${o[priceKey]}만원`).join("\n");
      toolOutput = { options: studioOpts };
      break;
    }
    case "dress": {
      const d = DRESS_PRICES.find(p => p.periodId === pid && p.scope === scope);
      const dressOpts = OPTION_PRICES.filter(o => o.category === "dress");
      const priceKey = scope === "seoul" ? "seoulPrice" : "nationalPrice";
      if (d) {
        displayMessage = `[${scopeLabel} 드레스 시세 - ${period.label}]\n촬영용: ${d.photoShoot}만원\n본식용: ${d.ceremony}만원\n2부 드레스: ${d.secondDress}만원\n\n주요 옵션:\n` +
          dressOpts.filter(o => o[priceKey] > 0).map(o => `- ${o.name}: ${o[priceKey]}만원`).join("\n");
        toolOutput = { prices: d, options: dressOpts };
      }
      break;
    }
    case "makeup": {
      const m = MAKEUP_PRICES.find(p => p.periodId === pid && p.scope === scope);
      const makeupOpts = OPTION_PRICES.filter(o => o.category === "makeup");
      const priceKey = scope === "seoul" ? "seoulPrice" : "nationalPrice";
      if (m) {
        displayMessage = `[${scopeLabel} 메이크업 시세 - ${period.label}]\n촬영: ${m.photoShoot}만원\n본식: ${m.ceremony}만원\n리허설: ${m.rehearsal}만원\n\n주요 옵션:\n` +
          makeupOpts.filter(o => o[priceKey] > 0).map(o => `- ${o.name}: ${o[priceKey]}만원`).join("\n");
        toolOutput = { prices: m, options: makeupOpts };
      }
      break;
    }
    case "options": {
      const allOpts = OPTION_PRICES;
      const priceKey = scope === "seoul" ? "seoulPrice" : "nationalPrice";
      displayMessage = `[${scopeLabel} 옵션별 시세 - 최신 기준]\n\n스튜디오 (${allOpts.filter(o => o.category === "studio").length}개):\n` +
        allOpts.filter(o => o.category === "studio" && o[priceKey] > 0).map(o => `- ${o.name}: ${o[priceKey]}만원`).join("\n") +
        `\n\n드레스 (${allOpts.filter(o => o.category === "dress").length}개):\n` +
        allOpts.filter(o => o.category === "dress" && o[priceKey] > 0).map(o => `- ${o.name}: ${o[priceKey]}만원`).join("\n") +
        `\n\n메이크업 (${allOpts.filter(o => o.category === "makeup").length}개):\n` +
        allOpts.filter(o => o.category === "makeup" && o[priceKey] > 0).map(o => `- ${o.name}: ${o[priceKey]}만원`).join("\n");
      toolOutput = { options: allOpts };
      break;
    }
    case "seasonal": {
      const latest = SEASONAL_DATA[SEASONAL_DATA.length - 1];
      displayMessage = `[성수기 vs 비수기 - ${period.label}]\n성수기 (4~6월, 9~11월): ${latest.peak}만원\n비수기 (1~3월, 7~8월, 12월): ${latest.offPeak}만원\n비수기 절약: 약 ${latest.savings}만원`;
      toolOutput = { seasonal: latest };
      break;
    }
    default:
      displayMessage = "지원하지 않는 카테고리입니다.";
  }

  return {
    toolName: "get_market_price",
    toolInput: input,
    toolOutput,
    success: true,
    displayMessage: displayMessage || "시세 정보를 조회했습니다.",
  };
}

// ========== 네이버 지역 검색 API 장소 검색 ==========

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// "음식점>한식>한정식" → { main: "한식", sub: "한정식", full: "음식점>한식>한정식" }
function parseCategory(raw: string): { main: string; sub: string | null; full: string } {
  const parts = raw.split(">").map((s) => s.trim());
  if (parts.length >= 3) return { main: parts[1], sub: parts[2], full: raw };
  if (parts.length === 2) return { main: parts[1], sub: null, full: raw };
  return { main: parts[0], sub: null, full: raw };
}

// 블로그 텍스트에서 인당 가격대 추출
function extractPriceRange(texts: string[]): string | null {
  const combined = texts.join(" ");
  // "인당 3만원", "1인 5만원", "인당 30,000원" 등
  const perPersonPatterns = [
    /인당\s*(\d[\d,]*)\s*원/,
    /1인\s*(\d[\d,]*)\s*원/,
    /인당\s*(\d+)\s*만\s*원?/,
    /1인\s*(\d+)\s*만\s*원?/,
    /인당\s*약?\s*(\d+)\s*만/,
  ];
  for (const pattern of perPersonPatterns) {
    const match = combined.match(pattern);
    if (match) {
      const raw = match[1].replace(/,/g, "");
      const num = parseInt(raw, 10);
      if (num >= 10000) return `인당 약 ${(num / 10000).toFixed(0)}만원`;
      if (num > 0 && num <= 100) return `인당 약 ${num}만원`;
      if (num > 100) return `인당 약 ${num.toLocaleString()}원`;
    }
  }
  // "가격대 3~5만원", "3만원~5만원대"
  const rangeMatch = combined.match(/(\d+)\s*[~\-]\s*(\d+)\s*만\s*원/);
  if (rangeMatch) {
    return `인당 ${rangeMatch[1]}~${rangeMatch[2]}만원`;
  }
  // "코스 5만원", "코스요리 7만원"
  const courseMatch = combined.match(/코스[요리]?\s*(\d+)\s*만\s*원?/);
  if (courseMatch) {
    return `코스 ${courseMatch[1]}만원`;
  }
  return null;
}

// 블로그 텍스트에서 룸/개인실 여부 확인
function detectPrivateRoom(texts: string[]): boolean {
  const combined = texts.join(" ").toLowerCase();
  const roomKeywords = ["룸", "개별룸", "프라이빗", "private", "개인실", "독립공간", "단체석", "별실", "개인공간", "단독룸"];
  return roomKeywords.some((kw) => combined.includes(kw));
}

// fetch with timeout (기본 4초)
function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 4000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function executeSearchNearbyPlaces(
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const query = input.query as string;
  const clientId = process.env.NAVER_CLIENT_ID ?? process.env.NEXT_PUBLIC_NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      toolName: "search_nearby_places",
      toolInput: input,
      toolOutput: {},
      success: false,
      displayMessage: "네이버 API 키가 설정되지 않았습니다.",
    };
  }

  const naverHeaders = {
    "X-Naver-Client-Id": clientId,
    "X-Naver-Client-Secret": clientSecret,
  };

  try {
    // 1단계: 네이버 지역 검색 (리뷰 많은 순, 5초 타임아웃)
    const localResponse = await fetchWithTimeout(
      `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=5&sort=comment`,
      { headers: naverHeaders },
      5000
    );

    if (!localResponse.ok) {
      const errText = await localResponse.text();
      throw new Error(`Naver API error: ${localResponse.status} ${errText}`);
    }

    const localData = await localResponse.json();
    const items = localData.items || [];

    if (items.length === 0) {
      return {
        toolName: "search_nearby_places",
        toolInput: input,
        toolOutput: { places: [], query },
        success: true,
        displayMessage: `'${query}' 검색 결과가 없습니다. 다른 검색어를 시도해보세요.`,
      };
    }

    // 2단계: 기본 장소 데이터 먼저 구성 (블로그 없이도 동작)
    const basePlaces = items.map(
      (item: {
        title: string;
        link: string;
        category: string;
        description: string;
        telephone: string;
        address: string;
        roadAddress: string;
        mapx: string;
        mapy: string;
      }, idx: number) => {
        const name = stripHtmlTags(item.title);
        const roadAddr = item.roadAddress || item.address;
        const category = parseCategory(item.category);
        const description = stripHtmlTags(item.description || "");
        const cuisineType = category.main;
        // 네이버 지도: 이름만 사용 (이름+주소 전체 넣으면 검색 실패율 높음)
        const mapsUrl = `https://map.naver.com/v5/search/${encodeURIComponent(name)}`;
        const blogSearchUrl = `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(name + " " + (category.sub || category.main) + " 후기")}`;

        return {
          id: `naver-${idx}`,
          name,
          address: roadAddr,
          category: category.sub || category.main,
          categoryFull: category.full,
          cuisineType,
          description: description || null,
          telephone: item.telephone || null,
          priceRange: null as string | null,
          hasPrivateRoom: false,
          mapsUrl,
          blogSearchUrl,
          blogReviewCount: 0,
          blogSnippet: null as string | null,
          link: item.link || null,
        };
      }
    );

    // 3단계: 블로그 검색으로 보강 (병렬, 개별 타임아웃 3초, 실패해도 무시).
    // 가게 이름을 큰따옴표로 묶어 네이버 블로그 검색에 정확 매칭 — 이전엔
    // unquoted 쿼리라 "강남 식당" 같은 일반 매칭이 잡혀 blog.total 이 수십만
    // 단위로 부풀려졌음. 사용자에게 잘못된 후기 수로 보임.
    const blogResults = await Promise.allSettled(
      basePlaces.map(async (place: { name: string; address: string }) => {
        const blogResponse = await fetchWithTimeout(
          `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(`"${place.name}" 후기`)}&display=3&sort=sim`,
          { headers: naverHeaders },
          3000
        );
        if (!blogResponse.ok) return null;
        return await blogResponse.json();
      })
    );

    // 4단계: 블로그 데이터 병합
    const places = basePlaces.map((place: typeof basePlaces[number], idx: number) => {
      const blogResult = blogResults[idx];
      if (blogResult.status === "fulfilled" && blogResult.value) {
        const blogData = blogResult.value;
        place.blogReviewCount = blogData.total || 0;
        const blogItems = blogData.items || [];
        const allSnippets: string[] = blogItems.map(
          (b: { description: string }) => stripHtmlTags(b.description || "")
        );
        if (allSnippets.length > 0) {
          place.blogSnippet = allSnippets[0].slice(0, 100);
        }
        place.priceRange = extractPriceRange(allSnippets);
        place.hasPrivateRoom = detectPrivateRoom(allSnippets);
      }
      return place;
    });

    return {
      toolName: "search_nearby_places",
      toolInput: input,
      toolOutput: { places, query },
      success: true,
      displayMessage: `'${query}' 검색 결과 ${places.length}곳을 찾았습니다.`,
    };
  } catch (err) {
    const errMsg = String(err);
    console.error("search_nearby_places 에러:", errMsg);
    return {
      toolName: "search_nearby_places",
      toolInput: input,
      toolOutput: { error: errMsg },
      success: false,
      displayMessage: "장소 검색 중 오류가 발생했습니다. 다시 시도해주세요.",
    };
  }
}

// ===== 견적 분석 (AI 견적 체크) =====

const AMORA_QUOTE_CATEGORY_SET = new Set<AmoraQuoteCategory>(["sdm_package", "studio", "dress", "makeup"]);
const AMORA_QUOTE_REGION_SET = new Set<AmoraQuoteRegion>(["seoul", "gyeonggi", "busan", "daegu", "other"]);

function normalizeQuoteToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function parseQuoteCategory(value: unknown): AmoraQuoteCategory {
  return AMORA_QUOTE_CATEGORY_SET.has(value as AmoraQuoteCategory)
    ? value as AmoraQuoteCategory
    : "sdm_package";
}

function parseQuoteRegion(value: unknown): AmoraQuoteRegion {
  return AMORA_QUOTE_REGION_SET.has(value as AmoraQuoteRegion)
    ? value as AmoraQuoteRegion
    : "seoul";
}

function resolveIncludedQuoteItemIds(
  category: AmoraQuoteCategory,
  region: AmoraQuoteRegion,
  includedItems: string[]
): string[] {
  const checklistItems = getQuoteCheckItems(category, region);
  const normalizedInputs = includedItems
    .map((item) => normalizeQuoteToken(item))
    .filter(Boolean);

  const ids = new Set<string>();
  for (const item of checklistItems) {
    const candidates = [item.id, item.name, item.checkQuestion].map(normalizeQuoteToken);
    if (normalizedInputs.some((input) =>
      candidates.some((candidate) => input === candidate || input.includes(candidate) || candidate.includes(input))
    )) {
      ids.add(item.id);
    }
  }

  return [...ids];
}

function executeAnalyzeQuoteWithTrustEngine(input: Record<string, unknown>): ToolExecutionResult {
  const quotePrice = Number(input.quote_price ?? 0);
  const category = parseQuoteCategory(input.category);
  const region = parseQuoteRegion(input.region);
  const vendorName = typeof input.vendor_name === "string" ? input.vendor_name : "";
  const includedItems = Array.isArray(input.included_items)
    ? input.included_items.map((item) => String(item)).filter(Boolean)
    : [];

  if (!Number.isFinite(quotePrice) || quotePrice <= 0) {
    return {
      toolName: "analyze_quote",
      toolInput: input,
      toolOutput: { error: "quote_price must be a positive number." },
      success: false,
      displayMessage: "견적 금액을 만원 단위 숫자로 다시 알려주세요.",
    };
  }

  const checklistItems = getQuoteCheckItems(category, region);
  if (includedItems.length === 0) {
    return {
      toolName: "analyze_quote",
      toolInput: input,
      toolOutput: {
        mode: "checklist",
        quotePrice,
        category,
        region,
        vendorName,
        checklistItems: checklistItems.map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          severity: item.severity,
          price: item.priceManwon,
          usageRate: item.usageRatePercent,
          checkQuestion: item.checkQuestion,
        })),
      },
      success: true,
      displayMessage: "견적 포함 항목을 먼저 확인해주세요.",
    };
  }

  const includedItemIds = resolveIncludedQuoteItemIds(category, region, includedItems);
  const analysis = analyzeAmoraQuoteCheck({
    category,
    region,
    quotePriceManwon: quotePrice,
    includedItemIds,
    vendorName,
  });

  const output = {
    quotePrice: analysis.quotePriceManwon,
    category: analysis.category,
    region: analysis.scope,
    vendorName,
    marketMedian: analysis.marketMedianManwon,
    priceDiff: analysis.quotePriceManwon - analysis.marketMedianManwon,
    priceDiffPercent: analysis.priceDiffPercent,
    dataSource: analysis.sourceNote,
    transparencyScore: analysis.score,
    grade: analysis.grade,
    verdict: analysis.verdict,
    estimatedHiddenMin: analysis.estimatedHiddenMinManwon,
    estimatedHiddenMax: analysis.estimatedHiddenMaxManwon,
    estimatedTotalMin: analysis.estimatedTotalMinManwon,
    estimatedTotalMax: analysis.estimatedTotalMaxManwon,
    missingItems: analysis.missingItems.map((item) => ({
      name: item.name,
      category: item.category,
      severity: item.severity,
      price: item.priceManwon,
      usageRate: item.usageRatePercent,
      reason: item.reason,
      checkQuestion: item.checkQuestion,
      disguise: item.disguise,
    })),
    includedItems: analysis.includedItems.map((item) => ({
      name: item.name,
      category: item.category,
      severity: item.severity,
    })),
    missingCriticalCount: analysis.missingCriticalCount,
    missingHighCount: analysis.missingHighCount,
    missingMediumCount: analysis.missingMediumCount,
    redFlags: analysis.redFlags,
    summaryTitle: analysis.summaryTitle,
    summaryText: analysis.summaryText,
    recommendedAction: analysis.recommendedAction,
    contractQuestions: analysis.contractQuestions,
    negotiationScript: analysis.negotiationScript,
    statsNote: analysis.sourceNote,
  };

  return {
    toolName: "analyze_quote",
    toolInput: input,
    toolOutput: output,
    success: true,
    displayMessage: `견적 분석 완료: 투명도 ${analysis.grade}등급(${analysis.score}점), 예상 실제 비용 ${analysis.estimatedTotalMinManwon}~${analysis.estimatedTotalMaxManwon}만원`,
  };
}

function executeAnalyzeQuote(input: Record<string, unknown>): ToolExecutionResult {
  const quotePrice = (input.quote_price as number) || 0;
  const category = (input.category as string) || "sdm_package";
  const region = (input.region as string) || "seoul";
  const includedItems = (input.included_items as string[]) || [];
  const vendorName = (input.vendor_name as string) || "";
  const scope = region === "seoul" || region === "gyeonggi" ? "seoul" : "national";
  const pid = getLatestPeriodId();

  // 1. 카테고리에 해당하는 숨겨진 비용 항목만 필터
  // - 개별 카테고리(dress/studio/makeup) → 해당 카테고리만
  // - 전체 패키지(sdm_package) → 스드메 + 공통(본식 스냅, 부케 등)
  const relevantCategories = category === "sdm_package"
    ? ["studio", "dress", "makeup", "common"]
    : [category];

  const allRelevantCosts = HIDDEN_COSTS.filter((item) =>
    relevantCategories.includes(item.category)
  );

  // ★ 체크리스트 모드: 포함 항목 미입력 시 → 먼저 확인할 항목 목록 반환
  if (includedItems.length === 0) {
    const checklistItems = allRelevantCosts.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      severity: item.severity,
      price: scope === "seoul" ? item.seoulPrice : item.nationalPrice,
      usageRate: Math.round(item.usageRate * 100),
      checkQuestion: item.checkQuestion,
    }));

    return {
      toolName: "analyze_quote",
      toolInput: input,
      toolOutput: {
        mode: "checklist",
        quotePrice,
        category,
        region: scope,
        vendorName,
        checklistItems,
      },
      success: true,
      displayMessage: "견적 포함 항목을 확인해주세요.",
    };
  }

  // 2. 포함 항목과 매칭하여 빠진 항목 식별
  const includedLower = includedItems.map((s) => s.toLowerCase());
  const missingItems: (HiddenCostItem & { isIncluded: boolean })[] = allRelevantCosts.map((item) => {
    // 포함 여부 판단: 항목 이름 또는 관련 키워드가 포함 목록에 있는지
    const keywords = getItemKeywords(item);
    const isIncluded = keywords.some((kw) =>
      includedLower.some((inc) => inc.includes(kw))
    );
    return { ...item, isIncluded };
  });

  const missing = missingItems.filter((i) => !i.isIncluded);
  const included = missingItems.filter((i) => i.isIncluded);

  const missingCritical = missing.filter((i) => i.severity === "critical");
  const missingHigh = missing.filter((i) => i.severity === "high");
  const missingMedium = missing.filter((i) => i.severity === "medium");

  // 3. 예상 추가금 계산
  const estimatedHidden = estimateHiddenCosts(missing, scope);
  const estimatedHiddenMax = missing.reduce((t, i) =>
    t + (scope === "seoul" ? i.seoulPrice : i.nationalPrice), 0
  );
  const estimatedTotalMin = quotePrice + Math.round(estimatedHidden);
  const estimatedTotalMax = quotePrice + Math.round(estimatedHiddenMax);

  // 4. 시세 비교
  let marketMedian = 0;
  if (category === "sdm_package") {
    const sdm = SDM_PACKAGES.find((s) => s.periodId === pid && s.region === (scope === "seoul" ? "서울" : "전체"));
    marketMedian = sdm?.packageMedian ?? 290;
  } else if (category === "studio") {
    const sdm = SDM_PACKAGES.find((s) => s.periodId === pid && s.region === (scope === "seoul" ? "서울" : "전체"));
    marketMedian = sdm?.studioBasic ?? 135;
  } else if (category === "dress") {
    const d = DRESS_PRICES.find((d) => d.periodId === pid && d.scope === scope);
    marketMedian = d?.ceremony ?? 145;
  } else if (category === "makeup") {
    const m = MAKEUP_PRICES.find((m) => m.periodId === pid && m.scope === scope);
    marketMedian = m?.photoShoot ?? 77;
  }

  const priceDiff = quotePrice - marketMedian;
  const priceDiffPercent = marketMedian > 0 ? Math.round((priceDiff / marketMedian) * 100) : 0;

  // 5. 투명도 점수
  let score = 100;
  score -= missingCritical.length * 15;
  score -= missingHigh.length * 8;
  score -= missingMedium.length * 3;
  if (includedItems.length < 5) score -= 15; // 가격 불투명
  if (priceDiffPercent < -30) score -= 10; // 미끼 가격 의심

  // 포함 항목에 대한 가산
  score += included.filter((i) => i.severity === "critical").length * 10;
  score += included.filter((i) => i.severity === "high").length * 5;

  score = Math.max(0, Math.min(100, score));
  const grade = getGradeFromScore(score);

  // 6. 레드플래그
  const detectedFlags: RedFlag[] = [];
  if (priceDiffPercent < -30) {
    detectedFlags.push(RED_FLAGS.find((f) => f.id === "bait_pricing")!);
  }
  if (missingCritical.length > 0) {
    detectedFlags.push(RED_FLAGS.find((f) => f.id === "essential_as_option")!);
  }
  if (includedItems.length < 5) {
    detectedFlags.push(RED_FLAGS.find((f) => f.id === "price_opacity")!);
  }
  const cashKeywords = includedLower.some((s) => s.includes("현금") || s.includes("카드 별도"));
  if (cashKeywords) {
    detectedFlags.push(RED_FLAGS.find((f) => f.id === "cash_pressure")!);
  }
  // 원본 관련 체크
  const hasOriginal = includedLower.some((s) => s.includes("원본") || s.includes("원판"));
  const hasRetouch = includedLower.some((s) => s.includes("보정"));
  if (hasRetouch && !hasOriginal) {
    detectedFlags.push(RED_FLAGS.find((f) => f.id === "retouch_trap")!);
  }

  // 7. 빠진 항목 상세 (카드에서 사용)
  const missingDetails = missing.map((item) => ({
    name: item.name,
    category: item.category,
    severity: item.severity,
    price: scope === "seoul" ? item.seoulPrice : item.nationalPrice,
    usageRate: Math.round(item.usageRate * 100),
    reason: item.reason,
    checkQuestion: item.checkQuestion,
    disguise: item.disguise,
  }));

  const includedDetails = included.map((item) => ({
    name: item.name,
    category: item.category,
    severity: item.severity,
  }));

  const period = PRICE_PERIODS.find((p) => p.id === pid);

  const output = {
    quotePrice,
    category,
    region: scope,
    vendorName,
    // 시세 비교
    marketMedian,
    priceDiff,
    priceDiffPercent,
    dataSource: `한국소비자원 ${period?.label ?? ""} 기준`,
    // 투명도 점수
    transparencyScore: score,
    grade,
    // 예상 비용
    estimatedHiddenMin: Math.round(estimatedHidden),
    estimatedHiddenMax: Math.round(estimatedHiddenMax),
    estimatedTotalMin,
    estimatedTotalMax,
    // 항목 상세
    missingItems: missingDetails,
    includedItems: includedDetails,
    missingCriticalCount: missingCritical.length,
    missingHighCount: missingHigh.length,
    missingMediumCount: missingMedium.length,
    // 레드플래그
    redFlags: detectedFlags.filter(Boolean).map((f) => ({ id: f.id, name: f.name, description: f.description })),
    // 실태조사 수치
    statsNote: "기재부 실태조사: 기본 계약금 평균 346만원 → 실제 지불 520만원 (추가금 174만원, +50%)",
  };

  return {
    toolName: "analyze_quote",
    toolInput: input,
    toolOutput: output,
    success: true,
    displayMessage: `견적 분석 완료: 투명도 ${grade}등급(${score}점), 예상 실제 비용 ${estimatedTotalMin}~${estimatedTotalMax}만원`,
  };
}

// 숨겨진 비용 항목의 매칭 키워드 생성
function getItemKeywords(item: HiddenCostItem): string[] {
  const base = item.name.toLowerCase();
  const keywords = [base];

  // 항목별 추가 키워드
  switch (item.id) {
    case "studio_original_data": keywords.push("원본", "원판", "전체 데이터", "raw"); break;
    case "studio_album_extra": keywords.push("앨범", "album"); break;
    case "studio_retouch_extra": keywords.push("보정", "수정본", "리터치"); break;
    case "studio_frame_change": keywords.push("액자", "frame"); break;
    case "studio_early_start": keywords.push("얼리", "early", "오전"); break;
    case "studio_designate": keywords.push("작가 지정", "담당자", "지정"); break;
    case "studio_outdoor": keywords.push("야외", "outdoor", "로케이션"); break;
    case "dress_helper_shoot": keywords.push("헬퍼", "helper", "촬영 도우미"); break;
    case "dress_helper_ceremony": keywords.push("헬퍼", "본식 도우미", "본식 헬퍼"); break;
    case "dress_fitting_extra": keywords.push("피팅", "fitting"); break;
    case "dress_alteration": keywords.push("수선", "가봉", "재가봉"); break;
    case "dress_second": keywords.push("2부", "세컨", "second"); break;
    case "dress_tuxedo": keywords.push("턱시도", "신랑 의상", "tuxedo"); break;
    case "makeup_rehearsal": keywords.push("리허설", "rehearsal", "사전 테스트"); break;
    case "makeup_parents": keywords.push("혼주", "어머니", "부모님"); break;
    case "makeup_groom": keywords.push("신랑", "groom"); break;
    case "common_ceremony_snap": keywords.push("본식 촬영", "스냅", "snap", "본식 스냅"); break;
    case "common_ceremony_original": keywords.push("본식 원본", "본식 원판"); break;
  }
  return keywords;
}
