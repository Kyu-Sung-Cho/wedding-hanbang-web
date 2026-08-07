export const PRICE_CATEGORIES = ["studio", "dress", "makeup", "hall"] as const;
export type PriceCategory = (typeof PRICE_CATEGORIES)[number];

export type PriceOption = {
  id: string;
  name: string;
  minimumKrw: number | null;
  maximumKrw: number | null;
  unit: string | null;
  condition: string | null;
  rawText: string;
  isEffectivelyMandatory: boolean;
  sortOrder?: number;
};

export type PriceOffer = {
  id: string;
  itemName?: string;
  agencyId: string | null;
  agencyName: string;
  minimumKrw: number | null;
  maximumKrw: number | null;
  priceNote: string | null;
  baseSpec: string | null;
  options: PriceOption[];
  /** 목록 전송 다이어트: 옵션 본문을 비우고 개수만 실어 보낼 때의 개수. */
  optionCount?: number;
};

/** 오퍼의 옵션 개수 — 본문이 비워진(지연 로드) 오퍼는 optionCount를 신뢰한다. */
export function offerOptionCount(offer: PriceOffer): number {
  return offer.options.length > 0 ? offer.options.length : offer.optionCount ?? 0;
}

/**
 * 목록 페이지 전송 다이어트: 옵션 본문(원문 인용 포함)을 비우고 개수만 남긴다.
 * 본문은 카드의 "추가금" 펼침 시 /api/price/vendor-options로 지연 로드한다.
 * 상세 페이지는 슬림하지 않으므로 원문 근거 SEO는 그대로 유지된다.
 */
export function slimPriceCatalogOptions(catalog: PriceCatalog): PriceCatalog {
  const categories = {} as Record<PriceCategory, PriceVendor[]>;
  for (const category of PRICE_CATEGORIES) {
    categories[category] = catalog.categories[category].map((vendor) => ({
      ...vendor,
      offers: vendor.offers.map((offer) => ({
        ...offer,
        optionCount: offer.options.length,
        options: [],
      })),
    }));
  }
  return { ...catalog, categories };
}

export type PricePolicyType = "penalty" | "refund" | "change" | "other";

export type PricePolicy = {
  id: string;
  type: PricePolicyType;
  title: string | null;
  summary: string | null;
  content: string;
};

const PRICE_POLICY_LABELS: Record<PricePolicyType, string> = {
  penalty: "위약금 규정",
  refund: "환불 규정",
  change: "변경 규정",
  other: "기타 계약 규정",
};

export function pricePolicyLabel(type: PricePolicyType): string {
  return PRICE_POLICY_LABELS[type];
}

const PRICE_POLICY_BADGE_CLASSES: Record<PricePolicyType, string> = {
  penalty: "bg-danger-500/10 text-danger-700",
  refund: "bg-sage-pale/45 text-noir-800",
  change: "bg-gold-light/55 text-taupe-500",
  other: "bg-ivory-200 text-taupe-500",
};

export function pricePolicyBadgeClass(type: PricePolicyType): string {
  return PRICE_POLICY_BADGE_CLASSES[type];
}

export type PriceVendor = {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  category: PriceCategory;
  regionCode: string | null;
  /**
   * 같은 업체를 취급하는 대행사들의 지역 전체.
   *
   * 스드메 공시 원본은 대행사별 파일이라 업체의 지역값은 "그 샵이 어디 있는지"가
   * 아니라 "어느 대행사를 통하는지"다(2026-07-26 원본 1,551행 확인: 샵 주소는
   * 0건). 그래서 같은 샵이 대행사 지역마다 다른 카드로 갈려 있었다. 병합한 뒤에는
   * 한 지역만 대표로 내세울 수 없으므로 닿을 수 있는 지역을 모두 들고 다닌다.
   */
  regionCodes?: string[];
  /**
   * 공시 의무 주체(법인). 업체명 괄호에서 떼어낸 값이다 — 지우지 않고 옮긴다.
   * 예: `빌라드지디 논현(라비에벨(주))` → name `빌라드지디 논현` · 이 값 `라비에벨(주)`.
   */
  disclosureEntity?: string | null;
  offers: PriceOffer[];
  policies?: PricePolicy[];
};

export type PriceCatalog = {
  periodLabel: string;
  categories: Record<PriceCategory, PriceVendor[]>;
  counts: Record<PriceCategory, number>;
  agencies: Array<{ id: string; name: string }>;
};

export type PriceCatalogFilter = {
  search?: string;
  regionCode?: string | null;
  agencyIds?: readonly string[];
  minimumKrw?: number | null;
  maximumKrw?: number | null;
  wishlistOnly?: boolean;
  wishlistedIds?: ReadonlySet<string>;
  sort?: "name" | "lowest_price";
};

