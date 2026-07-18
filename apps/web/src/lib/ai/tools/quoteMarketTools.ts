import type { ToolExecutionResult } from "@/types/database.types";
import {
  getNationalTotal,
  getRegionalCosts,
  getLatestPeriodId,
  VENUE_NECESSARY,
  SDM_PACKAGES,
  DRESS_PRICES,
  MAKEUP_PRICES,
  OPTION_PRICES,
  SEASONAL_DATA,
  PRICE_PERIODS,
  getVenueOptionalItems,
} from "@/constants/marketPrices";
import {
  analyzeAmoraQuoteCheck,
  getQuoteCheckItems,
  type AmoraQuoteCategory,
  type AmoraQuoteRegion,
} from "@/lib/amora/quoteCheck";
import {
  OFF_PEAK_WEDDING_MONTHS_LABEL,
  PEAK_WEDDING_MONTHS_LABEL,
} from "@/constants/weddingSeasonality";

const MARKET_PRICE_SOURCE_URL = "https://www.price.go.kr/tprice/portal/wedding/areaStatistic.do";

export function executeGetMarketPrice(input: Record<string, unknown>): ToolExecutionResult {
  if (PRICE_PERIODS.length === 0) {
    return {
      toolName: "get_market_price",
      toolInput: input,
      toolOutput: {
        status: "migrated_to_published_disclosures",
        publicPath: "/price",
        sourcePolicy: "reviewed_published_vendor_disclosures_only",
      },
      success: true,
      displayMessage:
        "과거 고정 시세표는 종료했어요. 최신 업체별 공시가는 ‘업체 공시가’에서 출처와 기준 시점을 함께 확인해 주세요.",
    };
  }

  const category = input.category as string;
  const scope = (input.scope as "national" | "seoul") ?? "national";
  const pid = getLatestPeriodId();
  const period = PRICE_PERIODS.find((pricePeriod) => pricePeriod.id === pid)!;
  const scopeLabel = scope === "seoul" ? "서울" : "전국";

  let displayMessage = "";
  let toolOutput: Record<string, unknown> = {};

  switch (category) {
    case "total": {
      const nat = getNationalTotal(pid);
      const regional = getRegionalCosts(pid);
      const seoulGangnam = regional.find((row) => row.region === "seoulGangnam");
      const seoulOther = regional.find((row) => row.region === "seoulOther");
      displayMessage = `[${period.label} 평균 총 계약금액 — 선택품목 제외]\n전국: ${nat.total}만원 (식대 ${nat.meal} + 스드메 ${nat.sdm} + 대관료 ${nat.rental} + 기본장식비 ${nat.decoration})\n서울(강남): ${seoulGangnam?.total ?? "-"}만원\n서울(강남외): ${seoulOther?.total ?? "-"}만원\n표본 평균이며 개별 견적의 적정성이나 최종 결제액을 뜻하지 않습니다.`;
      toolOutput = { national: nat, seoulGangnam, seoulOther };
      break;
    }
    case "venue": {
      const nec = VENUE_NECESSARY.find((venue) => venue.periodId === pid && venue.scope === scope);
      const opt = getVenueOptionalItems(pid, scope);
      if (nec) {
        displayMessage = `[${scopeLabel} 예식장 시세 - ${period.label}]\n대관료: ${nec.rental}만원\n1인당 식대: ${nec.perPersonMeal}만원\n최소보증인원: ${nec.minGuests}명\n식대총액: ${nec.totalFood}만원\n\n주요 선택항목:\n- 생화꽃장식: ${opt.items["생화꽃장식"]}만원\n- 축가: ${opt.items["축가/축하공연"]}만원\n- 사회자: ${opt.items["본식 사회자"]}만원\n- 웨딩케이크: ${opt.items["웨딩케이크"]}만원\n- 폐백음식: ${opt.items["폐백 음식"]}만원\n- 부케: ${opt.items["부케"]}만원`;
        toolOutput = { necessary: nec, optional: opt.items };
      }
      break;
    }
    case "sdm": {
      const pkgs = SDM_PACKAGES.filter((packagePrice) => packagePrice.periodId === pid);
      displayMessage = `[스드메 패키지 시세 - ${period.label}]\n` +
        pkgs.map((packagePrice) => `${packagePrice.region}: 패키지 ${packagePrice.packageMedian}만원 / 드메 ${packagePrice.dmPackageMedian}만원 / 스튜디오 ${packagePrice.studioBasic}만원`).join("\n");
      toolOutput = { packages: pkgs };
      break;
    }
    case "studio": {
      const studioOpts = OPTION_PRICES.filter((option) => option.category === "studio");
      const priceKey = scope === "seoul" ? "seoulPrice" : "nationalPrice";
      displayMessage = `[${scopeLabel} 스튜디오 옵션 시세]\n` +
        studioOpts.filter((option) => option[priceKey] > 0).map((option) => `- ${option.name}: ${option[priceKey]}만원`).join("\n");
      toolOutput = { options: studioOpts };
      break;
    }
    case "dress": {
      const d = DRESS_PRICES.find((price) => price.periodId === pid && price.scope === scope);
      const dressOpts = OPTION_PRICES.filter((option) => option.category === "dress");
      const priceKey = scope === "seoul" ? "seoulPrice" : "nationalPrice";
      if (d) {
        displayMessage = `[${scopeLabel} 드레스 시세 - ${period.label}]\n촬영용: ${d.photoShoot}만원\n본식용: ${d.ceremony}만원\n2부 드레스: ${d.secondDress}만원\n\n주요 옵션:\n` +
          dressOpts.filter((option) => option[priceKey] > 0).map((option) => `- ${option.name}: ${option[priceKey]}만원`).join("\n");
        toolOutput = { prices: d, options: dressOpts };
      }
      break;
    }
    case "makeup": {
      const m = MAKEUP_PRICES.find((price) => price.periodId === pid && price.scope === scope);
      const makeupOpts = OPTION_PRICES.filter((option) => option.category === "makeup");
      const priceKey = scope === "seoul" ? "seoulPrice" : "nationalPrice";
      if (m) {
        displayMessage = `[${scopeLabel} 메이크업 시세 - ${period.label}]\n촬영: ${m.photoShoot}만원\n본식: ${m.ceremony}만원\n리허설: ${m.rehearsal}만원\n\n주요 옵션:\n` +
          makeupOpts.filter((option) => option[priceKey] > 0).map((option) => `- ${option.name}: ${option[priceKey]}만원`).join("\n");
        toolOutput = { prices: m, options: makeupOpts };
      }
      break;
    }
    case "options": {
      const allOpts = OPTION_PRICES;
      const priceKey = scope === "seoul" ? "seoulPrice" : "nationalPrice";
      displayMessage = `[${scopeLabel} 옵션별 중간값 - ${period.label} 조사]\n\n스튜디오 (${allOpts.filter((option) => option.category === "studio").length}개):\n` +
        allOpts.filter((option) => option.category === "studio" && option[priceKey] > 0).map((option) => `- ${option.name}: ${option[priceKey]}만원`).join("\n") +
        `\n\n드레스 (${allOpts.filter((option) => option.category === "dress").length}개):\n` +
        allOpts.filter((option) => option.category === "dress" && option[priceKey] > 0).map((option) => `- ${option.name}: ${option[priceKey]}만원`).join("\n") +
        `\n\n메이크업 (${allOpts.filter((option) => option.category === "makeup").length}개):\n` +
        allOpts.filter((option) => option.category === "makeup" && option[priceKey] > 0).map((option) => `- ${option.name}: ${option[priceKey]}만원`).join("\n");
      toolOutput = { options: allOpts };
      break;
    }
    case "seasonal": {
      const latest = SEASONAL_DATA[SEASONAL_DATA.length - 1];
      displayMessage = `[예식장 필수품목 표본 중간값 - ${period.label} 조사]\n성수기 (${PEAK_WEDDING_MONTHS_LABEL}): ${latest.peak}만원\n비수기 (${OFF_PEAK_WEDDING_MONTHS_LABEL}): ${latest.offPeak}만원\n두 표본 중간값 차이: ${latest.savings}만원\n특정 날짜·업체의 할인이나 절약액을 보장하지 않아요.`;
      toolOutput = { seasonal: latest };
      break;
    }
    default:
      displayMessage = "지원하지 않는 카테고리입니다.";
  }

  toolOutput = {
    ...toolOutput,
    sourceName: "한국소비자원 참가격 결혼서비스 통계",
    sourceUrl: MARKET_PRICE_SOURCE_URL,
    periodLabel: period.label,
    applicability: "표본 통계이며 개별 업체의 최신 가격·구성·견적 적정성·최종 결제액을 보증하지 않습니다.",
  };

  return {
    toolName: "get_market_price",
    toolInput: input,
    toolOutput,
    success: true,
    displayMessage: displayMessage || "시세 정보를 조회했습니다.",
  };
}

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
    marketComparatorLabel: analysis.marketComparatorLabel,
    priceDiff: analysis.marketMedianManwon > 0
      ? analysis.quotePriceManwon - analysis.marketMedianManwon
      : null,
    priceDiffPercent: analysis.priceDiffPercent,
    dataSource: analysis.sourceNote,
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
    missingCriticalCount: analysis.missingCriticalCount,
    missingHighCount: analysis.missingHighCount,
    missingMediumCount: analysis.missingMediumCount,
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
    displayMessage:
      analysis.missingCriticalCount + analysis.missingHighCount + analysis.missingMediumCount > 0
        ? `견적 체크 완료: 핵심 확인 ${analysis.missingCriticalCount}개·추가 확인 ${analysis.missingHighCount + analysis.missingMediumCount}개가 견적서에서 확인되지 않았어요`
        : "견적 체크 완료: 체크리스트의 주요 항목이 모두 견적서에 명시돼 있어요",
  };
}
