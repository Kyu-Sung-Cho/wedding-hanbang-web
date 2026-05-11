import {
  HIDDEN_COSTS,
  RED_FLAGS,
  estimateHiddenCosts,
  getGradeFromScore,
  type HiddenCostItem,
} from "@/constants/hiddenCosts";
import {
  PRICE_PERIODS,
  getCategoryMarketPrice,
  getLatestPeriodId,
  getNationalTotal,
  getSeoulTotal,
} from "@/constants/marketPrices";

export type AmoraQuoteCategory = "sdm_package" | "studio" | "dress" | "makeup";
export type AmoraQuoteRegion = "seoul" | "gyeonggi" | "busan" | "daegu" | "other";
export type AmoraQuoteScope = "national" | "seoul";
export type AmoraQuoteVerdict = "safe" | "caution" | "danger";

export interface AmoraQuoteCheckInput {
  category: AmoraQuoteCategory;
  region: AmoraQuoteRegion;
  quotePriceManwon: number;
  includedItemIds: string[];
  vendorName?: string;
  memo?: string;
}

export interface AmoraQuoteCheckItem {
  id: string;
  name: string;
  category: HiddenCostItem["category"];
  severity: HiddenCostItem["severity"];
  priceManwon: number;
  usageRatePercent: number;
  checkQuestion: string;
  reason: string;
  disguise: string;
}

export interface AmoraQuoteCheckResult {
  verdict: AmoraQuoteVerdict;
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
  category: AmoraQuoteCategory;
  scope: AmoraQuoteScope;
  quotePriceManwon: number;
  marketMedianManwon: number;
  priceDiffPercent: number;
  estimatedHiddenMinManwon: number;
  estimatedHiddenMaxManwon: number;
  estimatedTotalMinManwon: number;
  estimatedTotalMaxManwon: number;
  checkedItemCount: number;
  missingCriticalCount: number;
  missingHighCount: number;
  missingMediumCount: number;
  includedItems: AmoraQuoteCheckItem[];
  missingItems: AmoraQuoteCheckItem[];
  redFlags: Array<{ id: string; name: string; description: string }>;
  summaryTitle: string;
  summaryText: string;
  recommendedAction: string;
  contractQuestions: string[];
  negotiationScript: string;
  sourceNote: string;
}

export const AMORA_QUOTE_CATEGORY_LABELS: Record<AmoraQuoteCategory, string> = {
  sdm_package: "스드메 패키지",
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
};

export const AMORA_QUOTE_REGION_LABELS: Record<AmoraQuoteRegion, string> = {
  seoul: "서울",
  gyeonggi: "경기/인천",
  busan: "부산",
  daegu: "대구",
  other: "기타 지역",
};

const CATEGORY_RELEVANT_COSTS: Record<AmoraQuoteCategory, HiddenCostItem["category"][]> = {
  sdm_package: ["studio", "dress", "makeup", "common"],
  studio: ["studio"],
  dress: ["dress"],
  makeup: ["makeup"],
};

function regionToScope(region: AmoraQuoteRegion): AmoraQuoteScope {
  return region === "seoul" || region === "gyeonggi" ? "seoul" : "national";
}

function getRelevantCosts(category: AmoraQuoteCategory): HiddenCostItem[] {
  const categories = CATEGORY_RELEVANT_COSTS[category];
  return HIDDEN_COSTS.filter((item) => categories.includes(item.category));
}

function toCheckItem(item: HiddenCostItem, scope: AmoraQuoteScope): AmoraQuoteCheckItem {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    severity: item.severity,
    priceManwon: scope === "seoul" ? item.seoulPrice : item.nationalPrice,
    usageRatePercent: Math.round(item.usageRate * 100),
    checkQuestion: item.checkQuestion,
    reason: item.reason,
    disguise: item.disguise,
  };
}

function getMarketMedian(category: AmoraQuoteCategory, scope: AmoraQuoteScope): number {
  if (category === "sdm_package") {
    return scope === "seoul" ? getSeoulTotal().sdm : getNationalTotal().sdm;
  }

  return getCategoryMarketPrice(category, scope) ?? 0;
}

function getVerdict(
  score: number,
  missingCriticalCount: number,
  estimatedHiddenMinManwon: number,
  quotePriceManwon: number
): AmoraQuoteVerdict {
  const hiddenRatio = quotePriceManwon > 0 ? estimatedHiddenMinManwon / quotePriceManwon : 0;
  if (score < 55 || missingCriticalCount >= 3 || hiddenRatio >= 0.35) return "danger";
  if (score < 75 || missingCriticalCount > 0 || hiddenRatio >= 0.15) return "caution";
  return "safe";
}