/**
 * 서로 비교할 수 있는 오퍼만. **가격 주장에는 이것만 쓴다.**
 *
 * 대행사 없는 행(`agencyId === null`)은 이 업체를 그 값에 살 수 있다는 뜻이 아니다.
 * 실측(2026-08-07 운영 17행): 전부 예식장 공시에서 온 패키지 구성이고 단위가 다르다.
 *   루미디아          "1벌당 30만~70만" 추가금 — 대행사 6곳은 전부 150만 단일가인데
 *                    이 행이 최저가가 되어 카드가 "30만원부터"라고 주장했다(5배 차이).
 *   그가사랑하는순간   "스드메 280만 패키지"(스튜디오+드레스+메이크업 합계)가
 *                    스튜디오 단품가로 들어와 최고가를 부풀렸다.
 * 지우지는 않는다 — 공시된 사실이라 카드에 원문 그대로 계속 보인다. 다만 범위·정렬·
 * 예산 조합·필터 같은 **"얼마다"라고 말하는 자리**에서는 뺀다.
 */
export function comparableOffers(vendor: PriceVendor): PriceOffer[] {
  return vendor.offers.filter((offer) => offer.agencyId !== null);
}

/**
 * 이 업체에 닿을 수 있는 지역 전체.
 * 병합된 카드는 regionCodes를, 아직 병합 전이거나 단일 지역인 업체는
 * regionCode 하나를 갖는다 — 필터는 둘 다 같은 방식으로 다뤄야 한다.
 */
export function vendorRegionCodes(vendor: PriceVendor): string[] {
  if (vendor.regionCodes && vendor.regionCodes.length > 0) return vendor.regionCodes;
  return vendor.regionCode ? [vendor.regionCode] : [];
}

function normalizedSearchValue(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

export function filterPriceCatalog(
  vendors: readonly PriceVendor[],
  filter: PriceCatalogFilter,
): PriceVendor[] {
  const query = normalizedSearchValue(filter.search ?? "");
  const agencyIds = new Set(filter.agencyIds ?? []);
  // 대행사를 안 골랐어도 **비교 가능한 오퍼만** 본다 — 전체 오퍼를 쓰면 예식장
  // 패키지 행이 정렬·가격대 필터의 기준이 되어 없는 가격을 주장하게 된다.
  const offersFor = (vendor: PriceVendor) => agencyIds.size === 0
    ? comparableOffers(vendor)
    : vendor.offers.filter(({ agencyId }) => agencyId !== null && agencyIds.has(agencyId));
  const minimumFor = (vendor: PriceVendor) => offersFor(vendor).reduce<number | null>(
    (minimum, offer) => offer.minimumKrw === null
      ? minimum
      : minimum === null
        ? offer.minimumKrw
        : Math.min(minimum, offer.minimumKrw),
    null,
  );

  return vendors
    // 공시주체(법인)도 검색 대상이다 — 이름에서 뗐다고 `라비에벨`로 찾던 사람이
    // 못 찾게 되면 정리가 손해가 된다.
    .filter((vendor) => !query || [vendor.name, vendor.disclosureEntity ?? "", ...vendor.aliases]
      .some((value) => value && normalizedSearchValue(value).includes(query)))
    // 병합된 업체는 여러 대행사 지역에서 닿을 수 있다 — 하나라도 맞으면 노출한다.
    .filter((vendor) => !filter.regionCode
      || vendorRegionCodes(vendor).includes(filter.regionCode))
    .filter((vendor) => agencyIds.size === 0 || offersFor(vendor).length > 0)
    .filter((vendor) => {
      // 예산대 탐색은 "이 예산으로 살 수 있는 상품이 있는가"를 묻는 것이다.
      // 업체 최저가 하나만 보면 150만·250만 상품을 가진 업체가 "200~300만"
      // 검색에서 빠져, 사실상 저가 상품 보유 업체를 제외하는 필터가 된다.
      if (filter.minimumKrw == null && filter.maximumKrw == null) return true;
      return offersFor(vendor).some((offer) => {
        if (offer.minimumKrw === null && offer.maximumKrw === null) return false;
        const low = offer.minimumKrw ?? offer.maximumKrw!;
        const high = offer.maximumKrw ?? offer.minimumKrw!;
        if (filter.minimumKrw != null && high < filter.minimumKrw) return false;
        if (filter.maximumKrw != null && low > filter.maximumKrw) return false;
        return true;
      });
    })
    .filter((vendor) => !filter.wishlistOnly || filter.wishlistedIds?.has(vendor.id) === true)
    .sort((left, right) => {
      if (filter.sort === "lowest_price") {
        const leftMinimum = minimumFor(left);
        const rightMinimum = minimumFor(right);
        if (leftMinimum !== rightMinimum) {
          if (leftMinimum === null) return 1;
          if (rightMinimum === null) return -1;
          return leftMinimum - rightMinimum;
        }
      }
      return left.name.localeCompare(right.name, "ko-KR") || left.id.localeCompare(right.id);
    });
}
