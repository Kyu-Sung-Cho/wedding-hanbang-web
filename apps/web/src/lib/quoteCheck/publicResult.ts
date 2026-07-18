import type {
  AmoraQuoteCategory,
  AmoraQuoteCheckResult,
} from "@/lib/amora/quoteCheck";

export const PUBLIC_QUOTE_SOURCE_NOTE =
  "이 결과는 웨딩한방 계약 전 체크리스트만 확인하며 가격의 적정성을 판정하지 않습니다. 최신 업체별 공시가는 ‘업체 공시가’에서 출처와 기준 시점을 확인하고, 실제 추가 비용은 업체 서면 견적을 확인하세요.";

export type PublicQuoteAnalysis = Pick<
  AmoraQuoteCheckResult,
  | "category"
  | "quotePriceManwon"
  | "marketMedianManwon"
  | "marketComparatorLabel"
  | "priceDiffPercent"
  | "missingCriticalCount"
  | "missingHighCount"
  | "missingMediumCount"
  | "summaryTitle"
  | "summaryText"
  | "sourceNote"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number | null {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    && value <= 1_000
    ? value
    : null;
}

/**
 * Saved quote JSON predates the runtime disclosure pipeline. Treat it as an
 * untrusted compatibility payload and never republish its aggregate prices.
 */
export function normalizePublicQuoteAnalysis(
  value: unknown,
  fallbackCategory: AmoraQuoteCategory,
): PublicQuoteAnalysis | null {
  if (!isRecord(value)) return null;

  const quotePriceManwon = value.quotePriceManwon;
  if (
    typeof quotePriceManwon !== "number"
    || !Number.isFinite(quotePriceManwon)
    || quotePriceManwon <= 0
    || quotePriceManwon > 10_000
  ) {
    return null;
  }

  const missingCriticalCount = count(value.missingCriticalCount);
  const missingHighCount = count(value.missingHighCount);
  const missingMediumCount = count(value.missingMediumCount);
  if (
    missingCriticalCount === null
    || missingHighCount === null
    || missingMediumCount === null
  ) {
    return null;
  }

  const nonCriticalCount = missingHighCount + missingMediumCount;
  const missingTotal = missingCriticalCount + missingHighCount + missingMediumCount;
  const summaryTitle = missingTotal === 0
    ? "체크리스트의 주요 항목이 견적서에 명시되어 있어요"
    : missingCriticalCount > 0
      ? `핵심 확인 항목 ${missingCriticalCount}개가 견적서에서 확인되지 않았어요`
      : `추가 확인 항목 ${nonCriticalCount}개가 견적서에서 확인되지 않았어요`;
  const summaryText = missingTotal === 0
    ? "확인 안 된 항목이 없어요. 마지막으로 취소·변경·원본 제공 조건이 계약서에 같은 내용으로 적혀 있는지 보면 좋아요."
    : "현재 입력한 견적서에서 확인되지 않은 항목이 있어요. 비용이 생긴다는 뜻은 아니므로 계약 전에 포함 여부와 미포함 시 금액·상한을 서면으로 확인해두세요.";

  return {
    category: fallbackCategory,
    quotePriceManwon,
    marketMedianManwon: 0,
    marketComparatorLabel: "업체별 최신 공시가 확인 필요",
    priceDiffPercent: 0,
    missingCriticalCount,
    missingHighCount,
    missingMediumCount,
    summaryTitle,
    summaryText,
    sourceNote: PUBLIC_QUOTE_SOURCE_NOTE,
  };
}
