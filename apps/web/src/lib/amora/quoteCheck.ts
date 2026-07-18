import { HIDDEN_COSTS, type HiddenCostItem } from "@/constants/hiddenCosts";

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
  checkedItemCount: number;
  missingCriticalCount: number;
  missingHighCount: number;
  missingMediumCount: number;
  includedItems: AmoraQuoteCheckItem[];
  missingItems: AmoraQuoteCheckItem[];
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

function toCheckItem(item: HiddenCostItem): AmoraQuoteCheckItem {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    severity: item.severity,
    checkQuestion: item.checkQuestion,
    reason: item.reason,
    disguise: item.disguise,
  };
}

function getMarketMedian(
  category: AmoraQuoteCategory,
  region: AmoraQuoteRegion,
  scope: AmoraQuoteScope,
): { median: number; comparatorLabel: string } {
  void category;
  void region;
  void scope;
  return {
    median: 0,
    comparatorLabel: "업체별 최신 공시가 확인 필요",
  };
}

// 사실만 기술하는 요약 — 사용자가 체크하지 않은 항목 개수만 말한다.
// 추가금 "추정액 계산"은 하지 않는다(구성을 모르는 채의 합산은 과장/과소가 된다).
function getSummaryCopy(critical: number, high: number, medium: number) {
  const nonCritical = high + medium;
  const total = critical + nonCritical;

  if (total === 0) {
    return {
      title: "체크리스트의 주요 항목이 모두 견적서에 명시되어 있어요",
      text: "확인 안 된 항목이 없어요. 마지막으로 취소·변경·원본 제공 조건이 계약서에 같은 내용으로 적혀 있는지 보면 좋아요.",
      action: "계약서에 포함 항목과 환불 기준이 같은 내용으로 적혀 있는지 마지막으로 확인하세요.",
    };
  }

  const phrase =
    critical > 0 && nonCritical > 0
      ? `핵심 확인 항목 ${critical}개와 추가 확인 항목 ${nonCritical}개`
      : critical > 0
        ? `핵심 확인 항목 ${critical}개`
        : `추가 확인 항목 ${nonCritical}개`;

  return {
    title:
      critical > 0
        ? `핵심 확인 항목 ${critical}개가 견적서에서 확인되지 않았어요`
        : `추가 확인 항목 ${nonCritical}개가 견적서에서 확인되지 않았어요`,
    text: `${phrase}이 현재 입력한 견적서에서 확인되지 않았어요. 비용이 생긴다는 뜻은 아니므로, 계약 전에 포함 여부와 미포함 시 금액·상한을 서면으로 확인해두세요.`,
    action:
      "아래 질문을 업체에 그대로 보내고, 항목별 포함 여부와 추가금 상한을 문자나 계약서로 받아두세요. 계약 판단은 그 답을 보고 하면 돼요.",
  };
}

export function getQuoteCheckItems(
  category: AmoraQuoteCategory,
  region: AmoraQuoteRegion
): AmoraQuoteCheckItem[] {
  void region; // Kept in the public API for callers; item questions are region-independent.
  return getRelevantCosts(category).map((item) => toCheckItem(item));
}

export function analyzeAmoraQuoteCheck(input: AmoraQuoteCheckInput): AmoraQuoteCheckResult {
  const scope = regionToScope(input.region);
  const allItems = getRelevantCosts(input.category);
  const includedIdSet = new Set(input.includedItemIds);
  const included = allItems.filter((item) => includedIdSet.has(item.id));
  const missing = allItems.filter((item) => !includedIdSet.has(item.id));
  const { median: marketMedianManwon, comparatorLabel: marketComparatorLabel } = getMarketMedian(
    input.category,
    input.region,
    scope
  );
  const priceDiffPercent =
    marketMedianManwon > 0
      ? Math.round(((input.quotePriceManwon - marketMedianManwon) / marketMedianManwon) * 100)
      : 0;

  const missingCritical = missing.filter((item) => item.severity === "critical");
  const missingHigh = missing.filter((item) => item.severity === "high");
  const missingMedium = missing.filter((item) => item.severity === "medium");

  const summary = getSummaryCopy(missingCritical.length, missingHigh.length, missingMedium.length);

  const contractQuestions = [...missingCritical, ...missingHigh]
    .slice(0, 6)
    .map((item) => item.checkQuestion);

  return {
    category: input.category,
    scope,
    quotePriceManwon: input.quotePriceManwon,
    marketMedianManwon,
    marketComparatorLabel,
    priceDiffPercent,
    checkedItemCount: included.length,
    missingCriticalCount: missingCritical.length,
    missingHighCount: missingHigh.length,
    missingMediumCount: missingMedium.length,
    includedItems: included.map((item) => toCheckItem(item)),
    missingItems: missing.map((item) => toCheckItem(item)),
    summaryTitle: summary.title,
    summaryText: summary.text,
    recommendedAction: summary.action,
    contractQuestions,
    negotiationScript:
      "안녕하세요. 계약 전 확인차 문의드립니다. 아래 항목들이 견적에 포함인지, 미포함이면 항목별 추가금과 최대 상한이 얼마인지 문자로 남겨주실 수 있을까요?",
    sourceNote:
      "이 결과는 웨딩한방 계약 전 체크리스트만 확인하며 가격의 적정성을 판정하지 않습니다. 최신 업체별 공시가는 ‘업체 공시가’에서 출처와 기준 시점을 확인하고, 실제 추가 비용은 업체 서면 견적을 확인하세요.",
  };
}
