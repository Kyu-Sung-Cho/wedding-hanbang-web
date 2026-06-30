import { createAdminClient } from "@/lib/supabase/admin";
import {
  syncBookingProgressAfterCancel,
  syncBookingProgressAfterCreate,
} from "@/lib/bookings/progressSync";
import type { ToolExecutionResult, ScheduleEvent } from "@/types/database.types";
import {
  addDaysUtc,
  kstMidnightFromYmd,
  todayKstMidnight,
  ymdInKst,
} from "@/lib/utils/kstDate";
import {
  formatWon,
  requireDestructiveConfirmation,
  type ToolExecutionContext,
} from "@/lib/ai/tools/toolTypes";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HH_00_RE = /^\d{2}:00$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getAdminClient() {
  return createAdminClient();
}

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

const WEEKDAY_INDEX: Record<string, number> = {
  월: 0,
  화: 1,
  수: 2,
  목: 3,
  금: 4,
  토: 5,
  일: 6,
};

function dayOfWeekFromYmd(ymd: string): number {
  const [year, month, day] = ymd.split("-").map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

function resolveWeekdayToFuture(
  weekday: number,
  todayYmd: string,
  modifier?: string
): string {
  const today = kstMidnightFromYmd(todayYmd);
  const todayDay = dayOfWeekFromYmd(todayYmd);
  const compact = modifier?.replace(/\s+/g, "") ?? "";
  let offset = weekday - todayDay;

  if (compact === "다다음주") {
    offset += 14;
  } else if (compact === "다음주") {
    offset += 7;
  } else if (compact === "이번주" || compact === "이번" || compact === "돌아오는" || compact === "") {
    if (offset < 0) offset += 7;
  } else if (compact === "다음") {
    if (offset <= 0) offset += 7;
  }

  return ymdInKst(addDaysUtc(today, offset));
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

  const relativeDays: Array<[RegExp, number]> = [
    [/오늘/g, 0],
    [/내일/g, 1],
    [/모레/g, 2],
    [/글피/g, 3],
  ];
  for (const [regex, offset] of relativeDays) {
    for (const match of text.matchAll(regex)) {
      addCandidate(match.index, ymdInKst(addDaysUtc(kstMidnightFromYmd(todayYmd), offset)));
    }
  }

  for (const match of text.matchAll(/(다다음\s*주|다음\s*주|이번\s*주|돌아오는|다음|이번)?\s*([월화수목금토일])요일/g)) {
    const weekday = WEEKDAY_INDEX[match[2]];
    if (weekday === undefined) continue;
    addCandidate(match.index, resolveWeekdayToFuture(weekday, todayYmd, match[1]));
  }

  candidates.sort((a, b) => a.index - b.index);
  return candidates.at(-1)?.ymd ?? null;
}

function extractRequestedBookingTime(text: string | undefined): string | null {
  if (!text) return null;

  const candidates: Array<{ index: number; time: string }> = [];
  const addCandidate = (index: number | undefined, hour: number) => {
    if (index === undefined || !Number.isInteger(hour) || hour < 0 || hour > 23) return;
    candidates.push({ index, time: `${String(hour).padStart(2, "0")}:00` });
  };

  for (const match of text.matchAll(/\[time:(\d{2}:00)\]/gi)) {
    const hour = Number(match[1].slice(0, 2));
    addCandidate(match.index, hour);
  }

  for (const match of text.matchAll(/\b([01]?\d|2[0-3]):00\b/g)) {
    addCandidate(match.index, Number(match[1]));
  }

  for (const match of text.matchAll(/(오전|오후)\s*(\d{1,2})\s*시(?:\s*0\s*분)?/g)) {
    let hour = Number(match[2]);
    if (hour < 1 || hour > 12) continue;
    if (match[1] === "오후" && hour < 12) hour += 12;
    if (match[1] === "오전" && hour === 12) hour = 0;
    addCandidate(match.index, hour);
  }

  for (const match of text.matchAll(/\b(1\d|2[0-3])\s*시(?:\s*0\s*분)?/g)) {
    addCandidate(match.index, Number(match[1]));
  }

  candidates.sort((a, b) => a.index - b.index);
  return candidates.at(-1)?.time ?? null;
}

export async function executeGetAvailableSlots(
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const admin = getAdminClient();
  const vendorId = input.vendor_id as string;
  const productId = input.product_id as string | undefined;
  let targetMonth = (input.target_month as string | undefined)?.match(/^\d{4}-\d{2}$/)
    ? (input.target_month as string)
    : undefined;
  let targetDate = (input.target_date as string | undefined)?.match(/^\d{4}-\d{2}-\d{2}$/)
    ? (input.target_date as string)
    : undefined;
  const staffId = input.staff_id as string | undefined;

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

  if (productId) {
    const { data: product } = await admin
      .from("vendor_products")
      .select("id")
      .eq("id", productId)
      .eq("vendor_id", vendorId)
      .maybeSingle();
    if (!product) {
      return {
        toolName: "get_available_slots", toolInput: input,
        toolOutput: { error: "invalid_product_vendor", vendorId, productId },
        success: false,
        displayMessage: "선택한 상품이 이 업체의 상품이 아니라 예약 시간을 확인하지 않았습니다.",
      };
    }
  }

  if (staffId) {
    const { data: staff } = await admin
      .from("vendor_staff")
      .select("id")
      .eq("id", staffId)
      .eq("vendor_id", vendorId)
      .maybeSingle();
    if (!staff) {
      return {
        toolName: "get_available_slots", toolInput: input,
        toolOutput: { error: "invalid_staff_vendor", vendorId, staffId },
        success: false,
        displayMessage: "선택한 담당자가 이 업체 소속이 아니라 예약 시간을 확인하지 않았습니다.",
      };
    }
  }

  type SlotRow = { day: number; hour: number; available: boolean; max_bookings: number };
  const fetchSlots = async (table: string, fk: string, value: string) => {
    const { data } = await admin
      .from(table)
      .select("day, hour, available, max_bookings")
      .eq(fk, value)
      .eq("available", true);
    return (data ?? []) as SlotRow[];
  };
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

  const today = todayKstMidnight();
  const todayYmd = ymdInKst(today);
  const todayYear = Number(todayYmd.slice(0, 4));
  const todayMonthIdx = Number(todayYmd.slice(5, 7)) - 1;
  let rangeStart = today;
  let rangeEnd = addDaysUtc(today, 89);

  const remapToFuture = (year: number, monthIdx: number): number => {
    if (year > todayYear) return year;
    if (year === todayYear && monthIdx >= todayMonthIdx) return year;
    return monthIdx >= todayMonthIdx ? todayYear : todayYear + 1;
  };

  if (targetDate) {
    let td = kstMidnightFromYmd(targetDate);
    if (!isNaN(td.getTime())) {
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
      const prevMonth = m - 1;
      const prevMonthYear = prevMonth < 1 ? effYear - 1 : effYear;
      const prevMonthM = prevMonth < 1 ? 12 : prevMonth;
      const nextMonth = m + 1;
      const nextMonthYear = nextMonth > 12 ? effYear + 1 : effYear;
      const nextMonthM = nextMonth > 12 ? 1 : nextMonth;
      const nextMonthFirstYmd = `${nextMonthYear}-${String(nextMonthM).padStart(2, "0")}-01`;
      rangeStart = kstMidnightFromYmd(`${prevMonthYear}-${String(prevMonthM).padStart(2, "0")}-01`);
      rangeEnd = addDaysUtc(kstMidnightFromYmd(nextMonthFirstYmd), -1);
      targetMonth = `${effYear}-${String(m).padStart(2, "0")}`;
    }
  }
  if (rangeStart < today) rangeStart = today;
  const hardCap = addDaysUtc(today, 180);
  if (rangeEnd > hardCap) rangeEnd = hardCap;

  const fmtYMD = (d: Date) => ymdInKst(d);
  const dayOfWeekKst = (ymd: string): number => {
    const parts = ymd.split("-").map(Number);
    const utc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    const day = new Date(utc).getUTCDay();
    return (day + 6) % 7;
  };

  const dateStrings: string[] = [];
  const dayToDates = new Map<number, string[]>();
  for (let d = new Date(rangeStart); d <= rangeEnd; d = addDaysUtc(d, 1)) {
    const dateStr = fmtYMD(d);
    const day = dayOfWeekKst(dateStr);
    dateStrings.push(dateStr);
    if (!dayToDates.has(day)) dayToDates.set(day, []);
    dayToDates.get(day)!.push(dateStr);
  }

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
  for (const booking of bookings ?? []) {
    const key = `${booking.booking_date}:${booking.booking_time}`;
    bookingCountMap.set(key, (bookingCountMap.get(key) ?? 0) + 1);
  }

  const days = ["월", "화", "수", "목", "금", "토", "일"];
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
          dayLabel: days[slot.day],
          hour: slot.hour,
          time: timeStr,
          remaining,
        });
      }
    }
  }

  availableSlots.sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);

  const monthOf = (value: string) => value.slice(0, 7);
  let primarySlots = availableSlots;
  let fallbackSlots: typeof availableSlots = [];
  let filterLabel = "";

  if (targetDate) {
    filterLabel = targetDate;
    primarySlots = availableSlots.filter((slot) => slot.date === targetDate);
    if (primarySlots.length === 0) {
      const sameMonthSlots = availableSlots.filter((slot) => monthOf(slot.date) === monthOf(targetDate));
      const afterSlots = sameMonthSlots.filter((slot) => slot.date > targetDate).slice(0, 8);
      const beforeSlots = sameMonthSlots
        .filter((slot) => slot.date < targetDate)
        .sort((a, b) => b.date.localeCompare(a.date) || a.hour - b.hour)
        .slice(0, Math.max(0, 8 - afterSlots.length));
      fallbackSlots = [...afterSlots, ...beforeSlots];
    }
  } else if (targetMonth) {
    filterLabel = `${targetMonth.slice(5, 7)}월`;
    primarySlots = availableSlots.filter((slot) => monthOf(slot.date) === targetMonth);
    if (primarySlots.length === 0) {
      const [y, m] = targetMonth.split("-").map(Number);
      const prevMonth = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
      const nextMonth = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
      fallbackSlots = availableSlots.filter((slot) => {
        const mo = monthOf(slot.date);
        return mo === prevMonth || mo === nextMonth;
      });
    }
  }

  const firstDate = primarySlots[0]?.date;
  const lastDate = primarySlots[primarySlots.length - 1]?.date;
  const fallbackFirstDate = fallbackSlots[0]?.date;
  const fallbackLastDate = fallbackSlots[fallbackSlots.length - 1]?.date;

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
      fallbackSlots: primarySlots.length === 0 ? fallbackSlots : [],
      filterLabel: filterLabel || null,
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

