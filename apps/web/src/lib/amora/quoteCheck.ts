import { HIDDEN_COSTS, type HiddenCostItem } from "@/constants/hiddenCosts";
import {
  PRICE_PERIODS,
  SDM_PACKAGES,
  getCategoryMarketPrice,
  getLatestPeriodId,
} from "@/constants/marketPrices";

export type AmoraQuoteCategory = "sdm_package" | "studio" | "dress" | "makeup";
export type AmoraQuoteRegion = "seoul" | "gyeonggi" | "busan" | "daegu" | "other";
export type AmoraQuoteScope = "national" | "seoul";

// 원칙: 이 엔진은 "판정"하지 않는다.
// 점수·등급·안전/위험·가격대 분류는 견적 구성을 모르는 채로는 정확할 수 없고,
// 틀린 판정 한 번이 신뢰를 끝낸다(+ 표시광고 리스크). 남기는 것은 사실뿐이다:
//   ① 견적서에서 확인된/안 된 항목 (사용자 입력 기반)
//   ② 같은 지역 중위가 (공식 참가격, 참고 표시 전용 — 비교 기준을 라벨로 명시)
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

// 한국소비자원 스드메 패키지 통계의 지역 구분에 입력 지역을 매핑.
// 서울(350만원대)과 경기/인천(240만원대, 2026-05)은 중위가가 40%대 후반 차이나므로
// scope(서울/전국) 2분법으로 뭉개면 참고치가 정반대로 읽힐 수 있다 — 지역별 비교가 필수.
const SDM_REGION_BY_QUOTE_REGION: Record<AmoraQuoteRegion, string> = {
  seoul: "서울",
  gyeonggi: "경기/인천",
  busan: "5대광역시",
  daegu: "5대광역시",
  other: "기타지역",
};

function findSdmPackageRow(region: AmoraQuoteRegion) {
  const pid = getLatestPeriodId();
  const sdmRegion = SDM_REGION_BY_QUOTE_REGION[region];
  return (
    SDM_PACKAGES.find((row) => row.periodId === pid && row.region === sdmRegion) ??
    SDM_PACKAGES.find((row) => row.periodId === pid && row.region === "전체")
  );
}

function getMarketMedian(
  category: AmoraQuoteCategory,
  region: AmoraQuoteRegion,
  scope: AmoraQuoteScope
): { median: number; comparatorLabel: string } {
  const scopeLabel = scope === "seoul" ? "서울" : "전국";

  // 스드메 패키지·스튜디오는 지역별 패키지 통계가 있으므로 그것과 비교 —
  // "패키지 견적 vs 패키지 중위가"로 비교 단위를 일치시킨다.
  if (category === "sdm_package") {
    const row = findSdmPackageRow(region);
    return {
      median: row?.packageMedian ?? 0,
      comparatorLabel: `${row?.region ?? scopeLabel} 스드메 패키지 중위가`,
    };
  }
  if (category === "studio") {
    const row = findSdmPackageRow(region);
    return {
      median: row?.studioBasic ?? getCategoryMarketPrice("studio", scope) ?? 0,
      comparatorLabel: `${row?.region ?? scopeLabel} 스튜디오 기본촬영 중위가`,
    };
  }

  // 드레스·메이크업은 전국/서울 2단계 통계만 존재 — 비교 기준 항목을 명시한다.
  if (category === "dress") {
    return {
      median: getCategoryMarketPrice("dress", scope) ?? 0,
      comparatorLabel: `${scopeLabel} 본식 드레스 대여 중위가`,
    };
  }
  return {
    median: getCategoryMarketPrice("makeup", scope) ?? 0,
    comparatorLabel: `${scopeLabel} 촬영 메이크업 중위가`,
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

  const period = PRICE_PERIODS.find((item) => item.id === getLatestPeriodId());

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
    sourceNote: `가격 비교는 한국소비자원 참가격 결혼서비스 통계 ${period?.label ?? ""} 기준(https://www.price.go.kr/tprice/portal/wedding/areaStatistic.do)이며, 확인 항목은 웨딩한방 계약 전 체크리스트입니다. 항목별 실제 추가 비용은 업체 서면 견적을 확인해야 합니다.`,
  };
}
