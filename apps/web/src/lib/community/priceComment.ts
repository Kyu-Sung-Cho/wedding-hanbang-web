import { PRICE_PERIODS, getCategoryMarketPrice, getLatestPeriodId } from "@/constants/marketPrices";
import { topicParticle } from "@/lib/korean/particles";
import type { AiComment, PriceData } from "@/types/community.types";

const CATEGORY_LABELS: Record<PriceData["vendor_category"], string> = {
  venue: "예식장",
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
  snap: "본식 촬영",
  ring: "예물",
  honeymoon: "신혼여행",
  other: "기타 항목",
};

const PUBLIC_BENCHMARK_KEYS: Partial<Record<PriceData["vendor_category"], string>> = {
  venue: "venue",
  studio: "studio",
  dress: "dress",
  makeup: "makeup",
  snap: "snap",
};

function inferScope(region?: string): "national" | "seoul" {
  if (!region) return "national";
  return /서울|강남|강북|마포|송파|서초|종로|용산|성수|청담|압구정/.test(region) ? "seoul" : "national";
}

function formatManwon(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString("ko-KR");
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
}

function compareAgainstBenchmark(totalPrice: number, benchmark: number): AiComment["comparison"] {
  const ratio = totalPrice / benchmark;
  if (ratio < 0.85) return "below";
  if (ratio > 1.15) return "above";
  return "average";
}

export function buildSourceBackedPriceComment(priceData: PriceData): AiComment {
  const now = new Date().toISOString();
  const basePrice = Number(priceData.base_price);
  const extraPrice = Number(priceData.extra_price ?? 0);
  const totalPrice = Math.max(0, basePrice + (Number.isFinite(extraPrice) ? extraPrice : 0));
  const categoryLabel = CATEGORY_LABELS[priceData.vendor_category] ?? "해당 항목";
  const benchmarkKey = PUBLIC_BENCHMARK_KEYS[priceData.vendor_category];
  const scope = inferScope(priceData.region);
  const scopeLabel = scope === "seoul" ? "서울" : "전국";
  const periodId = getLatestPeriodId();
  const periodLabel = PRICE_PERIODS.find((period) => period.id === periodId)?.label ?? "최신";

  if (!Number.isFinite(basePrice) || basePrice <= 0 || !benchmarkKey) {
    return {
      text: `${categoryLabel}${topicParticle(categoryLabel)} 현재 공식 비교 기준이 충분히 연결되지 않아 평균 단정은 하지 않을게요. 입력한 금액 기준으로 포함 항목, 추가금 상한, 환불 조건을 계약 전 문서로 확인하세요.`,
      comparison: "unknown",
      percentage: 0,
      reference: "공식 비교 기준 부족 · 평균 단정 안 함",
      generated_at: now,
    };
  }

  const benchmark = getCategoryMarketPrice(benchmarkKey, scope);
  if (!benchmark || benchmark <= 0) {
    return {
      text: `${categoryLabel}${topicParticle(categoryLabel)} 현재 ${scopeLabel} 공식 비교값을 찾지 못해 평균 단정은 하지 않을게요. 받은 견적의 포함 항목과 추가금 상한을 먼저 확인하세요.`,
      comparison: "unknown",
      percentage: 0,
      reference: "공식 비교 기준 부족 · 평균 단정 안 함",
      generated_at: now,
    };
  }

  const comparison = compareAgainstBenchmark(totalPrice, benchmark);
  const percentage = Math.round((totalPrice / benchmark) * 100);
  const position =
    comparison === "below"
      ? "공개 기준보다 낮은 편"
      : comparison === "above"
        ? "공개 기준보다 높은 편"
        : "공개 기준과 비슷한 편";
  const followup =
    comparison === "below"
      ? "낮은 견적일수록 빠진 항목과 추가금 상한을 꼭 확인하세요."
      : "포함 항목과 추가금 상한을 계약 전 문서로 확인하세요.";

  return {
    text: `${categoryLabel} 총액 ${formatManwon(totalPrice)}만원은 ${periodLabel} ${scopeLabel} 참가격 기준 ${formatManwon(benchmark)}만원 대비 ${position}입니다. ${followup}`,
    comparison,
    percentage,
    reference: `한국소비자원 참가격 ${periodLabel} ${scopeLabel} ${categoryLabel} 기준 ${formatManwon(benchmark)}만원`,
    generated_at: now,
  };
}
