import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolExecutionResult } from "@/types/database.types";
import { disclosureRoundLabel, displaySourceLabel } from "@/lib/price/period";
import { priceRegionLabel } from "@/lib/price/labels";
import { MARKET_PRICE_CATEGORY_KEYS } from "@/lib/ai/marketPriceRequestScope";
import {
  analyzeAmoraQuoteCheck,
  getQuoteCheckItems,
  type AmoraQuoteCategory,
  type AmoraQuoteRegion,
} from "@/lib/amora/quoteCheck";

/**
 * 공시가 통계를 돌려주는 카테고리. `v_public_official_prices.price_category` 실측값이다
 * (2026-08-22: hall 1081 · studio 718 · dress 525 · makeup 285). 여기 없는 항목은
 * 공시 자료가 없으므로 통계를 만들지 않는다 — 없는 표본에서 평균을 내면 그게 곧
 * 지어낸 수치다.
 */
const MARKET_PRICE_CATEGORIES = new Set<string>(MARKET_PRICE_CATEGORY_KEYS);

const MARKET_PRICE_SOURCE_FALLBACK = "한국소비자원 참가격";
const MARKET_PRICE_ROW_LIMIT = 2_000;

/**
 * 결혼식장 공시는 한 카테고리 안에 **성격이 다른 네 가지**가 섞여 있다
 * (2026-08-22 실측: 식대 326 · 옵션 325 · 대관료 318 · 장식비 112).
 * 식대는 1인당 금액이라 5만~7만 원대이고 대관료는 건당이라 수백만 원대다.
 *
 * 이걸 한 덩어리로 중위값을 내면 "웨딩홀 대관료 중위가 105만 원, 범위 3만 5천 원~
 * 6,600만 원" 같은 숫자가 나온다 — 실제로 라이브에서 그렇게 나왔다. 출처가 붙어
 * 있어도 **뜻이 틀린 숫자**이고, 그건 지어낸 숫자보다 나을 것이 없다.
 *
 * `item_name` 은 `<홀이름> <항목>` 형태라 마지막 낱말이 항목이다.
 */
const HALL_ITEM_TYPES = ["대관료", "식대", "옵션", "장식비"] as const;
type HallItemType = (typeof HALL_ITEM_TYPES)[number];

/** 1인당으로 공시되는 항목. 건당 금액과 나란히 두면 사용자가 오해한다. */
const PER_PERSON_HALL_ITEM_TYPES = new Set<HallItemType>(["식대"]);

function hallItemTypeOf(itemName: unknown): HallItemType | null {
  if (typeof itemName !== "string") return null;
  const last = itemName.trim().split(/\s+/).pop() ?? "";
  return (HALL_ITEM_TYPES as readonly string[]).includes(last)
    ? (last as HallItemType)
    : null;
}

interface PriceStats {
  sampleCount: number;
  minKrw: number;
  medianKrw: number;
  maxKrw: number;
}

/**
 * 공시 한 행은 금액 구간(min~max)으로 온다. 구간의 중점을 그 행의 대표값으로 쓴다.
 * 값이 없는 행(0 또는 결측)은 표본에서 뺀다 — 0을 최솟값으로 두면 "최소 0원"이라는
 * 거짓이 나온다.
 */
function midpointOf(row: Record<string, unknown>): number | null {
  const usable = [Number(row.price_min_krw), Number(row.price_max_krw)]
    .filter((value) => Number.isFinite(value) && value > 0);
  if (usable.length === 0) return null;
  return Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length);
}

