import { createAdminClient } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public";
import type { ToolExecutionResult } from "@/types/database.types";
import {
  ymdInKst,
  todayKstMidnight,
  addDaysUtc,
} from "@/lib/utils/kstDate";
import { weddingPath } from "@/lib/weddingPaths";
import { cleanPostgrestSearchTerm, escapePostgrestLikePattern, isUuid } from "@/utils/requestValidation";
import { rankVendorRecommendations } from "@/lib/vendors/recommendation";
import {
  loadRecommendationCandidates,
  logRecommendationImpressions,
} from "@/lib/vendors/recommendationData";
import { parseVendorRecommendationRequest } from "@/lib/vendors/recommendationRequest";
import type { VendorAttributeCategory } from "@/lib/vendors/attributeSchemas";
import { loadVendorProfile } from "@/lib/vendors/vendorProfileData";
import { CURRENT_VENDOR_STAFF_PUBLICATION_CONSENT_VERSION } from "@/lib/vendors/staffPublicationConsent";

type VendorToolExecutionContext = {
  coupleId: string;
  userId?: string;
  weddingContext: {
    budget: number;
    progress: Record<string, { category: string; status: string }>;
  };
};

const MAX_LEGACY_VENDOR_SEARCH_RESULTS = 10;
const MAX_VENDOR_PRODUCTS = 25;
const MAX_VENDOR_STAFF = 20;
const MAX_VENDOR_PRODUCT_INCLUDES = 8;
const MAX_VENDOR_PROFILE_PRICES = 6;
const MAX_VENDOR_PROFILE_OPTIONS_PER_PRICE = 6;
const MAX_VENDOR_PROFILE_TAGS = 12;
const MAX_VENDOR_PROFILE_SOURCES = 6;

function boundedToolLimit(value: unknown, fallback: number, maximum: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
}

function boundedToolText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

function boundedNullableToolText(value: unknown, maximum: number): string | null {
  return typeof value === "string" ? value.slice(0, maximum) : null;
}

function boundedToolTextList(
  value: unknown,
  maximumItems: number,
  maximumItemLength: number,
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maximumItems)
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.slice(0, maximumItemLength));
}

type LoadedVendorProfile = NonNullable<Awaited<ReturnType<typeof loadVendorProfile>>>;

/**
 * The public profile loader intentionally supports evidence-heavy detail pages.
 * Chat only renders a small preview, so sending the complete relation graph over
 * SSE would make a single tool result needlessly large. Keep the useful, ordered
 * prefix and tell the model explicitly whenever relation rows were omitted.
 */
