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

// 가격대 자동 분류 — 한국소비자원 중위가 대비 multiplier 기반.
// 정부 통계가 분위(p25/p75)를 제공하지 않으므로, 한국 결혼 시장의 일반적 분포
// (표준편차 ≈ 중위가의 25~35%)를 가정한 합리적 boundary.
// 사용자가 명시적으로 override 가능.
export type AmoraPriceTier =
  | "suspicious_low" // < 60%: 이상하게 쌈 (bait pricing 의심)
  | "standard"       // 60~130%: 일반 가격대 (정부 통계와 직접 비교)
  | "premium"        // 130~200%: 프리미엄 가격대 (비교 톤다운)
  | "highend";       // > 200%: 하이엔드 (가격 비교 무의미, 함정 분석에만 집중)

const PRICE_TIER_BOUNDARIES = {
  suspiciousLowMax: 0.6,
  standardMax: 1.3,
  premiumMax: 2.0,
} as const;

export interface AmoraQuoteCheckInput {
  category: AmoraQuoteCategory;
  region: AmoraQuoteRegion;
  quotePriceManwon: number;
  includedItemIds: string[];
  vendorName?: string;
  memo?: string;
  /** 사용자 보정 — 자동 분류가 안 맞을 때 명시적으로 override */
  userPriceTierOverride?: AmoraPriceTier;
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
  /** 자동 분류된 가격대 (사용자 override 적용 후) */
  priceTier: AmoraPriceTier;
  /** 시스템이 추론한 원래 가격대 — UI에서 "보정됨" 표시할 때 사용 */
  priceTierAutoInferred: AmoraPriceTier;
  /** highend는 가격 비교 메시지를 숨김 — UI 분기에 사용 */
  showPriceComparison: boolean;
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

function classifyPriceTier(
  quotePriceManwon: number,
  marketMedianManwon: number
): AmoraPriceTier {
  if (marketMedianManwon <= 0) return "standard";
  const ratio = quotePriceManwon / marketMedianManwon;
  if (ratio < PRICE_TIER_BOUNDARIES.suspiciousLowMax) return "suspicious_low";
  if (ratio < PRICE_TIER_BOUNDARIES.standardMax) return "standard";
  if (ratio < PRICE_TIER_BOUNDARIES.premiumMax) return "premium";
  return "highend";
}

function getSummaryCopy(result: {
  verdict: AmoraQuoteVerdict;
  grade: string;
  missingCriticalCount: number;
  estimatedHiddenMinManwon: number;
  estimatedHiddenMaxManwon: number;
  priceDiffPercent: number;
  priceTier: AmoraPriceTier;
}) {
  const minHidden = Math.round(result.estimatedHiddenMinManwon);
  const maxHidden = Math.round(result.estimatedHiddenMaxManwon);
  // 핵심 원칙: 견적의 좋고 나쁨을 평가하지 않음. 사실만 기술.
  //  - 빠진 항목 개수
  //  - 한국 평균 대비 위치 (참고)
  //  - 계약 전 확인 권유
  // "투명도 등급", "안전/위험" 같은 판단 단어는 사용하지 않음.

  // 하이엔드: 가격 비교 메시지 완전 제거.
  if (result.priceTier === "highend") {
    if (result.verdict === "danger") {
      return {
        title: `필수 항목 ${result.missingCriticalCount}개가 견적서에서 확인되지 않았어요`,
        text: `프리미엄·하이엔드 견적이라도 항목 누락은 동일하게 발생해요. 빠진 ${result.missingCriticalCount}개 항목 기준으로 약 ${minHidden}~${maxHidden}만원의 추가 청구 가능성이 있어요.`,
        action: "가격이 적정하다·과하다는 판단이 아닙니다. 빠진 항목별로 업체 답변을 받아 계약 여부는 본인이 결정하세요.",
      };
    }
    if (result.verdict === "caution") {
      return {
        title: `확인이 더 필요한 항목 ${result.missingCriticalCount}개가 있어요`,
        text: `가격대와 무관하게 빠지기 쉬운 항목들이 견적에서 확인되지 않았어요.`,
        action: "아래 질문을 업체에 그대로 보내고 답변을 받은 뒤 계약 여부를 결정하세요.",
      };
    }
    return {
      title: `주요 항목 대부분이 견적서에 명시되어 있어요`,
      text: `필수 항목이 충분히 명시돼 있고 추가금 리스크가 낮은 편이에요. 환불·취소·원본 제공 조건은 계약서로 남겨두면 좋아요.`,
      action: "계약서에 포함 항목과 환불 기준이 같은 내용으로 적혀 있는지 마지막으로 확인하세요.",
    };
  }

  // 이상하게 낮은 가격: bait pricing 시그널만 알려줌 (판단 아님)
  if (result.priceTier === "suspicious_low") {
    if (result.verdict === "danger") {
      return {
        title: `한국 평균보다 현저히 낮은 견적 + 필수 항목 ${result.missingCriticalCount}개 누락`,
        text: `평균보다 낮은 견적인데 필수 항목 ${result.missingCriticalCount}개가 빠져 있어요. 빠진 항목 기준 약 ${minHidden}~${maxHidden}만원이 추가 청구될 패턴이 흔해요.`,
        action: "낮은 견적일수록 빠진 항목과 추가금 상한을 계약서로 받아두세요. 구두 약속은 변경되기 쉬워요.",
      };
    }
    return {
      title: `한국 평균 대비 낮은 견적이에요`,
      text: `가격이 평균 대비 낮아요. 가격을 낮춰 잡고 빠진 항목으로 추가 청구하는 패턴이 흔하므로 누락 항목을 꼼꼼히 보세요.`,
      action: "아래 질문을 업체에 그대로 보내고 답변을 받은 뒤 계약 여부를 결정하세요.",
    };
  }

  // 일반 가격대
  if (result.verdict === "danger") {
    return {
      title: `필수 항목 ${result.missingCriticalCount}개가 견적서에서 확인되지 않았어요`,
      text: `빠진 ${result.missingCriticalCount}개 항목 기준으로 약 ${minHidden}~${maxHidden}만원의 추가 청구 가능성이 열려 있어요.`,
      action: "계약금 입금 전 포함/미포함 항목과 추가금 상한을 문자나 계약서로 받아두세요.",
    };
  }

  if (result.verdict === "caution") {
    return {
      title: `확인이 더 필요한 항목이 있어요`,
      text: `가격 자체보다 빠진 항목이 영향을 줄 수 있어요. 특히 필수/고빈도 추가금 항목을 먼저 확인해 보세요.`,
      action: "아래 질문을 업체에 그대로 보내고 답변을 받은 뒤 계약 여부를 결정하세요.",
    };
  }

  return {
    title: `주요 항목이 대체로 견적서에 명시되어 있어요`,
    text: `확인된 항목이 충분하고 예상 추가금 리스크가 낮아요. 취소·변경·원본 제공 조건은 계약서로 남겨두면 안전해요.`,
    action: "계약서에 포함 항목과 환불 기준이 같은 내용으로 적혀 있는지 마지막으로 확인하세요.",
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

  // 가격대 자동 분류 — 사용자 override 있으면 우선 적용
  const priceTierAutoInferred = classifyPriceTier(input.quotePriceManwon, marketMedianManwon);
  const priceTier = input.userPriceTierOverride ?? priceTierAutoInferred;
  const showPriceComparison = priceTier !== "highend";

  const redFlags = [];
  // 미끼 가격 신호 — suspicious_low 분류이거나 가격이 시장 대비 30% 이상 낮으면
  if (priceTier === "suspicious_low" || priceDiffPercent < -30) {
    redFlags.push(RED_FLAGS.find((flag) => flag.id === "bait_pricing"));
  }
  if (missingCritical.length > 0) redFlags.push(RED_FLAGS.find((flag) => flag.id === "essential_as_option"));
  if (included.length < 5) redFlags.push(RED_FLAGS.find((flag) => flag.id === "price_opacity"));

  const summary = getSummaryCopy({
    verdict,
    grade,
    missingCriticalCount: missingCritical.length,
    estimatedHiddenMinManwon,
    estimatedHiddenMaxManwon,
    priceDiffPercent,
    priceTier,
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
    priceTier,
    priceTierAutoInferred,
    showPriceComparison,
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