export async function executeCreateBooking(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
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

  const requestedTime = extractRequestedBookingTime(ctx.currentUserText);
  if (requestedTime && requestedTime !== time) {
    return {
      toolName: "create_booking", toolInput: input,
      toolOutput: {
        error: "requested_time_mismatch",
        requestedTime,
        attemptedTime: time,
      },
      success: false,
      displayMessage:
        `사용자가 요청한 시간은 ${requestedTime}인데 예약 시도 시간이 ${time}라서 예약을 진행하지 않았습니다. ` +
        "정확한 요청 시간의 가능 여부만 다시 확인해 주세요.",
    };
  }

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

  const { data: profiles } = await admin
    .from("profiles")
    .select("name, role, phone")
    .eq("couple_id", ctx.coupleId);

  const brideProfile = profiles?.find((profile) => profile.role === "bride");
  const groomProfile = profiles?.find((profile) => profile.role === "groom");
  const brideName = brideProfile?.name || "";
  const groomName = groomProfile?.name || "";
  const contactPhone = brideProfile?.phone || groomProfile?.phone || "";

  let amount = 0;
  let productName = "";
  if (productId) {
    const { data: product } = await admin
      .from("vendor_products")
      .select("name, price, discount_price, is_active")
      .eq("id", productId)
      .eq("vendor_id", vendorId)
      .maybeSingle();
    if (!product) {
      return {
        toolName: "create_booking", toolInput: input,
        toolOutput: { error: "invalid_product_vendor", vendorId, productId },
        success: false,
        displayMessage: "선택한 상품이 이 업체의 상품이 아니라 예약을 진행하지 않았습니다. 업체 상품을 다시 확인해 주세요.",
      };
    }
    if (product.is_active === false) {
      return {
        toolName: "create_booking", toolInput: input,
        toolOutput: { error: "inactive_product", vendorId, productId },
        success: false,
        displayMessage: "선택한 상품은 현재 예약 가능한 상품이 아니라 예약을 진행하지 않았습니다.",
      };
    }
    productName = product.name;
    amount = product.discount_price || product.price || 0;
  }

  let staffName = "";
  if (staffId) {
    const { data: staff } = await admin
      .from("vendor_staff")
      .select("name, role")
      .eq("id", staffId)
      .eq("vendor_id", vendorId)
      .maybeSingle();
    if (!staff) {
      return {
        toolName: "create_booking", toolInput: input,
        toolOutput: { error: "invalid_staff_vendor", vendorId, staffId },
        success: false,
        displayMessage: "선택한 담당자가 이 업체 소속이 아니라 예약을 진행하지 않았습니다. 담당자 정보를 다시 확인해 주세요.",
      };
    }
    staffName = staff.role ? `${staff.name} ${staff.role}` : staff.name;
  }

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
    if (msg.includes("invalid_product_vendor")) {
      return {
        toolName: "create_booking", toolInput: input,
        toolOutput: { error: "invalid_product_vendor" }, success: false,
        displayMessage: "선택한 상품이 이 업체의 상품이 아니라 예약을 진행하지 않았습니다.",
      };
    }
    if (msg.includes("invalid_staff_vendor")) {
      return {
        toolName: "create_booking", toolInput: input,
        toolOutput: { error: "invalid_staff_vendor" }, success: false,
        displayMessage: "선택한 담당자가 이 업체 소속이 아니라 예약을 진행하지 않았습니다.",
      };
    }
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

  const booking = { id: bookingIdResult as unknown as string };

  let scheduleAdded = false;
  let budgetUpdated = false;
  let budgetExceededBy = 0;
  let categoryBudgetLimit = 0;
  let categoryLabelForOver = "";
  let syncedEvent: ScheduleEvent | null = null;
  let syncedCategoryKey: string | null = null;
  let syncedNewSpent: number | null = null;
  try {
    const syncResult = await syncBookingProgressAfterCreate(admin, {
      coupleId: ctx.coupleId,
      booking: {
        id: booking.id,
        date,
        time,
        amount,
      },
      vendorId,
      productId,
      staffId,
      productName,
    });

    if (syncResult.persisted) {
      scheduleAdded = syncResult.scheduleAdded;
      budgetUpdated = syncResult.budgetUpdated;
      budgetExceededBy = syncResult.budgetExceededBy;
      categoryBudgetLimit = syncResult.categoryBudgetLimit;
      categoryLabelForOver = syncResult.categoryLabel ?? "";
      syncedEvent = syncResult.syncedEvent;
      syncedCategoryKey = syncResult.syncedCategoryKey;
      syncedNewSpent = syncResult.syncedNewSpent;
      ctx.weddingContext.progress =
        syncResult.nextProgress as unknown as ToolExecutionContext["weddingContext"]["progress"];
    } else {
      console.error("[create_booking] auto-sync (schedule+budget) failed:", syncResult.error);
    }
  } catch (syncErr) {
    console.error("[create_booking] auto-sync (schedule+budget) failed (non-fatal):", syncErr);
  }

  const syncNote = scheduleAdded
    ? budgetUpdated
      ? " (일정·예산에 자동 반영했어요)"
      : " (일정에 자동 등록했어요)"
    : "";

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
      syncedEvent,
      syncedCategoryKey,
      syncedNewSpent,
    },
    success: true,
    displayMessage: `${vendor.name} 예약이 접수되었습니다! (${date} ${time}${productName ? ` / ${productName}` : ""}${staffName ? ` / ${staffName}` : ""})${syncNote}${overNote}`,
  };
}

