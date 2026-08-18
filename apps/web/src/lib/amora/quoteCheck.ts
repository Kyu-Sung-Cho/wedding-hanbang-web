import { HIDDEN_COSTS, type HiddenCostItem } from "@/constants/hiddenCosts";
import {
  comparableOffers,
  type PriceCatalog,
  type PriceCategory,
} from "@/lib/price/catalog";
import {
  DISCLOSURE_REFERENCE_ID,
  DISCLOSURE_SOURCE_URL,
  DISCLOSURE_SOURCE_CHECKED_AT,
  disclosureRoundLabel,
} from "@/lib/price/period";
import {
  buildAmoraOfficialReferenceScope,
  parseAmoraOfficialReferenceScope,
  type AmoraOfficialReferenceRegionScope,
  type AmoraOfficialReferenceScope,
} from "@hanbang/shared/amora-official-reference-scope";

export type AmoraQuoteCategory = "sdm_package" | "studio" | "dress" | "makeup";
export type AmoraQuoteRegion = "seoul" | "gyeonggi" | "busan" | "daegu" | "other";
export type AmoraQuoteScope = "national" | "seoul";

// 원칙: 이 엔진은 "판정"하지 않는다.
// 점수·등급·안전/위험·가격대 분류는 견적 구성을 모르는 채로는 정확할 수 없고,
// 틀린 판정 한 번이 신뢰를 끝낸다(+ 표시광고 리스크). 남기는 것은 사실뿐이다:
//   ① 견적서에서 확인된/안 된 항목 (사용자 입력 기반)
//   ② 사용자가 입력한 견적 금액(가격 적정성 판정에는 사용하지 않음)
//   ③ 계약 전 확인 질문 (절차 — 항상 유효)

export interface AmoraQuoteCheckInput {
  category: AmoraQuoteCategory;
  region: AmoraQuoteRegion;
  quotePriceManwon: number;
  includedItemIds: string[];
  notNeededItemIds?: string[];
  vendorName?: string;
  memo?: string;
}

export interface AmoraQuoteCheckItem {
  id: string;
  name: string;
  category: HiddenCostItem["category"];
  severity: HiddenCostItem["severity"];
  checkQuestion: string;
  reason: string;
  disguise: string;
}

export interface AmoraQuoteCheckResult {
  category: AmoraQuoteCategory;
  scope: AmoraQuoteScope;
  quotePriceManwon: number;
  marketMedianManwon: number;
  /** 어떤 기준가와 비교했는지 — UI에 그대로 표기 (예: "경기/인천 스드메 패키지 중위가") */
  marketComparatorLabel: string;
  /** 기준 중위가 대비 % — 참고 표시 전용, 판정 근거로 쓰지 않는다 */
  priceDiffPercent: number;
  marketEvidence: AmoraMarketPriceEvidence;
  checkedItemCount: number;
  notNeededItemCount: number;
  missingCriticalCount: number;
  missingHighCount: number;
  missingMediumCount: number;
  includedItems: AmoraQuoteCheckItem[];
  notNeededItems: AmoraQuoteCheckItem[];
  missingItems: AmoraQuoteCheckItem[];
  summaryTitle: string;
  summaryText: string;
  recommendedAction: string;
  contractQuestions: string[];
  negotiationScript: string;
  sourceNote: string;
}

export type AmoraMarketPriceEvidence = {
  status: "available" | "unavailable";
  observationCount: number;
  vendorCount: number;
  source: "한국소비자원 참가격";
  sourceUrl: string;
  sourcePeriod: string;
  categoryLabel: string;
  regionLabel: string;
  calculation: string;
  comparisonBasis: string;
  limitation: string;
  officialReference: Readonly<AmoraOfficialReferenceScope> | null;
  unavailableReason?:
    | "catalog_not_loaded"
    | "category_not_comparable"
    | "insufficient_sample"
    | "reference_scope_invalid";
};

export type AmoraMarketPriceBenchmark = {
  medianManwon: number;
  comparatorLabel: string;
  evidence: AmoraMarketPriceEvidence;
};

