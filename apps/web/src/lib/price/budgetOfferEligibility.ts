import type { PriceOffer, PriceVendor } from "./catalog";

const PARENT_AUDIENCE = /혼주|부모님|어머님|아버님|어머니|아버지/u;
const BRIDAL_AUDIENCE = /신부/u;

/** 명시된 상품 대상만 판정한다. 부가 안내(예: 혼주 별도 문의)는 대상 근거가 아니다. */
export function isWeddingBudgetOffer(vendor: PriceVendor, offer: PriceOffer): boolean {
  if (vendor.category !== "makeup") return true;
  const label = offer.itemName?.trim() || vendor.name;
  if (PARENT_AUDIENCE.test(label)) return BRIDAL_AUDIENCE.test(label);
  if (!BRIDAL_AUDIENCE.test(label) && PARENT_AUDIENCE.test(vendor.name)) return BRIDAL_AUDIENCE.test(vendor.name);
  // 상품명에 대상이 없을 때만 기본 구성의 명시적 대상도 확인한다.
  if (!BRIDAL_AUDIENCE.test(label) && PARENT_AUDIENCE.test(offer.baseSpec ?? "")) {
    return BRIDAL_AUDIENCE.test(offer.baseSpec ?? "");
  }
  return true;
}