export async function executeGetMyBookings(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
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

  const vendorIds = [...new Set(bookings.map((booking) => booking.vendor_id))];
  const productIds = [...new Set(bookings.filter((booking) => booking.product_id).map((booking) => booking.product_id!))];

  const { data: vendors } = await admin.from("vendors").select("id, name").in("id", vendorIds);
  const vendorMap = new Map((vendors ?? []).map((vendor) => [vendor.id, vendor.name]));

  let productMap = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: products } = await admin.from("vendor_products").select("id, name").in("id", productIds);
    productMap = new Map((products ?? []).map((product) => [product.id, product.name]));
  }

  const enriched = bookings.map((booking) => ({
    bookingId: booking.id,
    vendorName: vendorMap.get(booking.vendor_id) ?? "알 수 없음",
    productName: booking.product_id ? (productMap.get(booking.product_id) ?? "") : "",
    date: booking.booking_date,
    time: booking.booking_time,
    status: booking.status,
    amount: booking.amount ?? 0,
  }));

  return {
    toolName: "get_my_bookings", toolInput: input,
    toolOutput: { bookings: enriched },
    success: true,
    displayMessage: `${enriched.length}건의 예약이 있습니다.`,
  };
}

export async function executeCancelBooking(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const admin = getAdminClient();
  const bookingId = input.booking_id as string;
  const confirmation = requireDestructiveConfirmation(
    "cancel_booking",
    input,
    "예약을 취소하려면 먼저 사용자 확인이 필요합니다. 취소할 예약을 다시 확인해주세요."
  );
  if (confirmation) return confirmation;

  if (!bookingId || typeof bookingId !== "string" || !UUID_RE.test(bookingId)) {
    return {
      toolName: "cancel_booking", toolInput: input,
      toolOutput: { hidden: true, reason: "invalid_booking_id" },
      success: true,
      displayMessage: "",
    };
  }

  const { data: booking, error: fetchError } = await admin
    .from("vendor_bookings")
    .select("id, vendor_id, product_id, booking_date, booking_time, status, amount")
    .eq("id", bookingId)
    .eq("couple_id", ctx.coupleId)
    .single();

  if (fetchError || !booking) {
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

  const nonCancellable = ["in_service", "service_completed", "settled", "completed"];
  if (nonCancellable.includes(booking.status)) {
    return {
      toolName: "cancel_booking", toolInput: input,
      toolOutput: {}, success: false,
      displayMessage: "진행 중이거나 완료된 예약은 취소할 수 없습니다. 업체에 직접 문의해주세요.",
    };
  }

  const { error: updateError } = await admin
    .from("vendor_bookings")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", bookingId);

  if (updateError) throw updateError;

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

  let scheduleRemoved = false;
  let budgetReverted = false;
  let syncedNewSpent: number | null = null;
  let syncedEventIdRemoved: string | null = null;
  try {
    const syncResult = await syncBookingProgressAfterCancel(admin, {
      coupleId: ctx.coupleId,
      booking: {
        id: booking.id,
        amount: booking.amount as number | null,
      },
      vendor: {
        id: booking.vendor_id,
        name: vendorName,
        category: categoryKey,
      },
    });

    if (syncResult.persisted) {
      scheduleRemoved = syncResult.scheduleRemoved;
      budgetReverted = syncResult.budgetReverted;
      syncedNewSpent = syncResult.syncedNewSpent;
      syncedEventIdRemoved = syncResult.syncedEventIdRemoved;
      ctx.weddingContext.progress =
        syncResult.nextProgress as unknown as ToolExecutionContext["weddingContext"]["progress"];
    } else {
      console.error("[cancel_booking] auto-revert (schedule+budget) failed:", syncResult.error);
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
      scheduleRemoved,
      budgetReverted,
      syncedEventIdRemoved,
      syncedCategoryKey: budgetReverted ? categoryKey : null,
      syncedNewSpent,
    },
    success: true,
    displayMessage: `${vendorName} 예약이 취소되었습니다. (${booking.booking_date} ${booking.booking_time}${productName ? ` / ${productName}` : ""})${revertNote}`,
  };
}
