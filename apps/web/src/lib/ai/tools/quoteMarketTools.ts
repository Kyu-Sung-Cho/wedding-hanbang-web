import type { ToolExecutionResult } from "@/types/database.types";
import {
  getLatestPeriodId,
  VENUE_NECESSARY,
  SDM_PACKAGES,
  DRESS_PRICES,
  MAKEUP_PRICES,
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

const MARKET_PRICE_SOURCE = {
  name: "한국소비자원 참가격 결혼서비스 가격조사",
  url: "https://price.go.kr/tprice/portal/wedding/areaStatistic.do",
} as const;

export function executeGetMarketPrice(input: Record<string, unknown>): ToolExecutionResult {
  const category = input.category as string;
  const scope = (input.scope as "national" | "seoul") ?? "national";
  const pid = getLatestPeriodId();
  const period = PRICE_PERIODS.find((pricePeriod) => pricePeriod.id === pid)!;
  const scopeLabel = scope === "seoul" ? "서울" : "전국";

  let displayMessage = "";
  let toolOutput: Record<string, unknown> = {};

  switch (category) {
    case "total": {
      displayMessage = `[${period.label} 조사]\n예식장과 스드메는 조사 항목·단위가 달라 하나의 "총비용"으로 합산하지 않아요. 예식장은 venue, 스드메는 sdm 항목으로 각각 확인해주세요.`;
      toolOutput = {
        periodId: pid,
        periodLabel: period.label,
        totalAvailable: false,
        reason: "예식장과 스드메의 서로 다른 조사 항목을 합산한 총비용은 제공하지 않습니다.",
      };
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
      const region = scope === "seoul" ? "서울" : "전체";
      const studio = SDM_PACKAGES.find(
        (packagePrice) => packagePrice.periodId === pid && packagePrice.region === region
      );
      if (studio) {
        displayMessage = `[${scopeLabel} 스튜디오 기본촬영 - ${period.label}]\n중위가격: ${studio.studioBasic}만원`;
        toolOutput = { periodId: pid, periodLabel: period.label, region, studioBasic: studio.studioBasic };
      }
      break;
    }
    case "dress": {
      const d = DRESS_PRICES.find((price) => price.periodId === pid && price.scope === scope);
      if (d) {
        displayMessage = `[${scopeLabel} 드레스 중위가격 - ${period.label}]\n촬영용: ${d.photoShoot}만원\n본식용: ${d.ceremony}만원\n2부 드레스: ${d.secondDress}만원`;
        toolOutput = { periodId: pid, periodLabel: period.label, prices: d };
      }
      break;
    }
    case "makeup": {
      const m = MAKEUP_PRICES.find((price) => price.periodId === pid && price.scope === scope);
      if (m) {
        displayMessage = `[${scopeLabel} 메이크업 중위가격 - ${period.label}]\n촬영: ${m.photoShoot}만원\n본식: ${m.ceremony}만원\n리허설: ${m.rehearsal}만원`;
        toolOutput = { periodId: pid, periodLabel: period.label, prices: m };
      }
      break;
    }
    case "options": {
      const options = getVenueOptionalItems(pid, scope);
      const available = Object.entries(options.items).filter(([, price]) => price > 0);
      displayMessage = `[${scopeLabel} 예식장 선택항목 중위가격 - ${period.label}]\n` +
        available.map(([name, price]) => `- ${name}: ${price}만원`).join("\n");
      toolOutput = { periodId: pid, periodLabel: period.label, category: "venue", options: options.items };
      break;
    }
    case "seasonal": {
      const latest = SEASONAL_DATA.find((item) => item.periodId === pid);
      if (latest) {
        displayMessage = `[예식장 성수기·비수기 중위 계약금액 - ${period.label}]\n성수기 (4~6월, 9~11월): ${latest.peak}만원\n비수기 (1~3월, 7~8월, 12월): ${latest.offPeak}만원\n차이: ${latest.savings}만원 (절약 보장액 아님)`;
        toolOutput = { periodId: pid, periodLabel: period.label, seasonal: latest };
      }
      break;
    }
    default:
      displayMessage = "지원하지 않는 카테고리입니다.";
  }

  if (Object.keys(toolOutput).length > 0) {
    toolOutput = {
      ...toolOutput,
      sourceName: MARKET_PRICE_SOURCE.name,
      sourceUrl: MARKET_PRICE_SOURCE.url,
    };
  }

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
    region,
    vendorName,
    dataSource: analysis.sourceNote,
    sourceUrl: analysis.sourceUrl,
    unconfirmedItems: analysis.unconfirmedItems.map((item) => ({
      name: item.name,
      category: item.category,
      checkQuestion: item.checkQuestion,
    })),
    includedItems: analysis.includedItems.map((item) => ({
      name: item.name,
      category: item.category,
    })),
    unconfirmedItemCount: analysis.unconfirmedItemCount,
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
      analysis.unconfirmedItemCount > 0
        ? `견적 체크 완료: ${analysis.unconfirmedItemCount}개 항목의 포함 여부를 더 확인해보세요`
        : "견적 체크 완료: 선택한 확인 항목을 모두 포함으로 표시했어요",
  };
}
