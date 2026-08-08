import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import { topicParticle } from "@/lib/korean/particles";
import type { AiComment, PriceData } from "@/types/community.types";

const CATEGORY_LABELS: Record<PriceData["vendor_category"], string> = {
  venue: PLANNING_CATEGORY_LABELS.venue,
  studio: PLANNING_CATEGORY_LABELS.studio,
  dress: PLANNING_CATEGORY_LABELS.dress,
  makeup: PLANNING_CATEGORY_LABELS.makeup,
  snap: PLANNING_CATEGORY_LABELS.snap,
  ring: PLANNING_CATEGORY_LABELS.ring,
  honeymoon: PLANNING_CATEGORY_LABELS.honeymoon,
  other: "기타 항목",
};

export function buildSourceBackedPriceComment(priceData: PriceData): AiComment {
  const now = new Date().toISOString();
  const categoryLabel = CATEGORY_LABELS[priceData.vendor_category] ?? "해당 항목";

  return {
    text: `${categoryLabel}${topicParticle(categoryLabel)} 현재 같은 구성·지역·시점의 공식 비교값이 연결되지 않아 비싸거나 저렴하다고 단정하지 않을게요. 받은 견적의 포함 항목, 따로 내는 금액의 상한, 취소할 때 돌려받는 금액을 문서로 확인하세요.`,
    comparison: "unknown",
    percentage: 0,
    reference: "공식 비교값 미연결 · 가격 수준 판정 안 함",
    generated_at: now,
  };
}