export type AmoraAvailableMarketPriceReference = {
  medianManwon: number;
  comparatorLabel: string;
  observationCount: number;
  vendorCount: number;
  sourcePeriod: string;
  calculation: string;
  comparisonBasis: string;
  limitation: string;
  officialReference: Readonly<AmoraOfficialReferenceScope>;
};

export const AMORA_QUOTE_CATEGORY_LABELS: Record<AmoraQuoteCategory, string> = {
  sdm_package: "사진 촬영·드레스·메이크업 묶음 견적",
  studio: "사진 촬영",
  dress: "웨딩드레스",
  makeup: "헤어·메이크업",
};

export const AMORA_QUOTE_REGION_LABELS: Record<AmoraQuoteRegion, string> = {
  seoul: "서울",
  gyeonggi: "경기/인천",
  busan: "부산",
  daegu: "대구",
  other: "기타 지역",
};

const CATEGORY_RELEVANT_COSTS: Record<AmoraQuoteCategory, HiddenCostItem["category"][]> = {
  sdm_package: ["studio", "dress", "makeup"],
  studio: ["studio"],
  dress: ["dress"],
  makeup: ["makeup"],
};

// 묶음 견적과 직접 관계가 없거나 다른 항목과 사실상 중복인 과거 초안은 노출하지 않는다.
const EXCLUDED_CHECKLIST_ITEM_IDS = new Set([
  "dress_mini",
  "makeup_nail",
  "makeup_corsage",
]);

const MARKET_COMPARISON_BASIS =
  "공시 행의 price_min_krw만 사용하며 기본 구성·옵션·부가세 조건을 합산하거나 보정하지 않음";
const MARKET_AVAILABLE_LIMITATION =
  "공시 기본가 하한의 참고 중간값이며 옵션·계약 조건·시점에 따른 실제 결제액과 견적 적정성을 뜻하지 않습니다.";
