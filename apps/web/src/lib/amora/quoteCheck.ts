import {
  QUOTE_CHECK_ITEMS,
  QUOTE_CHECK_SURVEY_REFERENCE,
  type QuoteCheckItem,
} from "@/constants/hiddenCosts";

export type AmoraQuoteCategory = "sdm_package" | "studio" | "dress" | "makeup";
export type AmoraQuoteRegion = "seoul" | "gyeonggi" | "busan" | "daegu" | "other";

// 이 엔진은 가격·필수성·위험을 판정하지 않는다. 사용자가 표시한 포함 여부와
// 아직 확인하지 않은 질문만 정리한다. 체크하지 않은 항목은 "미포함"이 아니다.
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
  category: QuoteCheckItem["category"];
  checkQuestion: string;
}

export interface AmoraQuoteCheckResult {
  category: AmoraQuoteCategory;
  quotePriceManwon: number;
  checkedItemCount: number;
  unconfirmedItemCount: number;
  includedItems: AmoraQuoteCheckItem[];
  unconfirmedItems: AmoraQuoteCheckItem[];
  summaryTitle: string;
  summaryText: string;
  recommendedAction: string;
  contractQuestions: string[];
  negotiationScript: string;
  sourceNote: string;
  sourceUrl: string;
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

const CATEGORY_RELEVANT_ITEMS: Record<AmoraQuoteCategory, QuoteCheckItem["category"][]> = {
  sdm_package: ["studio", "dress", "makeup", "common"],
  studio: ["studio"],
  dress: ["dress"],
  makeup: ["makeup"],
};

function getRelevantItems(category: AmoraQuoteCategory): QuoteCheckItem[] {
  const categories = CATEGORY_RELEVANT_ITEMS[category];
  return QUOTE_CHECK_ITEMS.filter((item) => categories.includes(item.category));
}

function toCheckItem(item: QuoteCheckItem): AmoraQuoteCheckItem {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    checkQuestion: item.checkQuestion,
  };
}

function getSummaryCopy(unconfirmedCount: number) {
  if (unconfirmedCount === 0) {
    return {
      title: "선택한 확인 항목을 모두 포함으로 표시했어요",
      text: "이 결과는 사용자가 직접 표시한 내용이며 계약서를 검증한 결과는 아니에요. 포함 범위와 취소·변경 조건이 계약서에도 같은 내용으로 적혀 있는지 확인하세요.",
      action: "업체 답변과 계약서의 포함 범위·추가 비용 조건이 일치하는지 마지막으로 확인하세요.",
    };
  }

  return {
    title: `${unconfirmedCount}개 항목의 포함 여부를 더 확인해보세요`,
    text: `체크하지 않은 ${unconfirmedCount}개 항목은 미포함 판정이 아니라 아직 확인되지 않은 항목이에요. ${QUOTE_CHECK_SURVEY_REFERENCE.label}에서는 스드메 기본금 평균 ${QUOTE_CHECK_SURVEY_REFERENCE.basicPriceManwon}만원 외 추가 지불이 평균 ${QUOTE_CHECK_SURVEY_REFERENCE.additionalPaymentManwon}만원으로 조사됐습니다. 이 총괄 수치는 개별 항목의 가격이나 발생 가능성을 뜻하지 않아요.`,
    action: "아래 질문을 업체에 보내고, 해당하는 항목의 포함 범위와 추가 조건을 문자나 계약서로 받아두세요.",
  };
}

export function getQuoteCheckItems(
  category: AmoraQuoteCategory,
  _region: AmoraQuoteRegion
): AmoraQuoteCheckItem[] {
  void _region;
  return getRelevantItems(category).map(toCheckItem);
}

export function analyzeAmoraQuoteCheck(input: AmoraQuoteCheckInput): AmoraQuoteCheckResult {
  const allItems = getRelevantItems(input.category);
  const validIdSet = new Set(allItems.map((item) => item.id));
  const includedIdSet = new Set(input.includedItemIds.filter((id) => validIdSet.has(id)));
  const included = allItems.filter((item) => includedIdSet.has(item.id));
  const unconfirmed = allItems.filter((item) => !includedIdSet.has(item.id));
  const summary = getSummaryCopy(unconfirmed.length);

  return {
    category: input.category,
    quotePriceManwon: input.quotePriceManwon,
    checkedItemCount: included.length,
    unconfirmedItemCount: unconfirmed.length,
    includedItems: included.map(toCheckItem),
    unconfirmedItems: unconfirmed.map(toCheckItem),
    summaryTitle: summary.title,
    summaryText: summary.text,
    recommendedAction: summary.action,
    contractQuestions: unconfirmed.slice(0, 6).map((item) => item.checkQuestion),
    negotiationScript:
      "안녕하세요. 계약 전 포함 범위를 확인하려고 합니다. 아래 항목이 견적에 포함되는지, 별도라면 적용 조건과 금액을 문자로 알려주실 수 있을까요?",
    sourceNote: `${QUOTE_CHECK_SURVEY_REFERENCE.label}: 스드메 기본금 평균 ${QUOTE_CHECK_SURVEY_REFERENCE.basicPriceManwon}만원, 추가 지불 평균 ${QUOTE_CHECK_SURVEY_REFERENCE.additionalPaymentManwon}만원. ${QUOTE_CHECK_SURVEY_REFERENCE.note} 항목 목록은 웨딩한방이 편집한 계약 확인 질문입니다.`,
    sourceUrl: QUOTE_CHECK_SURVEY_REFERENCE.url,
  };
}