function statsOf(midpoints: number[]): PriceStats | null {
  if (midpoints.length === 0) return null;
  return {
    sampleCount: midpoints.length,
    minKrw: Math.min(...midpoints),
    medianKrw: median(midpoints),
    maxKrw: Math.max(...midpoints),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function formatKrw(value: number): string {
  if (value >= 10_000 && value % 10_000 === 0) {
    return `${(value / 10_000).toLocaleString("ko-KR")}만원`;
  }
  return `${value.toLocaleString("ko-KR")}원`;
}

/**
 * 검수·공시된 결혼서비스 가격의 **카테고리 통계**를 돌려준다.
 *
 * 2026-08-22 이전에는 이 실행기가 데이터를 한 줄도 읽지 않고 "과거 고정 시세표는
 * 종료했어요" 라는 고정 문구만 돌려줬다. 마이그레이션 뒤 재배선이 안 된 것인데,
 * 도구 설명문은 계속 모델에게 "한국소비자원 참가격 통계를 조회합니다" 라고 말하고
 * 있었다. 그 결과 아모라는 "웨딩홀 대관료 평균 알려줘" 에 **알 수 있는 것을
 * 모른다고** 답했다(스테이징 실측).
 *
 * 업체 이름·식별자는 돌려주지 않는다. 이것은 통계이지 업체 추천이 아니다 —
 * 업체 추천·예약은 별도의 보류 대상이고 그 경계를 이 도구가 넘지 않는다.
 * 수치와 함께 **출처와 기준 시점을 항상** 돌려준다. 근거 없는 숫자는 아모라가
 * 지어낸 것과 구별되지 않는다.
 */
export async function executeGetMarketPrice(
  input: Record<string, unknown>,
  client: SupabaseClient,
): Promise<ToolExecutionResult> {
  const category = typeof input.category === "string" ? input.category.trim() : "";
  const region = typeof input.region === "string" ? input.region.trim() : "";

  if (!MARKET_PRICE_CATEGORIES.has(category)) {
    return {
      toolName: "get_market_price",
      toolInput: input,
      toolOutput: {
        error: "unsupported_category",
        supportedCategories: [...MARKET_PRICE_CATEGORIES],
      },
      success: false,
      displayMessage:
        "공시가 통계는 결혼식장·스튜디오·드레스·메이크업만 있어요. 어느 항목을 볼까요?",
    };
  }

  const requestedItemType = typeof input.itemType === "string" ? input.itemType.trim() : "";
  const itemType = category === "hall"
      && (HALL_ITEM_TYPES as readonly string[]).includes(requestedItemType)
    ? (requestedItemType as HallItemType)
    : null;

  // **`.limit()` 만으로는 전부 오지 않는다.**
  //
  // PostgREST 는 서버 쪽 상한(1,000행)에서 자른다 — `.limit(2000)` 을 줘도
  // 2026-08-26 운영 실측으로 `content-range: 0-999/1081` 이 돌아온다. 즉 예식장은
  // **1,081건 중 1,000건**만 보고 min/median/max 를 냈고, 잘린 81건은 아무 데도
  // 나타나지 않았다. 정렬이 무작위가 아니므로 중간값이 한쪽으로 밀린다.
  //
  // 이 파일의 첫 원칙이 "없는 표본에서 평균을 내면 그게 곧 지어낸 수치다" 인데,
  // **일부 표본에서 낸 중간값도 같은 종류다.** 페이지를 끝까지 넘겨 모으고,
  // 그래도 다 못 모으면 통계를 내지 않는다.
  const buildQuery = () => {
    let q = client
      .from("v_public_official_prices")
      .select("price_min_krw,price_max_krw,source_label,region_code,item_name")
      .eq("is_current", true)
      .eq("price_category", category);
    if (region === "seoul") q = q.in("region_code", ["seoul_gangnam3", "seoul_etc"]);
    else if (region) q = q.eq("region_code", region);
    return q;
  };

  const PAGE = 1_000;
  const collected: Record<string, unknown>[] = [];
  let error: { message?: string } | null = null;
  let truncated = false;
  for (let from = 0; from < MARKET_PRICE_ROW_LIMIT; from += PAGE) {
    const page = await buildQuery().range(from, from + PAGE - 1);
    if (page.error) { error = page.error; break; }
    const rows = Array.isArray(page.data) ? page.data : [];
    collected.push(...(rows as Record<string, unknown>[]));
    if (rows.length < PAGE) break;
    // 상한까지 채웠는데 더 남았을 수 있다 — 그 경우는 아래에서 통계를 내지 않는다.
    if (from + PAGE >= MARKET_PRICE_ROW_LIMIT) truncated = true;
  }
  const data = collected;
  if (error) {
    return {
      toolName: "get_market_price",
      toolInput: input,
      toolOutput: { error: "price_lookup_failed" },
      success: false,
      displayMessage: "공시가를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.",
    };
  }

  // 다 못 모았으면 통계를 내지 않는다 — 일부 표본의 중간값은 지어낸 수치와 같다.
  const rows = truncated ? [] : data;
  const first = rows[0];
  // DB 의 `source_label`·`period_label` 을 그대로 말하면 **우리 내부 스냅샷
  // 이름을 공시 시점이라고 주장하게 된다.** 운영 실측: 두 값 모두 `2026Q3` 인데
  // 실제 공시 라운드는 2025-11 이다. 소비자 화면은 이미 이 보정을 거치는데
  // (`/price`, 업체 상세) 아모라만 안 거쳐서, **같은 자료를 화면은 "2025년 11월",
  // 아모라는 "2026년 3분기"라고 말하고 있었다** — 9개월 된 가격이 현재 분기로
  // 보인다. 근거를 대는 자리라 더 나쁘다.
  const source = typeof first?.source_label === "string" && first.source_label
    ? displaySourceLabel(first.source_label)
    : MARKET_PRICE_SOURCE_FALLBACK;
  const period = disclosureRoundLabel();
  const base = { category, region: region || null, source, period, publicPath: "/price" };

  // **잰 범위를 수치와 같은 문장에 넣는다.** 2026-08-26 운영 실측: 지역을 말하지 않고
  // "대관료는 보통 얼마야?" 라고 묻자 아모라가 `seoul_gangnam3` 으로 조회해
  // 대관료 중위 770만·식대 1인 11.5만을 답했다(각각 n=41·43 — 강남권 부분집합과
  // 정확히 일치). 200명 기준 식대만 **전국 1,280만 vs 강남 2,300만**이라 1,000만원
  // 넘게 어긋난다. 문장은 "보통 얼마"에 대한 답처럼 읽혔다.
  //
  // 좁히는 것 자체는 막지 않는다 — 예식장이 강남이면 강남값이 더 맞다. 막는 것은
  // **좁힌 사실이 문장에서 빠지는 것**이다. `toolOutput.region` 은 예전에도 있었지만
  // 모델이 그걸 옮겨 적어야만 사용자에게 닿았고, 실제로는 옮겨 적지 않았다.
  const scope = region === "seoul" ? "서울 전체(강남·서초·송파 및 그 외 서울)"
    : region ? priceRegionLabel(region) : "전국";

  const emptyResult: ToolExecutionResult = {
    toolName: "get_market_price",
    toolInput: input,
    toolOutput: {
      ...base,
      source: MARKET_PRICE_SOURCE_FALLBACK,
      sampleCount: 0,
      minKrw: null,
      medianKrw: null,
      maxKrw: null,
    },
    success: true,
    // 없을 때도 출처는 밝힌다. 어디를 찾아봤는지 알아야 사용자가 다음을 정한다.
    displayMessage:
      `${MARKET_PRICE_SOURCE_FALLBACK} ${scope} 공시가에는 해당 조건의 금액이 없어요. 금액을 임의로 말씀드리지 않을게요.`,
  };

  // 결혼식장인데 항목을 고르지 않았으면 **섞지 않고 유형별로 나눠서** 준다.
  // 단일 중위값을 함께 주면 모델이 그걸 집어 쓰므로 아예 넣지 않는다.
  if (category === "hall" && !itemType) {
    const buckets = new Map<HallItemType, number[]>();
    for (const row of rows) {
      const type = hallItemTypeOf(row.item_name);
      const midpoint = midpointOf(row);
      if (!type || midpoint === null) continue;
      buckets.set(type, [...(buckets.get(type) ?? []), midpoint]);
    }
    const breakdown = HALL_ITEM_TYPES
      .map((type) => ({ itemType: type, stats: statsOf(buckets.get(type) ?? []) }))
      .filter((entry): entry is { itemType: HallItemType; stats: PriceStats } => entry.stats !== null)
      .map((entry) => ({
        itemType: entry.itemType,
        perPerson: PER_PERSON_HALL_ITEM_TYPES.has(entry.itemType),
        ...entry.stats,
      }));
    if (breakdown.length === 0) return emptyResult;

    return {
      toolName: "get_market_price",
      toolInput: input,
      toolOutput: { ...base, breakdown },
      success: true,
      displayMessage:
        `${source} 기준 ${scope} 결혼식장 공시가입니다. 항목마다 단위가 달라 따로 봅니다 — `
        + breakdown
          .map((entry) => (
            `${entry.itemType}${entry.perPerson ? "(1인)" : ""} 중간값 `
            + `${formatKrw(entry.medianKrw)} (${entry.sampleCount}건)`
          ))
          .join(", ")
        + ". 개별 업체 금액은 업체 공시가에서 출처와 기준 시점을 함께 확인해 주세요.",
    };
  }

  const midpoints: number[] = [];
  for (const row of rows) {
    if (itemType && hallItemTypeOf(row.item_name) !== itemType) continue;
    const midpoint = midpointOf(row);
    if (midpoint !== null) midpoints.push(midpoint);
  }

  const stats = statsOf(midpoints);
  if (!stats) return emptyResult;

  const perPerson = itemType !== null && PER_PERSON_HALL_ITEM_TYPES.has(itemType);
  const label = itemType ? `${itemType}${perPerson ? "(1인 기준)" : ""}` : null;

  return {
    toolName: "get_market_price",
    toolInput: input,
    toolOutput: {
      ...base,
      ...(itemType ? { itemType, perPerson } : {}),
      ...stats,
    },
    success: true,
    displayMessage:
      `${source} 기준 ${scope} ${label ? `${label} ` : ""}공시가 ${stats.sampleCount}건: `
      + `중간값 ${formatKrw(stats.medianKrw)}`
      + ` (최소 ${formatKrw(stats.minKrw)} ~ 최대 ${formatKrw(stats.maxKrw)}).`
      + " 개별 업체 금액은 업체 공시가에서 출처와 기준 시점을 함께 확인해 주세요.",
  };
}

/** 모델에 가는 견적 확인 결과의 출처 안내. 공시가 화면(/price)을 가리키지 않는다(2026-11-16, D-79). */
const AMORA_QUOTE_CHECK_SOURCE_NOTE =
  "이 결과는 사용자가 ‘포함’, ‘이용 계획 없음’, ‘확인 필요’로 고른 상태만 정리하며 가격의 적정성을 판정하지 않습니다. 시세 자료는 없으니 실제 금액과 추가 비용은 업체의 서면 견적으로 확인하세요.";

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

export function executeAnalyzeQuoteWithTrustEngine(input: Record<string, unknown>): ToolExecutionResult {
  const quotePrice = Number(input.quote_price ?? 0);
  const category = parseQuoteCategory(input.category);
  const region = parseQuoteRegion(input.region);
  const vendorName = typeof input.vendor_name === "string" ? input.vendor_name : "";
  const includedItems = Array.isArray(input.included_items)
    ? input.included_items.map((item) => String(item)).filter(Boolean)
    : [];
  const notNeededItems = Array.isArray(input.not_needed_items)
    ? input.not_needed_items.map((item) => String(item)).filter(Boolean)
    : [];
  const checklistConfirmed = input.checklist_confirmed === true;

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
  if (!checklistConfirmed && includedItems.length === 0 && notNeededItems.length === 0) {
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
          checkQuestion: item.checkQuestion,
        })),
      },
      success: true,
      displayMessage: "견적 포함 항목을 먼저 확인해주세요.",
    };
  }

  const includedItemIds = resolveIncludedQuoteItemIds(category, region, includedItems);
  const notNeededItemIds = resolveIncludedQuoteItemIds(category, region, notNeededItems);
  const analysis = analyzeAmoraQuoteCheck({
    category,
    region,
    quotePriceManwon: quotePrice,
    includedItemIds,
    notNeededItemIds,
    vendorName,
  });

  // 2026-11-16 파운더 결정(D-79): 참가격 자료를 쓰지 않는다. 이 출력은 모델에 그대로 간다
  // (`getModelSafeToolOutput` 이 거르지 않는다). 그래서 늘 0 이던 시세 비교 칸(marketMedian·
  // priceDiff·priceDiffPercent)과 "업체별 최신 공시가 확인 필요" 꼬리표를 빼고, 출처 안내도
  // 내리는 공시가 화면 대신 업체 서면 견적을 가리키게 바꿨다. 화면 카드는 이 칸들을 읽지 않는다.
  // 공유 분석기(`lib/amora/quoteCheck.ts`)의 문구는 커뮤니티 견적 확인 화면과 함께 2단계에서 고친다.
  const output = {
    quotePrice: analysis.quotePriceManwon,
    category: analysis.category,
    region: analysis.scope,
    vendorName,
    dataSource: AMORA_QUOTE_CHECK_SOURCE_NOTE,
    missingItems: analysis.missingItems.map((item) => ({
      name: item.name,
      category: item.category,
      severity: item.severity,
      reason: item.reason,
      checkQuestion: item.checkQuestion,
      disguise: item.disguise,
    })),
    includedItems: analysis.includedItems.map((item) => ({
      name: item.name,
      category: item.category,
      severity: item.severity,
    })),
    notNeededItems: analysis.notNeededItems.map((item) => ({
      name: item.name,
      category: item.category,
      severity: item.severity,
    })),
    missingCriticalCount: analysis.missingCriticalCount,
    missingHighCount: analysis.missingHighCount,
    missingMediumCount: analysis.missingMediumCount,
    summaryTitle: analysis.summaryTitle,
    summaryText: analysis.summaryText,
    recommendedAction: analysis.recommendedAction,
    contractQuestions: analysis.contractQuestions,
    negotiationScript: analysis.negotiationScript,
    statsNote: AMORA_QUOTE_CHECK_SOURCE_NOTE,
  };

  return {
    toolName: "analyze_quote",
    toolInput: input,
    toolOutput: output,
    success: true,
    displayMessage:
      analysis.missingCriticalCount + analysis.missingHighCount + analysis.missingMediumCount > 0
        ? `견적 체크 완료: 확인 필요 ${analysis.missingCriticalCount + analysis.missingHighCount + analysis.missingMediumCount}개를 정리했어요`
        : "견적 체크 완료: 모든 항목의 상태를 정리했어요",
  };
}