const AVAILABLE_MARKET_REFERENCE_INPUT_KEYS = Object.freeze([
  "category",
  "marketMedianManwon",
  "marketComparatorLabel",
  "marketEvidence",
  "asOfDate",
]);
const AVAILABLE_MARKET_EVIDENCE_KEYS = Object.freeze([
  "status",
  "observationCount",
  "vendorCount",
  "source",
  "sourceUrl",
  "sourcePeriod",
  "categoryLabel",
  "regionLabel",
  "calculation",
  "comparisonBasis",
  "limitation",
  "officialReference",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

export function parseAmoraAvailableMarketPriceReference(
  input: unknown,
): Readonly<AmoraAvailableMarketPriceReference> | null {
  if (!isRecord(input) || !hasExactKeys(input, AVAILABLE_MARKET_REFERENCE_INPUT_KEYS)) {
    return null;
  }
  if (
    typeof input.category !== "string"
    || !Object.prototype.hasOwnProperty.call(AMORA_QUOTE_CATEGORY_LABELS, input.category)
    || input.category === "sdm_package"
    || !Number.isSafeInteger(input.marketMedianManwon)
    || (input.marketMedianManwon as number) <= 0
    || typeof input.marketComparatorLabel !== "string"
    || !isRecord(input.marketEvidence)
    || !hasExactKeys(input.marketEvidence, AVAILABLE_MARKET_EVIDENCE_KEYS)
  ) return null;

  const evidence = input.marketEvidence;
  const officialReference = parseAmoraOfficialReferenceScope(
    evidence.officialReference,
    input.asOfDate,
  );
  if (!officialReference || officialReference.applicabilityKey !== input.category) return null;

  const observationCount = evidence.observationCount;
  const vendorCount = evidence.vendorCount;
  if (
    evidence.status !== "available"
    || !Number.isSafeInteger(observationCount)
    || !Number.isSafeInteger(vendorCount)
    || (observationCount as number) < 3
    || (vendorCount as number) < 3
    || (vendorCount as number) > (observationCount as number)
  ) return null;

  const expectedComparator =
    `${officialReference.regionLabel} ${AMORA_QUOTE_CATEGORY_LABELS[input.category as AmoraQuoteCategory]} 공시 기본가 하한 중간값 (${observationCount as number}건)`;
  const expectedCalculation =
    `비교 가능한 업체·대행사별 공시 기본가 하한 ${observationCount as number}건의 중간값`;
  if (
    input.marketComparatorLabel !== expectedComparator
    || evidence.source !== officialReference.sourceName
    || evidence.sourceUrl !== officialReference.sourceUrl
    || evidence.sourcePeriod !== officialReference.sourcePeriodLabel
    || evidence.categoryLabel !== AMORA_QUOTE_CATEGORY_LABELS[input.category as AmoraQuoteCategory]
    || evidence.regionLabel !== officialReference.regionLabel
    || evidence.calculation !== expectedCalculation
    || evidence.comparisonBasis !== MARKET_COMPARISON_BASIS
    || evidence.limitation !== MARKET_AVAILABLE_LIMITATION
  ) return null;

  return Object.freeze({
    medianManwon: input.marketMedianManwon as number,
    comparatorLabel: input.marketComparatorLabel,
    observationCount: observationCount as number,
    vendorCount: vendorCount as number,
    sourcePeriod: evidence.sourcePeriod,
    calculation: evidence.calculation,
    comparisonBasis: evidence.comparisonBasis,
    limitation: evidence.limitation,
    officialReference,
  });
}

function regionToScope(region: AmoraQuoteRegion): AmoraQuoteScope {
  return region === "seoul" || region === "gyeonggi" ? "seoul" : "national";
}

function toOfficialReferenceRegionScope(
  region: AmoraQuoteRegion | "national",
): AmoraOfficialReferenceRegionScope {
  if (region === "gyeonggi") return "gyeonggi_incheon";
  if (region === "other") return "other_regions";
  return region;
}

function buildQuoteOfficialReference(
  category: AmoraQuoteCategory,
  region: AmoraQuoteRegion | "national",
): Readonly<AmoraOfficialReferenceScope> | null {
  if (category === "sdm_package") return null;
  return buildAmoraOfficialReferenceScope({
    version: 1,
    referenceId: DISCLOSURE_REFERENCE_ID,
    regionScope: toOfficialReferenceRegionScope(region),
    applicabilityKey: category,
    asOfDate: DISCLOSURE_SOURCE_CHECKED_AT,
  });
}

function getRelevantCosts(category: AmoraQuoteCategory): HiddenCostItem[] {
  const categories = CATEGORY_RELEVANT_COSTS[category];
  return HIDDEN_COSTS.filter(
    (item) => categories.includes(item.category) && !EXCLUDED_CHECKLIST_ITEM_IDS.has(item.id),
  );
}

function toCheckItem(item: HiddenCostItem): AmoraQuoteCheckItem {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    severity: item.severity,
    checkQuestion: item.checkQuestion,
    reason:
      "이 항목을 이용할 계획이라면 견적 포함 여부, 수량이나 시간, 별도 금액을 확인하세요.",
    disguise: "견적서에 항목명, 포함 여부, 수량 또는 시간, 추가 금액이 적혀 있는지 확인하세요.",
  };
}

export function getAmoraMarketPriceBenchmark(
  category: AmoraQuoteCategory,
  region: AmoraQuoteRegion | "national",
  catalog?: PriceCatalog,
): AmoraMarketPriceBenchmark {
  const categoryLabel = AMORA_QUOTE_CATEGORY_LABELS[category];
  const regionLabel = region === "national" ? "전국" : AMORA_QUOTE_REGION_LABELS[region];
  const officialReference = buildQuoteOfficialReference(category, region);
  const unavailable = (
    unavailableReason: AmoraMarketPriceEvidence["unavailableReason"],
    observationCount = 0,
    vendorCount = 0,
  ) => ({
    medianManwon: 0,
    comparatorLabel: "업체별 최신 공시가 확인 필요",
    evidence: {
      status: "unavailable" as const,
      observationCount,
      vendorCount,
      source: "한국소비자원 참가격" as const,
      sourceUrl: DISCLOSURE_SOURCE_URL,
      sourcePeriod: disclosureRoundLabel(),
      categoryLabel,
      regionLabel,
      calculation: "비교 가능한 공시 기본가 하한의 중간값",
      comparisonBasis: MARKET_COMPARISON_BASIS,
      limitation: "개별 계약의 구성·옵션·시점이 달라 견적의 적정성이나 최종 결제액을 판정할 수 없습니다.",
      officialReference,
      unavailableReason,
    },
  });

  if (!catalog) return unavailable("catalog_not_loaded");
  if (category === "sdm_package") return unavailable("category_not_comparable");

  const priceCategory = category satisfies PriceCategory;
  const regionCodes = new Set(
    region === "seoul"
      ? ["seoul_gangnam3", "seoul_etc"]
      : region === "gyeonggi"
        ? ["gyeonggi", "incheon"]
        : region === "busan"
          ? ["busan"]
          : region === "daegu"
            ? ["daegu"]
            : [],
  );
  const excludedFromOther = new Set([
    "seoul_gangnam3",
    "seoul_etc",
    "gyeonggi",
    "incheon",
    "busan",
    "daegu",
  ]);
  const observations: Array<{ vendorId: string; minimumKrw: number }> = [];

  for (const vendor of catalog.categories[priceCategory]) {
    for (const offer of comparableOffers(vendor)) {
      const offerRegion = offer.regionCode;
      const matchesRegion = region === "national"
        ? typeof offerRegion === "string"
        : region === "other"
          ? typeof offerRegion === "string" && !excludedFromOther.has(offerRegion)
          : typeof offerRegion === "string" && regionCodes.has(offerRegion);
      if (!matchesRegion) continue;
      if (
        offer.minimumKrw === null
        || !Number.isSafeInteger(offer.minimumKrw)
        || offer.minimumKrw <= 0
      ) continue;
      observations.push({ vendorId: vendor.id, minimumKrw: offer.minimumKrw });
    }
  }

  const vendorCount = new Set(observations.map(({ vendorId }) => vendorId)).size;
  if (observations.length < 3 || vendorCount < 3) {
    return unavailable("insufficient_sample", observations.length, vendorCount);
  }
  if (!officialReference) {
    return unavailable("reference_scope_invalid", observations.length, vendorCount);
  }

  const sorted = observations.map(({ minimumKrw }) => minimumKrw).sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const medianWon = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  const median = Math.round(medianWon / 10_000);
  const calculation = `비교 가능한 업체·대행사별 공시 기본가 하한 ${observations.length}건의 중간값`;

  return {
    medianManwon: median,
    comparatorLabel: `${regionLabel} ${categoryLabel} 공시 기본가 하한 중간값 (${observations.length}건)`,
    evidence: {
      status: "available",
      observationCount: observations.length,
      vendorCount,
      source: "한국소비자원 참가격",
      sourceUrl: DISCLOSURE_SOURCE_URL,
      sourcePeriod: disclosureRoundLabel(),
      categoryLabel,
      regionLabel,
      calculation,
      comparisonBasis: MARKET_COMPARISON_BASIS,
      limitation: MARKET_AVAILABLE_LIMITATION,
      officialReference,
    },
  };
}

// 사실만 기술하는 요약 — 사용자가 체크하지 않은 항목 개수만 말한다.
// 추가금 "추정액 계산"은 하지 않는다(구성을 모르는 채의 합산은 과장/과소가 된다).
function getSummaryCopy(
  critical: number,
  high: number,
  medium: number,
  included: number,
  notNeeded: number,
) {
  const nonCritical = high + medium;
  const total = critical + nonCritical;

  if (total === 0) {
    return {
      title: "모든 항목의 상태를 정리했어요",
      text: `견적서에 포함 ${included}개, 이용 계획 없음 ${notNeeded}개로 정리했어요. 포함 내용과 취소·변경 조건이 계약서에도 같은 내용인지 마지막으로 확인하세요.`,
      action: "계약서에 포함 항목과 환불 기준이 같은 내용으로 적혀 있는지 마지막으로 확인하세요.",
    };
  }

  const phrase =
    critical > 0 && nonCritical > 0
      ? `먼저 확인할 항목 ${critical}개와 함께 확인할 항목 ${nonCritical}개`
      : critical > 0
        ? `먼저 확인할 항목 ${critical}개`
        : `함께 확인할 항목 ${nonCritical}개`;

  return {
    title:
      critical > 0
        ? `견적서에서 먼저 확인할 항목이 ${critical}개 있어요`
        : `견적서에서 함께 확인할 항목이 ${nonCritical}개 있어요`,
    text: `${phrase}이 아직 포함됐다고 표시되지 않았어요. 필요하거나 비용이 생긴다는 뜻은 아니므로, 원하는 항목만 포함 여부와 별도 금액을 서면으로 확인해 두세요.`,
    action:
      "아래 질문 중 원하는 항목만 업체에 보내고, 포함 여부와 별도 금액을 문자나 계약서로 받아두세요. 계약 판단은 그 답을 보고 하면 됩니다.",
  };
}

export function getQuoteCheckItems(
  category: AmoraQuoteCategory,
  region: AmoraQuoteRegion
): AmoraQuoteCheckItem[] {
  void region; // Kept in the public API for callers; item questions are region-independent.
  return getRelevantCosts(category).map((item) => toCheckItem(item));
}

export function analyzeAmoraQuoteCheck(
  input: AmoraQuoteCheckInput,
  catalog?: PriceCatalog,
): AmoraQuoteCheckResult {
  const scope = regionToScope(input.region);
  const allItems = getRelevantCosts(input.category);
  const includedIdSet = new Set(input.includedItemIds);
  const notNeededIdSet = new Set(input.notNeededItemIds ?? []);
  const included = allItems.filter((item) => includedIdSet.has(item.id));
  const notNeeded = allItems.filter(
    (item) => !includedIdSet.has(item.id) && notNeededIdSet.has(item.id),
  );
  const missing = allItems.filter(
    (item) => !includedIdSet.has(item.id) && !notNeededIdSet.has(item.id),
  );
  const {
    medianManwon: marketMedianManwon,
    comparatorLabel: marketComparatorLabel,
    evidence: marketEvidence,
  } = getAmoraMarketPriceBenchmark(
    input.category,
    input.region,
    catalog,
  );
  const priceDiffPercent =
    marketMedianManwon > 0
      ? Math.round(((input.quotePriceManwon - marketMedianManwon) / marketMedianManwon) * 100)
      : 0;

  const missingCritical = missing.filter((item) => item.severity === "critical");
  const missingHigh = missing.filter((item) => item.severity === "high");
  const missingMedium = missing.filter((item) => item.severity === "medium");

  const summary = getSummaryCopy(
    missingCritical.length,
    missingHigh.length,
    missingMedium.length,
    included.length,
    notNeeded.length,
  );

  const contractQuestions = [...missingCritical, ...missingHigh]
    .slice(0, 6)
    .map((item) => toCheckItem(item).checkQuestion);

  return {
    category: input.category,
    scope,
    quotePriceManwon: input.quotePriceManwon,
    marketMedianManwon,
    marketComparatorLabel,
    priceDiffPercent,
    marketEvidence,
    checkedItemCount: included.length,
    notNeededItemCount: notNeeded.length,
    missingCriticalCount: missingCritical.length,
    missingHighCount: missingHigh.length,
    missingMediumCount: missingMedium.length,
    includedItems: included.map((item) => toCheckItem(item)),
    notNeededItems: notNeeded.map((item) => toCheckItem(item)),
    missingItems: missing.map((item) => toCheckItem(item)),
    summaryTitle: summary.title,
    summaryText: summary.text,
    recommendedAction: summary.action,
    contractQuestions,
    negotiationScript:
      "안녕하세요. 계약 전 확인차 문의드립니다. 아래 항목들이 견적에 포함인지, 미포함이면 항목별 추가금과 최대 상한이 얼마인지 문자로 남겨주실 수 있을까요?",
    sourceNote: marketEvidence.status === "available"
      ? `이 결과는 견적의 적정성을 판정하지 않습니다. 참고값은 ${marketEvidence.source} ${marketEvidence.sourcePeriod} 공시 중 ${marketEvidence.calculation}이며, 실제 추가 비용과 계약 조건은 업체 서면 견적을 확인하세요.`
      : "이 결과는 사용자가 ‘포함’, ‘이용 계획 없음’, ‘확인 필요’로 고른 상태만 정리하며 가격의 적정성을 판정하지 않습니다. 최신 업체별 공시가는 ‘업체 공시가’에서 출처와 기준 시점을 확인하고, 실제 추가 비용은 업체 서면 견적을 확인하세요.",
  };
}
