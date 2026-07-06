import { createAdminClient } from "@/lib/supabase/admin";
import type { ToolExecutionResult } from "@/types/database.types";
import {
  ymdInKst,
  todayKstMidnight,
  addDaysUtc,
} from "@/lib/utils/kstDate";
import { weddingPath } from "@/lib/weddingPaths";
import { cleanPostgrestSearchTerm, escapePostgrestLikePattern } from "@/utils/requestValidation";

type VendorToolExecutionContext = {
  coupleId: string;
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

const VENDOR_CATEGORY_RATIOS: Record<string, number> = {
  meeting: 0.01,
  venue: 0.20,
  studio: 0.09,
  dress: 0.07,
  makeup: 0.04,
  ring: 0.10,
  hanbok: 0.03,
  yedan: 0.04,
  honeymoon: 0.10,
  houseware: 0.05,
  housing: 0.20,
  invitation: 0.01,
  snap: 0.02,
  shoes: 0.01,
  bouquet: 0.01,
  gift: 0.01,
  mc: 0.005,
  ham: 0.005,
  pyebaek: 0.005,
  jewelry: 0.10,
};

function getAdminClient() {
  return createAdminClient();
}

export async function executeSearchVendors(
  input: Record<string, unknown>,
  ctx: VendorToolExecutionContext
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

  query = query.order("rating", { ascending: false });

  const { data: vendors, error } = await query;
  if (error) throw error;

  const results = (vendors ?? []).map((vendor) => ({
    id: vendor.id,
    name: vendor.name,
    category: vendor.category,
    location: vendor.location || vendor.region,
    priceRange: vendor.price_range,
    rating: vendor.rating,
    reviewCount: vendor.review_count,
    tags: vendor.tags,
    aiRecommend: vendor.ai_recommend,
    link: weddingPath(`/vendors/${vendor.id}`),
  }));

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
  const targetDay = input.day as number | undefined;

  const { data: vendor } = await admin
    .from("vendors")
    .select("name")
    .eq("id", vendorId)
    .eq("status", "approved") // 비노출(pending 등) 업체는 과거 대화의 [vendor:ID]로도 접근 불가
    .single();

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
    const { data: product } = await admin
      .from("vendor_products")
      .select("id")
      .eq("id", productId)
      .eq("vendor_id", vendorId)
      .maybeSingle();
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
  const fetchSlotsFor = async (table: string, fk: string, value: string): Promise<SlotRow[]> => {
    let query = admin
      .from(table)
      .select("day, hour, available, max_bookings")
      .eq(fk, value)
      .eq("available", true);
    if (targetDay !== undefined) query = query.eq("day", targetDay);
    const { data } = await query;
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
  const productOwnsSchedule = productId ? await hasAnyRows("product_timeslots", "product_id", productId) : false;
  if (productOwnsSchedule && productId) {
    slots = await fetchSlotsFor("product_timeslots", "product_id", productId);
  } else {
    slots = await fetchSlotsFor("vendor_timeslots", "vendor_id", vendorId);
  }

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
    .neq("status", "cancelled");

  if (productOwnsSchedule && productId) {
    bookingQuery = bookingQuery.eq("product_id", productId);
  }

  const { data: bookings } = await bookingQuery;

  const bookingCountMap = new Map<string, number>();
  for (const booking of bookings ?? []) {
    const key = `${booking.booking_date}:${booking.booking_time}`;
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
      maxBookings: slot.max_bookings,
      currentBookings,
      remaining,
      available: remaining > 0,
    };
  }).filter((slot) => slot.available);

  return {
    toolName: "check_vendor_availability",
    toolInput: input,
    toolOutput: { vendorName: vendor.name, slots: availableSlots, count: availableSlots.length },
    success: true,
    displayMessage: availableSlots.length > 0
      ? `${vendor.name}의 예약 가능 시간 ${availableSlots.length}개: ${availableSlots.slice(0, 5).map((slot) => `${slot.dayLabel} ${slot.time}(잔여${slot.remaining}석)`).join(", ")}${availableSlots.length > 5 ? " ..." : ""}`
      : `${vendor.name}은(는) 현재 예약 가능한 시간이 없습니다.`,
  };
}