function getSummaryCopy(result: {
  verdict: AmoraQuoteVerdict;
  grade: string;
  missingCriticalCount: number;
  estimatedHiddenMinManwon: number;
  estimatedHiddenMaxManwon: number;
  priceDiffPercent: number;
}) {
  if (result.verdict === "danger") {
    return {
      title: `계약 전 멈춤 신호입니다. 투명도 ${result.grade}등급`,
      text: `필수 항목 ${result.missingCriticalCount}개가 견적서에서 확인되지 않았고, 추가금이 약 ${Math.round(result.estimatedHiddenMinManwon)}~${Math.round(result.estimatedHiddenMaxManwon)}만원까지 열려 있습니다.`,
      action: "계약금 입금 전 포함/미포함 항목과 추가금 상한을 문자나 계약서로 받아두세요.",
    };
  }

  if (result.verdict === "caution") {
    return {
      title: `나쁘진 않지만 확인이 더 필요합니다. 투명도 ${result.grade}등급`,
      text: `가격 자체보다 빠진 항목이 문제일 수 있습니다. 특히 필수/고빈도 추가금 항목을 먼저 확인해야 합니다.`,
      action: "아래 질문을 업체에 그대로 보내고 답변을 받은 뒤 계약 여부를 결정하세요.",
    };
  }

  return {
    title: `대체로 투명한 견적입니다. 투명도 ${result.grade}등급`,
    text: `확인된 항목이 충분하고 예상 추가금 리스크가 낮습니다. 그래도 취소/변경/원본 제공 조건은 계약서에 남겨두는 편이 안전합니다.`,
    action: "계약서에 포함 항목과 환불 기준이 같은 내용으로 적혀 있는지만 마지막으로 확인하세요.",
  };
}

export function getQuoteCheckItems(
  category: AmoraQuoteCategory,
  region: AmoraQuoteRegion
): AmoraQuoteCheckItem[] {
  const scope = regionToScope(region);
  return getRelevantCosts(category).map((item) => toCheckItem(item, scope));
}

export function analyzeAmoraQuoteCheck(input: AmoraQuoteCheckInput): AmoraQuoteCheckResult {
  const scope = regionToScope(input.region);
  const allItems = getRelevantCosts(input.category);
  const includedIdSet = new Set(input.includedItemIds);
  const included = allItems.filter((item) => includedIdSet.has(item.id));
  const missing = allItems.filter((item) => !includedIdSet.has(item.id));
  const marketMedianManwon = getMarketMedian(input.category, scope);
  const priceDiffPercent =
    marketMedianManwon > 0
      ? Math.round(((input.quotePriceManwon - marketMedianManwon) / marketMedianManwon) * 100)
      : 0;

  const missingCritical = missing.filter((item) => item.severity === "critical");
  const missingHigh = missing.filter((item) => item.severity === "high");
  const missingMedium = missing.filter((item) => item.severity === "medium");
  const estimatedHiddenMinManwon = Math.round(estimateHiddenCosts(missing, scope));
  const estimatedHiddenMaxManwon = Math.round(
    missing.reduce((total, item) => total + (scope === "seoul" ? item.seoulPrice : item.nationalPrice), 0)
  );

  let score = 100;
  score -= missingCritical.length * 14;
  score -= missingHigh.length * 7;
  score -= missingMedium.length * 2;
  if (included.length < Math.max(4, Math.ceil(allItems.length * 0.2))) score -= 12;
  if (priceDiffPercent < -30) score -= 8;
  if (priceDiffPercent > 35) score -= 6;
  score += included.filter((item) => item.severity === "critical").length * 6;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const grade = getGradeFromScore(score);
  const verdict = getVerdict(score, missingCritical.length, estimatedHiddenMinManwon, input.quotePriceManwon);
  const estimatedTotalMinManwon = input.quotePriceManwon + estimatedHiddenMinManwon;
  const estimatedTotalMaxManwon = input.quotePriceManwon + estimatedHiddenMaxManwon;

  const redFlags = [];
  if (priceDiffPercent < -30) redFlags.push(RED_FLAGS.find((flag) => flag.id === "bait_pricing"));
  if (missingCritical.length > 0) redFlags.push(RED_FLAGS.find((flag) => flag.id === "essential_as_option"));
  if (included.length < 5) redFlags.push(RED_FLAGS.find((flag) => flag.id === "price_opacity"));

  const summary = getSummaryCopy({
    verdict,
    grade,
    missingCriticalCount: missingCritical.length,
    estimatedHiddenMinManwon,
    estimatedHiddenMaxManwon,
    priceDiffPercent,
  });

  const contractQuestions = [...missingCritical, ...missingHigh]
    .slice(0, 6)
    .map((item) => item.checkQuestion);

  const period = PRICE_PERIODS.find((item) => item.id === getLatestPeriodId());

  return {
    verdict,
    grade,
    score,
    category: input.category,
    scope,
    quotePriceManwon: input.quotePriceManwon,
    marketMedianManwon,
    priceDiffPercent,
    estimatedHiddenMinManwon,
    estimatedHiddenMaxManwon,
    estimatedTotalMinManwon,
    estimatedTotalMaxManwon,
    checkedItemCount: included.length,
    missingCriticalCount: missingCritical.length,
    missingHighCount: missingHigh.length,
    missingMediumCount: missingMedium.length,
    includedItems: included.map((item) => toCheckItem(item, scope)),
    missingItems: missing.map((item) => toCheckItem(item, scope)),
    redFlags: redFlags
      .filter((flag): flag is NonNullable<typeof flag> => Boolean(flag))
      .map((flag) => ({ id: flag.id, name: flag.name, description: flag.description })),
    summaryTitle: summary.title,
    summaryText: summary.text,
    recommendedAction: summary.action,
    contractQuestions,
    negotiationScript:
      "안녕하세요. 계약 전 확인차 문의드립니다. 아래 항목들이 견적에 포함인지, 미포함이면 항목별 추가금과 최대 상한이 얼마인지 문자로 남겨주실 수 있을까요?",
    sourceNote: `한국소비자원 참가격 결혼서비스 통계 ${period?.label ?? ""} 기준과 웨딩한방 숨은비용 체크리스트를 함께 사용했습니다.`,
  };
}
