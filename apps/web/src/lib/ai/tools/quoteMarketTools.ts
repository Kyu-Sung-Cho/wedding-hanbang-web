import type { ToolExecutionResult } from "@/types/database.types";
import {
  analyzeAmoraQuoteCheck,
  getAmoraMarketPriceBenchmark,
  getQuoteCheckItems,
  type AmoraQuoteCategory,
  type AmoraQuoteRegion,
} from "@/lib/amora/quoteCheck";
import type { PriceCatalog, PriceCategory } from "@/lib/price/catalog";
import { loadPublicPriceCatalog } from "@/lib/price/publicListData";
import { createPublicClient } from "@/lib/supabase/public";

type PublicPriceCatalogLoader = (
  priceCategories: readonly PriceCategory[],
) => Promise<PriceCatalog>;

async function loadPublishedPriceCatalog(
  priceCategories: readonly PriceCategory[],
): Promise<PriceCatalog> {
  return loadPublicPriceCatalog(createPublicClient(), {
    optionCategories: [],
    priceCategories,
  });
}

type ComparablePriceCategory = Exclude<PriceCategory, "hall">;

const MARKET_TOOL_CATEGORY_MAP: Partial<Record<string, ComparablePriceCategory>> = {
  studio: "studio",
  dress: "dress",
  makeup: "makeup",
};

export async function executeGetMarketPrice(
  input: Record<string, unknown>,
  loadCatalog: PublicPriceCatalogLoader = loadPublishedPriceCatalog,
): Promise<ToolExecutionResult> {
  const requestedCategory = typeof input.category === "string" ? input.category : "";
  const category = MARKET_TOOL_CATEGORY_MAP[requestedCategory];
  const isSdm = requestedCategory === "sdm";
  const region = input.scope === "seoul" ? "seoul" : "national";

  if (!category && !isSdm) {
    return {
      toolName: "get_market_price",
      toolInput: input,
      toolOutput: {
        status: "unsupported_comparison",
        publicPath: "/price",
        sourcePolicy: "reviewed_published_vendor_disclosures_only",
      },
      success: true,
      displayMessage:
        "현재 공시 자료만으로는 그 범위를 같은 조건의 숫자로 비교할 수 없어요. 항목별 업체 공시가와 조건을 확인해 주세요.",
    };
  }

  let catalog: PriceCatalog;
  try {
    catalog = await loadCatalog(
      isSdm ? ["studio", "dress", "makeup"] : [category!],
    );
  } catch {
    return {
      toolName: "get_market_price",
      toolInput: input,
      toolOutput: {
        status: "catalog_unavailable",
        publicPath: `/price/${requestedCategory}`,
        sourcePolicy: "reviewed_published_vendor_disclosures_only",
      },
      success: false,
      displayMessage:
        "지금 공시 가격 원문을 불러오지 못했어요. 숫자를 추정하지 않았으니 잠시 후 다시 확인해 주세요.",
    };
  }

  if (isSdm) {
    const componentBenchmarks = {
      studio: getAmoraMarketPriceBenchmark("studio", region, catalog),
      dress: getAmoraMarketPriceBenchmark("dress", region, catalog),
      makeup: getAmoraMarketPriceBenchmark("makeup", region, catalog),
    };
    const benchmarks = Object.fromEntries(
      Object.entries(componentBenchmarks).map(([name, benchmark]) => [
        name,
        benchmark.evidence.status === "available"
          ? {
              medianManwon: benchmark.medianManwon,
              comparatorLabel: benchmark.comparatorLabel,
              ...benchmark.evidence,
            }
          : benchmark.evidence,
      ]),
    );
    const availableCount = Object.values(componentBenchmarks)
      .filter(({ evidence }) => evidence.status === "available").length;

    return {
      toolName: "get_market_price",
      toolInput: input,
      toolOutput: {
        status: availableCount > 0 ? "available_by_component" : "insufficient_comparable_data",
        publicPath: "/price",
        sourcePolicy: "reviewed_published_vendor_disclosures_only",
        benchmarks,
      },
      success: true,
      displayMessage: availableCount > 0
        ? "사진 촬영·드레스·헤어·메이크업은 기본 구성과 표본이 달라 각각의 공시 기본가 하한 중간값으로 보여드렸고, 묶음 합계로 더하지 않았어요."
        : "사진 촬영·드레스·헤어·메이크업은 같은 조건으로 비교할 공시가 충분하지 않아 숫자를 만들지 않았어요.",
    };
  }

  // 위 분기에서 SDM을 처리했으므로 여기서는 단일 카테고리만 남는다.
  if (!category) throw new Error("UNREACHABLE_MARKET_CATEGORY");
  const benchmark = getAmoraMarketPriceBenchmark(category, region, catalog);
  if (benchmark.evidence.status === "unavailable") {
    return {
      toolName: "get_market_price",
      toolInput: input,
      toolOutput: {
        status: "insufficient_comparable_data",
        publicPath: `/price/${requestedCategory}`,
        sourcePolicy: "reviewed_published_vendor_disclosures_only",
        evidence: benchmark.evidence,
      },
      success: true,
      displayMessage:
        `${benchmark.evidence.regionLabel} ${benchmark.evidence.categoryLabel}은 같은 조건으로 비교할 공시가 충분하지 않아 숫자를 만들지 않았어요. 업체별 원문을 확인해 주세요.`,
    };
  }

  return {
    toolName: "get_market_price",
    toolInput: input,
    toolOutput: {
      status: "available",
      publicPath: `/price/${requestedCategory}`,
      sourcePolicy: "reviewed_published_vendor_disclosures_only",
      benchmark: {
        medianManwon: benchmark.medianManwon,
        comparatorLabel: benchmark.comparatorLabel,
        ...benchmark.evidence,
      },
    },
    success: true,
    displayMessage:
      `${benchmark.comparatorLabel}은 ${benchmark.medianManwon.toLocaleString("ko-KR")}만원이에요. ${benchmark.evidence.sourcePeriod} 공시 기본가 하한의 참고값이며, 실제 계약 금액이나 견적 적정성 판정은 아니에요.`,
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

export async function executeAnalyzeQuoteWithTrustEngine(
  input: Record<string, unknown>,
  loadCatalog: PublicPriceCatalogLoader = loadPublishedPriceCatalog,
): Promise<ToolExecutionResult> {
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
  let catalog: PriceCatalog | undefined;
  try {
    catalog = await loadCatalog(
      category === "sdm_package" ? ["studio", "dress", "makeup"] : [category],
    );
  } catch {
    // 견적 구성 확인 자체는 계속 제공하되, 공시가 숫자는 만들지 않는다.
    catalog = undefined;
  }
  const analysis = analyzeAmoraQuoteCheck({
    category,
    region,
    quotePriceManwon: quotePrice,
    includedItemIds,
    notNeededItemIds,
    vendorName,
  }, catalog);

  const output = {
    quotePrice: analysis.quotePriceManwon,
    category: analysis.category,
    region: analysis.scope,
    vendorName,
    marketMedian: analysis.marketMedianManwon,
    marketComparatorLabel: analysis.marketComparatorLabel,
    marketEvidence: analysis.marketEvidence,
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
    statsNote: analysis.sourceNote,
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