export async function executeRecommendVendors(
  input: Record<string, unknown>,
  ctx: VendorToolExecutionContext
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

  const categoryProgress = ctx.weddingContext.progress[dbCat];
  const categoryBudget = (categoryProgress as Record<string, unknown>)?.budget as number | undefined;
  const totalBudget = ctx.weddingContext.budget;
  const ratio = VENDOR_CATEGORY_RATIOS[dbCat] ?? 0.05;
  const estimatedBudget = priceMax || categoryBudget || Math.round(totalBudget * ratio);

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
      viewedVendorIds = (viewed ?? []).map((viewedVendor) => viewedVendor.vendor_id).filter(Boolean);
    }
  }

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

  if (location) {
    const safeLocation = cleanPostgrestSearchTerm(location);
    if (safeLocation) {
      const escapedLocation = escapePostgrestLikePattern(safeLocation);
      query = query.or(`location.ilike.%${escapedLocation}%,region.ilike.%${escapedLocation}%`);
    }
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
      return (b.rating ?? 0) - (a.rating ?? 0);
    });
    candidates = scored;
  }

  let availableVendorIds: Set<string> | null = null;
  if (preferredDay !== undefined || preferredTime) {
    const timeHours: number[] = [];
    if (preferredTime === "morning") {
      for (let hour = 9; hour < 12; hour++) timeHours.push(hour);
    } else if (preferredTime === "afternoon") {
      for (let hour = 12; hour < 17; hour++) timeHours.push(hour);
    } else if (preferredTime === "evening") {
      for (let hour = 17; hour < 21; hour++) timeHours.push(hour);
    }

    const candidateIds = candidates.map((vendor) => vendor.id);
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
      availableVendorIds = new Set((availableSlots ?? []).map((slot) => slot.vendor_id));
    }
  }

  if (availableVendorIds) {
    const available = candidates.filter((vendor) => availableVendorIds!.has(vendor.id));
    if (available.length >= limit) {
      candidates = available;
    } else {
      const notAvailable = candidates.filter((vendor) => !availableVendorIds!.has(vendor.id));
      candidates = [...available, ...notAvailable];
    }
  }

  const selected = candidates.slice(0, limit);

  const days = ["월", "화", "수", "목", "금", "토", "일"];
  const results = selected.map((vendor) => {
    const reasons: string[] = [];
    if (vendor.ai_recommend) reasons.push("한방 큐레이션 후보");
    if (mood) {
      const moodScore = (vendor as Record<string, unknown>)._moodScore as number ?? 0;
      if (moodScore > 0) reasons.push(`'${mood}' 분위기 매칭`);
    }
    if (availableVendorIds?.has(vendor.id)) {
      const timeLabel = preferredTime === "morning" ? "오전" : preferredTime === "afternoon" ? "오후" : preferredTime === "evening" ? "저녁" : "";
      const dayLabel = preferredDay !== undefined ? `${days[preferredDay]}요일` : "";
      reasons.push(`${dayLabel} ${timeLabel} 예약 가능`.trim());
    }
    if (vendor.rating >= 4.5) reasons.push(`높은 평점 ${vendor.rating}점`);
    if (estimatedBudget > 0 && vendor.price_min <= estimatedBudget) reasons.push("예산 범위 내");
    if (location && ((vendor.location ?? "").includes(location) || (vendor.region ?? "").includes(location))) {
      reasons.push(`${location} 지역`);
    }
    if (vendor.review_count > 10) reasons.push(`리뷰 ${vendor.review_count}개`);
    if (reasons.length === 0) reasons.push("카테고리 인기 업체");

    return {
      id: vendor.id,
      name: vendor.name,
      location: vendor.location || vendor.region,
      priceRange: vendor.price_range,
      rating: vendor.rating,
      reviewCount: vendor.review_count,
      tags: vendor.tags,
      description: vendor.description?.slice(0, 100),
      reasons,
      link: weddingPath(`/vendors/${vendor.id}`),
    };
  });

  const filterDesc = [
    mood ? `분위기: ${mood}` : "",
    preferredDay !== undefined ? `요일: ${days[preferredDay]}` : "",
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
      ? `${category} 추천 업체 ${results.length}개${filterDesc ? ` (${filterDesc})` : ""}:\n${results.map((vendor, index) => `${index + 1}. ${vendor.name} (${vendor.priceRange}, ${vendor.rating}점) - ${vendor.reasons.join(", ")}`).join("\n")}`
      : `${category} 카테고리에 조건에 맞는 업체가 없습니다.`,
  };
}

export async function executeGetVendorDetail(
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const admin = getAdminClient();
  const vendorId = input.vendor_id as string;

  const { data: vendor } = await admin
    .from("vendors")
    .select("id, name, category, location, price_range")
    .eq("id", vendorId)
    .eq("status", "approved") // 비노출 업체 상세 차단 (시드 pending 전환 이전 대화 잔재 방어)
    .single();

  if (!vendor) {
    return {
      toolName: "get_vendor_detail",
      toolInput: input,
      toolOutput: {},
      success: false,
      displayMessage: "업체를 찾을 수 없습니다.",
    };
  }

  const { data: products } = await admin
    .from("vendor_products")
    .select("id, name, description, price, discount_price, duration_minutes, is_popular, includes")
    .eq("vendor_id", vendorId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const { data: staff } = await admin
    .from("vendor_staff")
    .select("id, name, role, description")
    .eq("vendor_id", vendorId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const productList = (products ?? []).map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description?.slice(0, 80) || "",
    price: product.price,
    discountPrice: product.discount_price || null,
    duration: product.duration_minutes || null,
    isPopular: product.is_popular || false,
    includes: product.includes || [],
  }));

  const staffList = (staff ?? []).map((staffMember) => ({
    id: staffMember.id,
    name: staffMember.name,
    role: staffMember.role || null,
    description: staffMember.description?.slice(0, 60) || "",
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