function boundedVendorProfileForTool(profile: LoadedVendorProfile) {
  const selectedPrices = profile.official_prices.slice(0, MAX_VENDOR_PROFILE_PRICES);
  const availableOptionCount = profile.official_prices.reduce(
    (total, price) => total + price.options.length,
    0,
  );
  const returnedOptionCount = selectedPrices.reduce(
    (total, price) => total + Math.min(price.options.length, MAX_VENDOR_PROFILE_OPTIONS_PER_PRICE),
    0,
  );
  const truncated = profile.official_prices.length > selectedPrices.length
    || availableOptionCount > returnedOptionCount
    || profile.tags.length > MAX_VENDOR_PROFILE_TAGS
    || profile.sources.length > MAX_VENDOR_PROFILE_SOURCES;

  return {
    ...profile,
    vendor: {
      ...profile.vendor,
      name: boundedToolText(profile.vendor.name, 200),
      slug: boundedToolText(profile.vendor.slug, 200),
      category: boundedToolText(profile.vendor.category, 80),
      region_code: boundedNullableToolText(profile.vendor.region_code, 80),
      urls: {
        official: boundedNullableToolText(profile.vendor.urls.official, 500),
        instagram: boundedNullableToolText(profile.vendor.urls.instagram, 500),
        naver_place: boundedNullableToolText(profile.vendor.urls.naver_place, 500),
      },
    },
    tags: profile.tags.slice(0, MAX_VENDOR_PROFILE_TAGS).map((tag) => ({
      slug: boundedToolText(tag.slug, 120),
      label: boundedToolText(tag.label, 160),
      tag_group: boundedToolText(tag.tag_group, 120),
    })),
    official_prices: selectedPrices.map((price) => ({
      ...price,
      category: boundedToolText(price.category, 80),
      item_name: boundedToolText(price.item_name, 200),
      base_spec: boundedNullableToolText(price.base_spec, 500),
      vat_note: boundedNullableToolText(price.vat_note, 300),
      price_note: boundedNullableToolText(price.price_note, 500),
      period_label: boundedToolText(price.period_label, 100),
      source: boundedToolText(price.source, 300),
      options: price.options
        .slice(0, MAX_VENDOR_PROFILE_OPTIONS_PER_PRICE)
        .map((option) => ({
          ...option,
          name: boundedToolText(option.name, 200),
          unit: boundedNullableToolText(option.unit, 80),
          condition: boundedNullableToolText(option.condition, 300),
          raw_text: boundedToolText(option.raw_text, 500),
        })),
    })),
    data_badges: boundedToolTextList(profile.data_badges, 8, 80),
    sources: boundedToolTextList(profile.sources, MAX_VENDOR_PROFILE_SOURCES, 300),
    ...(truncated
      ? {
          result_truncation: {
            policy: "amora_vendor_detail_preview_v1",
            official_prices: {
              available: profile.official_prices.length,
              returned: selectedPrices.length,
            },
            official_price_options: {
              available: availableOptionCount,
              returned: returnedOptionCount,
            },
            tags: {
              available: profile.tags.length,
              returned: Math.min(profile.tags.length, MAX_VENDOR_PROFILE_TAGS),
            },
            sources: {
              available: profile.sources.length,
              returned: Math.min(profile.sources.length, MAX_VENDOR_PROFILE_SOURCES),
            },
          },
        }
      : {}),
  };
}

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

const OFFICIAL_RECOMMENDATION_CATEGORIES: Record<string, VendorAttributeCategory> = {
  "스튜디오": "studio",
  studio: "studio",
  "드레스": "dress",
  dress: "dress",
  "메이크업": "makeup",
  makeup: "makeup",
  "예식장": "hall",
  venue: "hall",
  hall: "hall",
};

function resolveOfficialRecommendationCategory(value: unknown): VendorAttributeCategory | null {
  if (typeof value !== "string") return null;
  return OFFICIAL_RECOMMENDATION_CATEGORIES[value.trim().toLocaleLowerCase("en-US")] ?? null;
}

function officialCategoryDbName(category: VendorAttributeCategory): string {
  return category === "hall" ? "venue" : category;
}

// 서울 동네만 사전에 있어서, 지방 사용자가 자기 동네 이름을 대면 못 알아듣고
// "예: 홍대, 서초, 송파"라고 되물었다. 지방 주요 상권도 같은 대우를 받아야 한다.
const LOCAL_LANDMARK_REGIONS: Array<[RegExp, string]> = [
  [/해운대|서면|센텀|광안리|남포동|사상|기장|동래|수영구|영도/, "busan"],
  [/수성구|동성로|반월당|칠곡|달서|들안길/, "daegu"],
  [/삼산동|성남동|무거동|울산대/, "ulsan"],
  [/둔산|유성|노은|봉명동|은행동/, "daejeon"],
  [/상무지구|첨단지구|충장로|수완지구/, "gwangju"],
  [/송도|청라|영종|구월동|부평/, "incheon"],
  [/분당|판교|일산|수원|용인|동탄|광교|평촌|산본|김포|하남|남양주|의정부/, "gyeonggi"],
  [/천안|불당|아산|청주|오창|세종/, "chungcheong"],
  [/전주|익산|군산|여수|순천|목포/, "jeolla"],
  [/창원|김해|진주|포항|경주|구미|양산/, "gyeongsang"],
  [/강릉|속초|원주|춘천|평창/, "gangwon"],
  [/서귀포|애월|중문/, "jeju"],
];

