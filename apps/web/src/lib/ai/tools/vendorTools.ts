import { createAdminClient } from "@/lib/supabase/admin";
import type { ToolExecutionResult } from "@/types/database.types";
import {
  ymdInKst,
  todayKstMidnight,
  addDaysUtc,
} from "@/lib/utils/kstDate";
import { weddingPath } from "@/lib/weddingPaths";
import { cleanPostgrestSearchTerm, escapePostgrestLikePattern } from "@/utils/requestValidation";
import { bookingSlotCountKey } from "@/lib/ai/tools/bookingTime";

type VendorToolExecutionContext = {
  coupleId: string;
  currentUserId?: string;
  weddingContext: {
    budget: number;
    progress: Record<string, { category: string; status: string }>;
  };
};

const VENDOR_CATEGORY_MAP: Record<string, string> = {
  "스튜디오": "studio",
  "드레스": "dress",
  "메이크업": "makeup",
  "예식장": "venue",
  "한복": "hanbok",
  "예물": "jewelry",
  "신혼여행": "honeymoon",
  "기타": "other",
};

const MAX_VENDOR_RESULTS = 10;
const MAX_VENDOR_DETAIL_ROWS = 10;
const MAX_AVAILABILITY_QUERY_ROWS = 100;
const MAX_BOOKING_QUERY_ROWS = 500;

function availabilityDataTruncatedResult(
  toolName: "check_vendor_availability",
  toolInput: Record<string, unknown>,
  source: "timeslots" | "bookings"
): ToolExecutionResult {
  return {
    toolName,
    toolInput,
    toolOutput: { error: "availability_data_truncated", source },
    success: false,
    displayMessage: "예약 데이터가 많아 정확한 예약 가능 시간을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.",
  };
}

function clampResultLimit(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(MAX_VENDOR_RESULTS, Math.max(1, Math.trunc(numeric)));
}

