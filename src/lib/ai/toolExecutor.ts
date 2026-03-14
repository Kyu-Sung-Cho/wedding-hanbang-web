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

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function formatWon(amount: number): string {
  if (amount >= 100000000) {
    return `${(amount / 100000000).toFixed(1)}억원`;
  }
  return `${Math.round(amount / 10000).toLocaleString()}만원`;
}

interface ExecutionContext {
  coupleId: string;
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
      case "get_market_price":
        return executeGetMarketPrice(toolInput);
      case "search_nearby_places":
        return await executeSearchNearbyPlaces(toolInput);
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

  const admin = getAdminClient();
  const { error } = await admin
    .from("wedding_journeys")
    .update({ wedding_date: newDate })
    .eq("couple_id", ctx.coupleId);

  if (error) throw error;

  ctx.weddingContext.weddingDate = newDate;

  const dDay = Math.ceil(
    (new Date(newDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
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
  const newEvent: ScheduleEvent = {
    id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    date, title, memo, categoryKey, createdAt: now, updatedAt: now,
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
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = (input.from_date as string) || today;

  let toDate = input.to_date as string;
  if (!toDate) {
    const d = new Date(fromDate);
    d.setDate(d.getDate() + 30);
    toDate = d.toISOString().slice(0, 10);
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

  // 타임슬롯 조회
  const slotTable = productId ? "product_timeslots" : "vendor_timeslots";
  const slotFk = productId ? "product_id" : "vendor_id";
  const slotFkValue = productId || vendorId;

  let slotQuery = admin
    .from(slotTable)
    .select("day, hour, available, max_bookings")
    .eq(slotFk, slotFkValue)
    .eq("available", true);

  if (targetDay !== undefined) {
    slotQuery = slotQuery.eq("day", targetDay);
  }

  const { data: slots } = await slotQuery;

  // 향후 7일 예약 수 확인
  const today = new Date();
  const dateStrings: string[] = [];
  const dayToDate = new Map<number, string>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dateStr = d.toISOString().split("T")[0];
    const day = (d.getDay() + 6) % 7;
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
  const availableSlots = (slots ?? []).map((s) => {
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

  // 타임슬롯 조회 (우선순위: staff > product > vendor)
  let slotTable: string;
  let slotFk: string;
  let slotFkValue: string;

  if (staffId) {
    slotTable = "staff_timeslots";
    slotFk = "staff_id";
    slotFkValue = staffId;
  } else if (productId) {
    slotTable = "product_timeslots";
    slotFk = "product_id";
    slotFkValue = productId;
  } else {
    slotTable = "vendor_timeslots";
    slotFk = "vendor_id";
    slotFkValue = vendorId;
  }

  const { data: slots } = await admin
    .from(slotTable)
    .select("day, hour, available, max_bookings")
    .eq(slotFk, slotFkValue)
    .eq("available", true);

  // 향후 14일 예약 수 확인
  const today = new Date();
  const dateStrings: string[] = [];
  const dayToDates = new Map<number, string[]>();

  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dateStr = d.toISOString().split("T")[0];
    const day = (d.getDay() + 6) % 7; // 0=월 ~ 6=일
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

  for (const slot of slots ?? []) {
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

  const firstDate = availableSlots[0]?.date;
  const lastDate = availableSlots[availableSlots.length - 1]?.date;

  return {
    toolName: "get_available_slots",
    toolInput: input,
    toolOutput: {
      vendorId,
      vendorName: vendor.name,
      productId: productId || null,
      staffId: staffId || null,
      slots: availableSlots,
      count: availableSlots.length,
    },
    success: true,
    displayMessage: availableSlots.length > 0
      ? `${vendor.name} 예약 가능 시간 ${availableSlots.length}개 (${firstDate} ~ ${lastDate})`
      : `${vendor.name}은(는) 향후 14일간 예약 가능한 시간이 없습니다.`,
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

  // 업체 이름
  const { data: vendor } = await admin
    .from("vendors")
    .select("name")
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

  // 타임슬롯 용량 확인
  const slotTable = productId ? "product_timeslots" : "vendor_timeslots";
  const slotFk = productId ? "product_id" : "vendor_id";
  const slotFkValue = productId || vendorId;
  const bookingDay = (new Date(date).getDay() + 6) % 7;
  const bookingHour = parseInt(time.split(":")[0], 10);

  const { data: slotData } = await admin
    .from(slotTable)
    .select("max_bookings")
    .eq(slotFk, slotFkValue)
    .eq("day", bookingDay)
    .eq("hour", bookingHour)
    .eq("available", true)
    .limit(1)
    .single();

  if (!slotData) {
    return {
      toolName: "create_booking", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: "해당 시간은 예약이 불가능합니다.",
    };
  }

  // 기존 예약 수 확인
  const { count: existingCount } = await admin
    .from("vendor_bookings")
    .select("*", { count: "exact", head: true })
    .eq("vendor_id", vendorId)
    .eq("booking_date", date)
    .eq("booking_time", time)
    .neq("status", "cancelled");

  if ((existingCount ?? 0) >= slotData.max_bookings) {
    return {
      toolName: "create_booking", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: "해당 시간의 예약이 마감되었습니다. 다른 시간을 선택해 주세요.",
    };
  }

  // 예약 생성
  const { data: booking, error } = await admin
    .from("vendor_bookings")
    .insert({
      vendor_id: vendorId,
      couple_id: ctx.coupleId,
      product_id: productId,
      staff_id: staffId,
      booking_date: date,
      booking_time: time,
      booking_type: "consultation",
      bride_name: brideName,
      groom_name: groomName,
      contact_phone: contactPhone,
      status: "pending",
      amount,
      is_paid: false,
      memo,
    })
    .select("id")
    .single();

  if (error) throw error;

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
    },
    success: true,
    displayMessage: `${vendor.name} 예약이 접수되었습니다! (${date} ${time}${productName ? ` / ${productName}` : ""}${staffName ? ` / ${staffName}` : ""})`,
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
  return html.replace(/<[^>]*>/g, "");
}

async function executeSearchNearbyPlaces(
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const query = input.query as string;
  const clientId = process.env.NAVER_CLIENT_ID;
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

  try {
    const response = await fetch(
      `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=5&sort=comment`,
      {
        headers: {
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
        },
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Naver API error: ${response.status} ${errText}`);
    }

    const data = await response.json();
    const items = data.items || [];

    const places = items.map(
      (item: {
        title: string;
        link: string;
        category: string;
        telephone: string;
        address: string;
        roadAddress: string;
        mapx: string;
        mapy: string;
      }, idx: number) => {
        const name = stripHtmlTags(item.title);
        const roadAddr = item.roadAddress || item.address;
        // 네이버 지도 검색 링크
        const mapsUrl = `https://map.naver.com/v5/search/${encodeURIComponent(name + " " + roadAddr)}`;

        return {
          id: `naver-${idx}`,
          name,
          address: roadAddr,
          category: item.category,
          telephone: item.telephone || null,
          mapsUrl,
          link: item.link || null,
        };
      }
    );

    return {
      toolName: "search_nearby_places",
      toolInput: input,
      toolOutput: { places },
      success: true,
      displayMessage: `'${query}' 검색 결과 ${places.length}곳을 찾았습니다.`,
    };
  } catch (err) {
    return {
      toolName: "search_nearby_places",
      toolInput: input,
      toolOutput: { error: String(err) },
      success: false,
      displayMessage: "장소 검색 중 오류가 발생했습니다.",
    };
  }
}