const RECOMMENDATION_REGION_LABELS: Array<[string, string]> = [
  ["경기", "gyeonggi"],
  ["인천", "incheon"],
  ["강원", "gangwon"],
  ["충청", "chungcheong"],
  ["충남", "chungcheong"],
  ["충북", "chungcheong"],
  ["대전", "daejeon"],
  ["경상", "gyeongsang"],
  ["경남", "gyeongsang"],
  ["경북", "gyeongsang"],
  ["부산", "busan"],
  ["울산", "ulsan"],
  ["대구", "daegu"],
  ["전라", "jeolla"],
  ["전남", "jeolla"],
  ["전북", "jeolla"],
  ["광주", "gwangju"],
  ["제주", "jeju"],
];

const RECOMMENDATION_REGION_CODE_LABELS: Record<string, string> = {
  seoul_gangnam3: "서울 강남권",
  seoul_etc: "서울 기타 지역",
  gyeonggi: "경기도",
  incheon: "인천",
  gangwon: "강원도",
  chungcheong: "충청도",
  daejeon: "대전",
  gyeongsang: "경상도",
  busan: "부산",
  ulsan: "울산",
  daegu: "대구",
  jeolla: "전라도",
  gwangju: "광주",
  jeju: "제주",
};

function recommendationRegions(location: unknown): string[] {
  if (typeof location !== "string") return [];
  const normalized = location.trim();
  if (normalized in RECOMMENDATION_REGION_CODE_LABELS) return [normalized];

  const regions = new Set<string>();
  if (/강남\s*외|서울\s*(?:기타|강북)/.test(normalized)) {
    regions.add("seoul_etc");
  } else if (/(?:강남|서초|송파|잠실|청담|압구정|논현|역삼|삼성|대치|도곡|반포|양재|방배)/.test(normalized)) {
    regions.add("seoul_gangnam3");
  } else if (/(?:홍대|마포|합정|연남|성수|건대|광진|종로|용산|여의도|영등포|노원|은평|서대문|동대문|성북|중랑|구로|금천|관악|동작|목동|양천)/.test(normalized)) {
    regions.add("seoul_etc");
  } else if (normalized.includes("서울")) {
    regions.add("seoul_gangnam3");
    regions.add("seoul_etc");
  }
  // 지방 주요 상권도 시·도 이름 없이 지명만으로 인식한다.
  // (부산 사람이 "해운대"라고 말했는데 못 알아듣고 되묻는 일을 없앤다)
  for (const [pattern, code] of LOCAL_LANDMARK_REGIONS) {
    if (pattern.test(normalized)) regions.add(code);
  }
  for (const [label, code] of RECOMMENDATION_REGION_LABELS) {
    if (normalized.includes(label)) regions.add(code);
  }
  return [...regions];
}

function recommendationTags(input: Record<string, unknown>): string[] {
  if (Array.isArray(input.preferred_tags)) {
    return input.preferred_tags.filter((value): value is string =>
      typeof value === "string" && value.trim().length > 0
    );
  }
  if (typeof input.mood !== "string") return [];
  return input.mood.split(/[,/·\s]+/).map((value) => value.trim()).filter(Boolean);
}

function plainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function recommendationPriceRange(minKrw: number, maxKrw: number | null): string {
  const money = (value: number) => `${value.toLocaleString("ko-KR")}원`;
  return maxKrw === null || maxKrw === minKrw
    ? money(minKrw)
    : `${money(minKrw)} ~ ${money(maxKrw)}`;
}

function getAdminClient() {
  return createAdminClient();
}

