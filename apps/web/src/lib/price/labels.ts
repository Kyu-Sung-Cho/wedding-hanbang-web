import type { PriceCategory } from "./catalog";

export const PRICE_CATEGORY_LABELS: Record<PriceCategory, string> = {
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
  hall: "웨딩홀",
};

export const PRICE_REGION_OPTIONS = [
  ["seoul_gangnam3", "서울 강남권"],
  ["seoul_etc", "서울 강남 외"],
  ["gyeonggi", "경기"],
  ["incheon", "인천"],
  ["gangwon", "강원"],
  ["chungcheong", "충청"],
  ["daejeon", "대전"],
  ["jeolla", "전라"],
  ["gwangju", "광주"],
  ["gyeongsang", "경상"],
  ["busan", "부산"],
  ["ulsan", "울산"],
  ["daegu", "대구"],
  ["jeju", "제주"],
] as const;

export function priceRegionLabel(regionCode: string | null): string {
  if (!regionCode) return "지역 미표기";
  return PRICE_REGION_OPTIONS.find(([code]) => code === regionCode)?.[1] ?? regionCode;
}