function cleanVendorText(value: unknown, maxLength = 120): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[<>`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanVendorList(value: unknown, maxItems = 8, maxLength = 60): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanVendorText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function getAdminClient() {
  return createAdminClient();
}

function formatAvailabilitySlotDateTime(slot: { date?: string | null; dayLabel?: string | null; time: string }): string {
  if (slot.date) {
    return slot.dayLabel ? `${slot.date} (${slot.dayLabel}) ${slot.time}` : `${slot.date} ${slot.time}`;
  }
  return slot.dayLabel ? `${slot.dayLabel}요일 ${slot.time}` : slot.time;
}

export async function executeSearchVendors(
  input: Record<string, unknown>,
  ctx: VendorToolExecutionContext
): Promise<ToolExecutionResult> {
  void ctx;
  const admin = getAdminClient();
  const limit = clampResultLimit(input.limit, 5);
  let query = admin
    .from("vendors")
    .select("id, name, category, location, region, price_range, price_min, price_max, rating, review_count, tags")
    .eq("status", "approved")
    .limit(limit);

  if (input.category) {
    const dbCat = VENDOR_CATEGORY_MAP[input.category as string] || (input.category as string);
    query = query.eq("category", dbCat);
  }
  if (input.location) {
    const location = cleanPostgrestSearchTerm(input.location);
    if (location) {
      const escapedLocation = escapePostgrestLikePattern(location);
      query = query.or(`location.ilike.%${escapedLocation}%,region.ilike.%${escapedLocation}%`);
    }
  }
  if (input.price_max) {
    query = query.lte("price_min", input.price_max as number);
  }
  if (input.price_min) {
    query = query.gte("price_max", input.price_min as number);
  }
  if (input.search) {
    const search = cleanPostgrestSearchTerm(input.search);
    if (search) {
      const escapedSearch = escapePostgrestLikePattern(search);
      query = query.or(`name.ilike.%${escapedSearch}%`);
    }
  }

  query = query.order("name", { ascending: true });

  const { data: vendors, error } = await query;
  if (error) throw error;

  const results = (vendors ?? []).map((vendor) => ({
    id: vendor.id,
    name: cleanVendorText(vendor.name, 80),
    category: cleanVendorText(vendor.category, 40),
    location: cleanVendorText(vendor.location || vendor.region, 100),
    priceRange: cleanVendorText(vendor.price_range, 80),
    rating: Number.isFinite(vendor.rating) ? vendor.rating : null,
    reviewCount: Number.isFinite(vendor.review_count) ? vendor.review_count : null,
    tags: cleanVendorList(vendor.tags),
    link: weddingPath(`/vendors/${vendor.id}`),
  }));

  return {
    toolName: "search_vendors",
    toolInput: input,
    toolOutput: {
      vendors: results,
      count: results.length,
      caveat: "등록 검색 결과입니다. 평점·리뷰는 등록 값이며 출처·최신성을 확인하지 않았고, 품질·최신 가격·예약 가능 여부를 보증하지 않습니다.",
    },
    success: true,
    displayMessage: results.length > 0
      ? `${results.length}개 업체를 찾았습니다: ${results.map((vendor) => `${vendor.name}(${vendor.priceRange})`).join(", ")}`
      : "조건에 맞는 업체가 없습니다.",
  };
}

export async function executeCheckVendorAvailability(
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const admin = getAdminClient();
  const vendorId = input.vendor_id as string;
  const productId = input.product_id as string | undefined;
  const targetDay = Number.isInteger(input.day) && Number(input.day) >= 0 && Number(input.day) <= 6
    ? Number(input.day)
    : undefined;

  const { data: vendor, error: vendorError } = await admin
    .from("vendors")
    .select("name")
    .eq("id", vendorId)
    .eq("status", "approved") // 비노출(pending 등) 업체는 과거 대화의 [vendor:ID]로도 접근 불가
    .maybeSingle();

  if (vendorError) throw vendorError;

  if (!vendor) {
    return {
      toolName: "check_vendor_availability",
      toolInput: input,
      toolOutput: {},
      success: false,
      displayMessage: "업체를 찾을 수 없습니다.",
    };
  }

  if (productId) {
    const { data: product, error: productError } = await admin
      .from("vendor_products")
      .select("id")
      .eq("id", productId)
      .eq("vendor_id", vendorId)
      .eq("is_active", true)
      .maybeSingle();
    if (productError) throw productError;
    if (!product) {
      return {
        toolName: "check_vendor_availability",
        toolInput: input,
        toolOutput: { error: "invalid_product_vendor", vendorId, productId },
        success: false,
        displayMessage: "선택한 상품이 이 업체의 상품이 아니라 예약 가능 시간을 확인하지 않았습니다.",
      };
    }
  }

  type SlotRow = { day: number; hour: number; available: boolean; max_bookings: number };
  const fetchSlotsFor = async (
    table: string,
    fk: string,
    value: string
  ): Promise<{ rows: SlotRow[]; truncated: boolean }> => {
    let query = admin
      .from(table)
      .select("day, hour, available, max_bookings")
      .eq(fk, value)
      .eq("available", true)
      .limit(MAX_AVAILABILITY_QUERY_ROWS + 1);
    if (targetDay !== undefined) query = query.eq("day", targetDay);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as SlotRow[];
    return {
      rows: rows.slice(0, MAX_AVAILABILITY_QUERY_ROWS),
      truncated: rows.length > MAX_AVAILABILITY_QUERY_ROWS,
    };
  };

  const hasAnyRows = async (table: string, fk: string, value: string): Promise<boolean> => {
    const { count, error } = await admin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(fk, value)
      .eq("available", true);
    if (error) throw error;
    return (count ?? 0) > 0;
  };

  let slotResult: { rows: SlotRow[]; truncated: boolean };
  const productOwnsSchedule = productId ? await hasAnyRows("product_timeslots", "product_id", productId) : false;
  if (productOwnsSchedule && productId) {
    slotResult = await fetchSlotsFor("product_timeslots", "product_id", productId);
  } else {
    slotResult = await fetchSlotsFor("vendor_timeslots", "vendor_id", vendorId);
  }
  if (slotResult.truncated) {
    return availabilityDataTruncatedResult("check_vendor_availability", input, "timeslots");
  }
  const slots = slotResult.rows;

  const today = todayKstMidnight();
  const dateStrings: string[] = [];
  const dayToDate = new Map<number, string>();
  const kstDayOfWeek = (ymd: string): number => {
    const [year, month, day] = ymd.split("-").map(Number);
    return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  };
  for (let i = 0; i < 7; i++) {
    const dateStr = ymdInKst(addDaysUtc(today, i));
    const day = kstDayOfWeek(dateStr);
    dateStrings.push(dateStr);
    if (!dayToDate.has(day)) dayToDate.set(day, dateStr);
  }

  let bookingQuery = admin
    .from("vendor_bookings")
    .select("booking_date, booking_time")
    .eq("vendor_id", vendorId)
    .in("booking_date", dateStrings)
    .neq("status", "cancelled")
    .limit(MAX_BOOKING_QUERY_ROWS + 1);

  if (productOwnsSchedule && productId) {
    bookingQuery = bookingQuery.eq("product_id", productId);
  }

  const { data: bookings, error: bookingsError } = await bookingQuery;
  if (bookingsError) throw bookingsError;
  if ((bookings?.length ?? 0) > MAX_BOOKING_QUERY_ROWS) {
    return availabilityDataTruncatedResult("check_vendor_availability", input, "bookings");
  }

  const bookingCountMap = new Map<string, number>();
  for (const booking of bookings ?? []) {
    const key = bookingSlotCountKey(booking.booking_date, booking.booking_time);
    if (!key) continue;
    bookingCountMap.set(key, (bookingCountMap.get(key) ?? 0) + 1);
  }

  const days = ["월", "화", "수", "목", "금", "토", "일"];
  const availableSlots = slots.map((slot) => {
    const dateStr = dayToDate.get(slot.day);
    const timeStr = `${String(slot.hour).padStart(2, "0")}:00`;
    const currentBookings = dateStr ? (bookingCountMap.get(`${dateStr}:${timeStr}`) ?? 0) : 0;
    const remaining = slot.max_bookings - currentBookings;
    return {
      day: slot.day,
      dayLabel: days[slot.day],
      hour: slot.hour,
      time: timeStr,
      date: dateStr,
      dateTimeLabel: formatAvailabilitySlotDateTime({ date: dateStr, dayLabel: days[slot.day], time: timeStr }),
      maxBookings: slot.max_bookings,
      currentBookings,
      remaining,
      available: remaining > 0,
    };
  }).filter((slot) => slot.available);

  return {
    toolName: "check_vendor_availability",
    toolInput: input,
      toolOutput: { vendorName: cleanVendorText(vendor.name, 80), slots: availableSlots.slice(0, 40), count: Math.min(availableSlots.length, 40) },
    success: true,
    displayMessage: availableSlots.length > 0
      ? `${cleanVendorText(vendor.name, 80)}의 예약 가능 시간 ${Math.min(availableSlots.length, 40)}개: ${availableSlots.slice(0, 5).map((slot) => `${slot.dateTimeLabel}(잔여${slot.remaining}석)`).join(", ")}${availableSlots.length > 5 ? " ..." : ""}`
      : `${cleanVendorText(vendor.name, 80)}은(는) 현재 예약 가능한 시간이 없습니다.`,
  };
}

export async function executeRecommendVendors(
  input: Record<string, unknown>,
  ctx: VendorToolExecutionContext
): Promise<ToolExecutionResult> {
  const admin = getAdminClient();
  const category = cleanVendorText(input.category, 40);
  const limit = clampResultLimit(input.limit, 3);
  const dbCat = VENDOR_CATEGORY_MAP[category] || category;
  const mood = cleanVendorText(input.mood, 80) || undefined;
  const location = cleanVendorText(input.location, 100) || undefined;
  const locationSearch = location ? cleanPostgrestSearchTerm(location) : "";

  const categoryProgress = ctx.weddingContext.progress[dbCat];
  const rawCategoryBudget = (categoryProgress as Record<string, unknown> | undefined)?.budget;
  const categoryBudget = typeof rawCategoryBudget === "number"
    && Number.isSafeInteger(rawCategoryBudget)
    && rawCategoryBudget >= 0
    ? rawCategoryBudget
    : undefined;
  const priceMax = typeof input.price_max === "number"
    && Number.isSafeInteger(input.price_max)
    && input.price_max >= 0
    ? input.price_max
    : undefined;
  const budgetLimit = priceMax ?? categoryBudget;
  const budgetBasis = priceMax !== undefined
    ? "user_price_max"
    : categoryBudget !== undefined
      ? "saved_category_budget"
      : null;

  let viewedVendorIds: string[] = [];
  if (ctx.currentUserId) {
    const { data: viewed, error: viewedError } = await admin
      .from("customer_events")
      .select("vendor_id")
      .eq("user_id", ctx.currentUserId)
      .eq("event_type", "vendor_view")
      .not("vendor_id", "is", null)
      .limit(50);
    if (viewedError) throw viewedError;
    viewedVendorIds = (viewed ?? []).map((viewedVendor) => viewedVendor.vendor_id).filter(Boolean);
  }

  let query = admin
    .from("vendors")
    .select("id, name, category, location, region, price_range, price_min, price_max, rating, review_count, tags, description")
    .eq("status", "approved")
    .eq("category", dbCat)
    .order("name", { ascending: true })
    .limit(Math.min((limit + viewedVendorIds.length) * 2, 60));

  if (budgetLimit !== undefined) {
    query = query.lte("price_min", budgetLimit);
  }

  if (locationSearch) {
    const escapedLocation = escapePostgrestLikePattern(locationSearch);
    query = query.or(`location.ilike.%${escapedLocation}%,region.ilike.%${escapedLocation}%`);
  }

  const { data: vendors, error } = await query;
  if (error) throw error;

  let candidates = (vendors ?? []).filter((vendor) => !viewedVendorIds.includes(vendor.id));

  if (mood) {
    const moodKeywords = mood.toLowerCase().split(/[,\s]+/).filter(Boolean);
    const scored = candidates.map((vendor) => {
      const vendorText = [
        ...(vendor.tags ?? []),
        vendor.description ?? "",
        vendor.name ?? "",
      ].join(" ").toLowerCase();

      let moodScore = 0;
      for (const keyword of moodKeywords) {
        if (vendorText.includes(keyword)) moodScore += 2;
      }
      if (vendor.tags) {
        for (const tag of vendor.tags as string[]) {
          for (const keyword of moodKeywords) {
            if (tag.toLowerCase().includes(keyword)) moodScore += 3;
          }
        }
      }
      return { ...vendor, _moodScore: moodScore };
    });
    scored.sort((a, b) => {
      if (b._moodScore !== a._moodScore) return b._moodScore - a._moodScore;
      return String(a.name ?? "").localeCompare(String(b.name ?? ""), "ko");
    });
    candidates = scored.filter((vendor) => vendor._moodScore > 0);
  }

  const selected = candidates.slice(0, limit);

  const results = selected.map((vendor) => {
    const reasons: string[] = [];
    if (mood) {
      const moodScore = (vendor as Record<string, unknown>)._moodScore as number ?? 0;
      if (moodScore > 0) reasons.push(`등록 설명·태그에 '${mood}' 관련 표현 있음`);
    }
    if (Number.isFinite(vendor.rating)) reasons.push(`등록 평점 ${vendor.rating}점 · 출처·최신성 확인 필요`);
    if (budgetLimit !== undefined && Number.isFinite(vendor.price_min) && vendor.price_min <= budgetLimit) {
      reasons.push("등록 최저가가 입력 상한 이하 · 실제 총액 확인 필요");
    }
    if (locationSearch) {
      reasons.push(`등록 지역 조건 '${locationSearch}' 일치`);
    }
    if (Number.isFinite(vendor.review_count)) reasons.push(`등록 리뷰 수 ${vendor.review_count}개 · 출처·최신성 확인 필요`);
    if (reasons.length === 0) reasons.push("등록 카테고리 조건 일치");

    return {
      id: vendor.id,
      name: cleanVendorText(vendor.name, 80),
      location: cleanVendorText(vendor.location || vendor.region, 100),
      priceRange: cleanVendorText(vendor.price_range, 80),
      rating: Number.isFinite(vendor.rating) ? vendor.rating : null,
      reviewCount: Number.isFinite(vendor.review_count) ? vendor.review_count : null,
      tags: cleanVendorList(vendor.tags),
      description: cleanVendorText(vendor.description, 160),
      reasons: reasons.map((reason) => cleanVendorText(reason, 100)).slice(0, 6),
      link: weddingPath(`/vendors/${vendor.id}`),
    };
  });

  const filterDesc = [
    mood ? `분위기: ${mood}` : "",
    locationSearch ? `지역: ${locationSearch}` : "",
    budgetLimit !== undefined ? `등록 최저가 상한: ${budgetLimit.toLocaleString("ko-KR")}원` : "",
  ].filter(Boolean).join(", ");

  return {
    toolName: "recommend_vendors",
    toolInput: input,
    toolOutput: {
      vendors: results,
      count: results.length,
      budgetLimit: budgetLimit ?? null,
      budgetBasis,
      category,
      filters: filterDesc || undefined,
      caveat: "등록 정보와 입력 조건의 일치 여부만 정리한 검토 후보입니다. 순위·품질·최신 가격·예약 가능 여부는 보증하지 않으므로 업체에 직접 확인해야 합니다.",
    },
    success: true,
    displayMessage: results.length > 0
      ? `${category} 등록 조건 검토 후보 ${results.length}개${filterDesc ? ` (${filterDesc})` : ""}:\n${results.map((vendor, index) => `${index + 1}. ${vendor.name} (${vendor.priceRange}) - ${vendor.reasons.join(", ")}`).join("\n")}\n등록 정보 기준이며 최신 가격·품질·예약 가능 여부는 업체에 직접 확인해야 합니다.`
      : `${category} 카테고리에 등록 조건이 일치하는 검토 후보가 없습니다.`,
  };
}

export async function executeGetVendorDetail(
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const admin = getAdminClient();
  const vendorId = input.vendor_id as string;

  const { data: vendor, error: vendorError } = await admin
    .from("vendors")
    .select("id, name, category, location, price_range")
    .eq("id", vendorId)
    .eq("status", "approved") // 비노출 업체 상세 차단 (시드 pending 전환 이전 대화 잔재 방어)
    .maybeSingle();

  if (vendorError) throw vendorError;

  if (!vendor) {
    return {
      toolName: "get_vendor_detail",
      toolInput: input,
      toolOutput: {},
      success: false,
      displayMessage: "업체를 찾을 수 없습니다.",
    };
  }

  const { data: products, error: productsError } = await admin
    .from("vendor_products")
    .select("id, name, description, price, discount_price, duration_minutes, includes")
    .eq("vendor_id", vendorId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .limit(MAX_VENDOR_DETAIL_ROWS);
  if (productsError) throw productsError;

  const { data: staff, error: staffError } = await admin
    .from("vendor_staff")
    .select("id, name, role, description")
    .eq("vendor_id", vendorId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .limit(MAX_VENDOR_DETAIL_ROWS);
  if (staffError) throw staffError;

  const productList = (products ?? []).map((product) => ({
    id: product.id,
    name: cleanVendorText(product.name, 80),
    description: cleanVendorText(product.description, 120),
    price: product.price,
    discountPrice: product.discount_price || null,
    duration: product.duration_minutes || null,
    includes: cleanVendorList(product.includes, 12, 80),
  }));

  const staffList = (staff ?? []).map((staffMember) => ({
    id: staffMember.id,
    name: cleanVendorText(staffMember.name, 80),
    role: cleanVendorText(staffMember.role, 60) || null,
    description: cleanVendorText(staffMember.description, 100),
  }));

  return {
    toolName: "get_vendor_detail",
    toolInput: input,
    toolOutput: {
      vendorId: vendor.id,
      vendorName: cleanVendorText(vendor.name, 80),
      category: cleanVendorText(vendor.category, 40),
      location: cleanVendorText(vendor.location, 100),
      priceRange: cleanVendorText(vendor.price_range, 80),
      products: productList,
      staff: staffList,
    },
    success: true,
    displayMessage: `${cleanVendorText(vendor.name, 80)}의 상품 ${productList.length}개, 스태프 ${staffList.length}명`,
  };
}