async function resolveBoundActorId(
  admin: ReturnType<typeof createAdminClient>,
  ctx: VendorToolExecutionContext,
): Promise<string | null> {
  const actorId = ctx.userId ?? "";
  if (!isUuid(ctx.coupleId) || !isUuid(actorId)) return null;

  const { data: profile, error } = await admin
    .from("profiles")
    .select("id")
    .eq("id", actorId)
    .eq("couple_id", ctx.coupleId)
    .maybeSingle();
  return !error && profile?.id === actorId ? actorId : null;
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
  const category = typeof input.category === "string" ? input.category.trim() : "";
  const exactName = cleanPostgrestSearchTerm(input.search);
  const officialCategory = resolveOfficialRecommendationCategory(category);
  const isExactNameLookup = Boolean(exactName);
  if (officialCategory && !exactName) {
    const recommendation = await executeRecommendVendors({
      category,
      ...(typeof input.location === "string" ? { location: input.location } : {}),
      ...(typeof input.price_max === "number" ? { price_max: input.price_max } : {}),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    }, ctx);
    return {
      ...recommendation,
      toolName: "search_vendors",
      toolInput: input,
    };
  }
  if (!category && !exactName) {
    return {
      toolName: "search_vendors",
      toolInput: input,
      toolOutput: { error: "vendor_search_scope_required" },
      success: false,
      displayMessage: "찾을 업체명이나 카테고리를 알려주세요. 비교 추천은 공시 데이터 기준으로 확인해드릴게요.",
    };
  }

  const admin = getAdminClient();
  let query = admin
    .from("vendors")
    .select("id, slug, name, category, location, region, price_range, price_min, price_max, rating, review_count, tags, ai_recommend")
    .eq("status", "approved")
    .limit(boundedToolLimit(input.limit, 5, MAX_LEGACY_VENDOR_SEARCH_RESULTS));

  if (input.category) {
    const dbCat = officialCategory
      ? officialCategoryDbName(officialCategory)
      : VENDOR_CATEGORY_MAP[category] || category;
    query = query.eq("category", dbCat);
  }
  if (!isExactNameLookup && input.location) {
    const location = cleanPostgrestSearchTerm(input.location);
    if (location) {
      const escapedLocation = escapePostgrestLikePattern(location);
      query = query.or(`location.ilike.%${escapedLocation}%,region.ilike.%${escapedLocation}%`);
    }
  }
  if (!isExactNameLookup && input.price_max) {
    query = query.lte("price_min", input.price_max as number);
  }
  if (!isExactNameLookup && input.price_min) {
    query = query.gte("price_max", input.price_min as number);
  }
  if (exactName) {
    if (isExactNameLookup) {
      query = query.eq("name", exactName);
    } else {
      const escapedSearch = escapePostgrestLikePattern(exactName);
      query = query.or(`name.ilike.%${escapedSearch}%`);
    }
  }

  query = isExactNameLookup
    ? query.order("name", { ascending: true })
    : query.order("rating", { ascending: false });

  const { data: vendors, error } = await query;
  if (error) throw error;

  const results = (vendors ?? []).map((vendor) => isExactNameLookup
    ? {
      id: vendor.id,
      name: vendor.name,
      category: vendor.category,
      location: vendor.location || vendor.region,
      link: officialCategory && typeof vendor.slug === "string" && vendor.slug.trim().length > 0
        ? `/price/vendor/${encodeURIComponent(vendor.slug)}`
        : weddingPath(`/vendors/${vendor.id}`),
    }
    : {
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
    });

  // 체험 상담의 coupleId는 "demo-couple"이라 uuid 컬럼 비교가 매번 에러를 낸다.
  // 개인화는 인증된 호출자가 이 커플에 속한다는 사실까지 다시 확인한 뒤 적용한다.
  const actorId = await resolveBoundActorId(admin, ctx);
  if (actorId) {
    await admin.from("search_logs").insert({
      user_id: actorId,
      query: (input.search as string) || (input.category as string) || "AI 검색",
      category: (input.category as string) || null,
      result_count: results.length,
    }).then(() => {});
  }

  return {
    toolName: "search_vendors",
    toolInput: input,
    toolOutput: {
      ...(isExactNameLookup
        ? {
          lookupPolicy: "exact_name_lookup_v1",
          dataNotice: "업체명 확인 결과이며 가격·추천 근거는 공시 상세에서 확인합니다.",
        }
        : {}),
      vendors: results,
      count: results.length,
    },
    success: true,
    displayMessage: results.length > 0
      ? isExactNameLookup
        ? `${results.length}개 업체명을 확인했어요: ${results.map((vendor) => vendor.name).join(", ")}. 가격과 추천 근거는 공시 상세에서 확인할게요.`
        : `${results.length}개 업체를 찾았습니다: ${results.map((vendor) => `${vendor.name}(${vendor.priceRange})`).join(", ")}`
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
    toolOutput: { vendorName: vendor.name, slots: availableSlots, count: availableSlots.length },
    success: true,
    displayMessage: availableSlots.length > 0
      ? `${vendor.name}의 예약 가능 시간 ${availableSlots.length}개: ${availableSlots.slice(0, 5).map((slot) => `${slot.dateTimeLabel}(잔여${slot.remaining}석)`).join(", ")}${availableSlots.length > 5 ? " ..." : ""}`
      : `${vendor.name}은(는) 현재 예약 가능한 시간이 없습니다.`,
  };
}

export async function executeRecommendVendors(
  input: Record<string, unknown>,
  ctx: VendorToolExecutionContext
): Promise<ToolExecutionResult> {
  const admin = getAdminClient();
  const category = typeof input.category === "string" ? input.category.trim() : "";
  const limit = boundedToolLimit(input.limit, 3, MAX_LEGACY_VENDOR_SEARCH_RESULTS);
  const officialCategory = resolveOfficialRecommendationCategory(category);
  const dbCat = officialCategory
    ? officialCategoryDbName(officialCategory)
    : VENDOR_CATEGORY_MAP[category] || category;
  const mood = input.mood as string | undefined;
  const preferredDay = input.preferred_day as number | undefined;
  const preferredTime = input.preferred_time as string | undefined;
  const location = input.location as string | undefined;

  const categoryProgress = ctx.weddingContext.progress[dbCat];
  const categoryBudget = (categoryProgress as Record<string, unknown>)?.budget as number | undefined;
  const validStoredCategoryBudget = [categoryBudget].find(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
  );
  const requestedCategoryBudget = input.price_max !== undefined
    ? input.price_max
    : validStoredCategoryBudget;
  const explicitCategoryBudget = typeof requestedCategoryBudget === "number"
    && Number.isFinite(requestedCategoryBudget)
    && requestedCategoryBudget > 0
    ? requestedCategoryBudget
    : undefined;

  if (officialCategory) {
    const regionCodes = recommendationRegions(location);
    if (typeof location === "string" && location.trim().length > 0 && regionCodes.length === 0) {
      return {
        toolName: "recommend_vendors",
        toolInput: input,
        toolOutput: {
          recommendationPolicy: "official_price_explainable_v1",
          dataStatus: "clarification_required",
          error: "unrecognized_recommendation_location",
        },
        success: false,
        displayMessage: "말씀하신 지역 범위를 정확히 확인하고 싶어요. 시·도(예: 부산, 대구, 경기)나 동네 이름으로 한 번만 알려주세요.",
      };
    }
    const parsedRequest = parseVendorRecommendationRequest({
      category: officialCategory,
      region_codes: regionCodes,
      ...(requestedCategoryBudget !== undefined
        ? { budget_max_krw: requestedCategoryBudget }
        : {}),
      preferred_tags: recommendationTags(input),
      required_attrs: plainRecord(input.required_attrs),
      ...(typeof input.wedding_month === "string"
        ? { wedding_month: input.wedding_month }
        : {}),
      limit: Math.min(20, Math.max(1, Number.isInteger(limit) ? limit : 3)),
    });
    if (!parsedRequest.success) {
      return {
        toolName: "recommend_vendors",
        toolInput: input,
        toolOutput: { error: "invalid_official_recommendation_filters" },
        success: false,
        displayMessage: "추천 조건 중 확인이 필요한 항목이 있어요. 원하는 조건을 한 번만 더 구체적으로 알려주세요.",
      };
    }

    try {
      // v_public_vendor_enrichment는 vendor_enrichment_url_is_allowed()를 거치는데
      // 그 함수 EXECUTE가 anon·authenticated에만 부여돼 service_role은 42501로
      // 거부된다(20260718130000). 공개 카탈로그이므로 공개 클라이언트로 읽는다
      // — 최소 권한에도 맞고, 이 때문에 추천이 전 사용자에게 실패하고 있었다.
      const officialCandidates = await loadRecommendationCandidates(
        createPublicClient(),
        officialCategory,
      );
      {
        const recommendation = rankVendorRecommendations(
          parsedRequest.data,
          officialCandidates,
        );
        try {
          const logged = await logRecommendationImpressions(
            admin,
            parsedRequest.data,
            recommendation,
          );
          if (!logged) console.warn("Amora vendor recommendation impression logging failed");
        } catch {
          console.warn("Amora vendor recommendation impression logging failed");
        }

        const vendors = recommendation.results.map((result) => {
          const sourceCandidate = officialCandidates.find(
            (candidate) => candidate.id === result.vendor.id,
          );
          return {
            id: result.vendor.id,
            slug: result.vendor.slug,
            name: result.vendor.name,
            category: result.vendor.category,
            regionCode: result.vendor.region_code,
            location: result.vendor.region_code
              ? RECOMMENDATION_REGION_CODE_LABELS[result.vendor.region_code]
                ?? result.vendor.region_code
              : null,
            priceRange: recommendationPriceRange(
              result.price_summary.min_krw,
              result.price_summary.max_krw,
            ),
            rating: null,
            reviewCount: null,
            tags: sourceCandidate?.tags.map(({ label }) => label) ?? [],
            score: result.score,
            reasons: result.match_reasons,
            priceSummary: result.price_summary,
            dataBadges: result.data_badges,
            link: result.detail_url,
          };
        });
        return {
          toolName: "recommend_vendors",
          toolInput: input,
          toolOutput: {
            recommendationPolicy: "official_price_explainable_v1",
            dataStatus: "available",
            vendors,
            count: vendors.length,
            ...(parsedRequest.data.budget_max_krw !== undefined
              ? { estimatedBudget: parsedRequest.data.budget_max_krw }
              : {}),
            coverageNote: recommendation.coverage_note,
            disclaimer: recommendation.disclaimer,
          },
          success: true,
          displayMessage: vendors.length > 0
            ? `공시 가격과 확인된 조건을 기준으로 ${vendors.length}곳을 찾았어요.\n${vendors.map((vendor, index) => `${index + 1}. ${vendor.name} — ${vendor.reasons.join(", ")}`).join("\n")}\n${recommendation.disclaimer}`
            : `공시 가격과 확인된 조건을 모두 만족하는 업체를 아직 찾지 못했어요. 원하시면 지역·예산·필수 조건 중 하나를 넓혀 다시 확인할 수 있어요. ${recommendation.disclaimer}`,
        };
      }
    } catch {
      console.warn("Official vendor recommendation data unavailable");
      return {
        toolName: "recommend_vendors",
        toolInput: input,
        toolOutput: {
          recommendationPolicy: "official_price_explainable_v1",
          dataStatus: "unavailable",
          error: "official_recommendation_unavailable",
        },
        success: false,
        displayMessage: "공식 업체 정보를 불러오지 못했어요. 확인되지 않은 업체로 대신 추천하지 않고, 잠시 뒤 다시 확인해드릴게요.",
      };
    }
  }

  let viewedVendorIds: string[] = [];
  const actorId = await resolveBoundActorId(admin, ctx);
  if (actorId) {
    const { data: viewed } = await admin
      .from("customer_events")
      .select("vendor_id")
      .eq("user_id", actorId)
      .eq("event_type", "vendor_view")
      .not("vendor_id", "is", null)
      .limit(50);
    viewedVendorIds = (viewed ?? []).map((viewedVendor) => viewedVendor.vendor_id).filter(Boolean);
  }

  let query = admin
    .from("vendors")
    .select("id, name, category, location, region, price_range, price_min, price_max, rating, review_count, tags, ai_recommend, description")
    .eq("status", "approved")
    .eq("category", dbCat)
    .order("rating", { ascending: false })
    .limit((limit + viewedVendorIds.length) * 2);

  if (explicitCategoryBudget !== undefined) {
    query = query.lte("price_min", Math.round(explicitCategoryBudget * 1.3));
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
    if (explicitCategoryBudget !== undefined && vendor.price_min <= explicitCategoryBudget) {
      reasons.push("예산 범위 내");
    }
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
      ...(explicitCategoryBudget !== undefined
        ? { estimatedBudget: explicitCategoryBudget }
        : {}),
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

  let officialProfile: Awaited<ReturnType<typeof loadVendorProfile>>;
  try {
    officialProfile = await loadVendorProfile(admin, vendorId);
  } catch {
    console.warn("Official vendor profile data unavailable");
    return {
      toolName: "get_vendor_detail",
      toolInput: input,
      toolOutput: {
        profilePolicy: "official_disclosure_profile_v1",
        dataStatus: "unavailable",
        error: "official_vendor_profile_unavailable",
      },
      success: false,
      displayMessage: "공식 업체 상세 정보를 불러오지 못했어요. 확인되지 않은 정보로 대신 채우지 않고 잠시 뒤 다시 확인해드릴게요.",
    };
  }

  if (officialProfile) {
    let bookingDataStatus: "available" | "unavailable" = "available";
    let productList: Array<{
      id: string;
      name: string;
      description: string;
      price: number;
      discountPrice: number | null;
      duration: number | null;
      isPopular: boolean;
      includes: string[];
    }> = [];
    let staffList: Array<{
      id: string;
      name: string;
      role: string | null;
      description: string;
    }> = [];
    try {
      const [productResult, staffResult] = await Promise.all([
        admin
          .from("vendor_products")
          .select("id, name, description, price, discount_price, duration_minutes, is_popular, includes")
          .eq("vendor_id", vendorId)
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true })
          .limit(MAX_VENDOR_PRODUCTS),
        admin
          .from("vendor_staff")
          .select("id, name, role, description")
          .eq("vendor_id", vendorId)
          .eq("is_active", true)
          .not("public_profile_consent_at", "is", null)
          .eq(
            "public_profile_consent_version",
            CURRENT_VENDOR_STAFF_PUBLICATION_CONSENT_VERSION,
          )
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true })
          .limit(MAX_VENDOR_STAFF),
      ]);
      if (productResult.error || staffResult.error) {
        throw new Error("AUXILIARY_BOOKING_DATA_UNAVAILABLE");
      }
      productList = (productResult.data ?? []).map((product) => ({
        id: product.id,
        name: boundedToolText(product.name, 160),
        description: boundedToolText(product.description, 80),
        price: product.price,
        discountPrice: product.discount_price ?? null,
        duration: product.duration_minutes ?? null,
        isPopular: product.is_popular ?? false,
        includes: boundedToolTextList(
          product.includes,
          MAX_VENDOR_PRODUCT_INCLUDES,
          120,
        ),
      }));
      staffList = (staffResult.data ?? []).map((staffMember) => ({
        id: staffMember.id,
        name: boundedToolText(staffMember.name, 160),
        role: boundedNullableToolText(staffMember.role, 120),
        description: boundedToolText(staffMember.description, 60),
      }));
    } catch {
      bookingDataStatus = "unavailable";
      console.warn("Auxiliary vendor booking data unavailable");
    }
    const toolOfficialProfile = boundedVendorProfileForTool(officialProfile);
    const vendor = toolOfficialProfile.vendor;
    return {
      toolName: "get_vendor_detail",
      toolInput: input,
      toolOutput: {
        profilePolicy: "official_disclosure_profile_v1",
        dataStatus: "available",
        vendorId: vendor.id,
        vendorName: vendor.name,
        category: vendor.category,
        location: vendor.region_code
          ? RECOMMENDATION_REGION_CODE_LABELS[vendor.region_code] ?? vendor.region_code
          : null,
        profileLink: `/price/vendor/${encodeURIComponent(vendor.slug)}`,
        officialProfile: toolOfficialProfile,
        bookingData: {
          policy: "legacy_booking_auxiliary_v1",
          dataStatus: bookingDataStatus,
          auxiliary: true,
          notice: bookingDataStatus === "available"
            ? "예약용 등록 정보이며 공시 가격의 근거 또는 추천 순위로 사용하지 않습니다."
            : "공시 상세는 정상적으로 확인했지만 예약 보조 정보는 현재 불러오지 못했어요.",
          products: productList,
          staff: staffList,
        },
      },
      success: true,
      displayMessage: bookingDataStatus === "available"
        ? `${vendor.name}의 공시 가격 ${officialProfile.official_prices.length}건과 예약 보조 상품 ${productList.length}개를 확인했어요.`
        : `${vendor.name}의 공시 가격 ${officialProfile.official_prices.length}건을 확인했어요. 예약 보조 정보는 현재 불러오지 못했어요.`,
    };
  }

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
  if (resolveOfficialRecommendationCategory(vendor.category)) {
    return {
      toolName: "get_vendor_detail",
      toolInput: input,
      toolOutput: {
        profilePolicy: "official_disclosure_profile_v1",
        dataStatus: "unavailable",
        error: "official_vendor_profile_not_available",
      },
      success: false,
      displayMessage: "이 업체의 공시 상세가 아직 준비되지 않았어요. 기존 등록 정보로 대신 채우지 않고, 확인 가능한 공시가 준비되면 보여드릴게요.",
    };
  }

  const { data: products } = await admin
    .from("vendor_products")
    .select("id, name, description, price, discount_price, duration_minutes, is_popular, includes")
    .eq("vendor_id", vendorId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true })
    .limit(MAX_VENDOR_PRODUCTS);

  const { data: staff } = await admin
    .from("vendor_staff")
    .select("id, name, role, description")
    .eq("vendor_id", vendorId)
    .eq("is_active", true)
    .not("public_profile_consent_at", "is", null)
    .eq(
      "public_profile_consent_version",
      CURRENT_VENDOR_STAFF_PUBLICATION_CONSENT_VERSION,
    )
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true })
    .limit(MAX_VENDOR_STAFF);

  const productList = (products ?? []).map((product) => ({
    id: product.id,
    name: boundedToolText(product.name, 160),
    description: boundedToolText(product.description, 80),
    price: product.price,
    discountPrice: product.discount_price ?? null,
    duration: product.duration_minutes ?? null,
    isPopular: product.is_popular ?? false,
    includes: boundedToolTextList(
      product.includes,
      MAX_VENDOR_PRODUCT_INCLUDES,
      120,
    ),
  }));

  const staffList = (staff ?? []).map((staffMember) => ({
    id: staffMember.id,
    name: boundedToolText(staffMember.name, 160),
    role: boundedNullableToolText(staffMember.role, 120),
    description: boundedToolText(staffMember.description, 60),
  }));

  const vendorName = boundedToolText(vendor.name, 200);

  return {
    toolName: "get_vendor_detail",
    toolInput: input,
    toolOutput: {
      profilePolicy: "legacy_unsupported_category_v1",
      dataStatus: "auxiliary_only",
      legacyDataNotice: "현재 공시 프로필 지원 밖의 카테고리에서 제공하는 예약 보조 등록 정보입니다.",
      vendorId: vendor.id,
      vendorName,
      category: boundedToolText(vendor.category, 80),
      location: boundedNullableToolText(vendor.location, 160),
      priceRange: boundedNullableToolText(vendor.price_range, 160),
      products: productList,
      staff: staffList,
    },
    success: true,
    displayMessage: `${vendorName}의 상품 ${productList.length}개, 스태프 ${staffList.length}명`,
  };
}
