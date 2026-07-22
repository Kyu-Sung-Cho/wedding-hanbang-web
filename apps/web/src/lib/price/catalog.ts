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
};

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

function normalizedSearchValue(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

export function filterPriceCatalog(
  vendors: readonly PriceVendor[],
  filter: PriceCatalogFilter,
): PriceVendor[] {
  const query = normalizedSearchValue(filter.search ?? "");
  const agencyIds = new Set(filter.agencyIds ?? []);
  const offersFor = (vendor: PriceVendor) => agencyIds.size === 0
    ? vendor.offers
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
    .filter((vendor) => !query || [vendor.name, ...vendor.aliases]
      .some((value) => normalizedSearchValue(value).includes(query)))
    .filter((vendor) => !filter.regionCode || vendor.regionCode === filter.regionCode)
    .filter((vendor) => agencyIds.size === 0 || offersFor(vendor).length > 0)
    .filter((vendor) => {
      const minimum = minimumFor(vendor);
      if (filter.minimumKrw != null && (minimum === null || minimum < filter.minimumKrw)) return false;
      if (filter.maximumKrw != null && (minimum === null || minimum > filter.maximumKrw)) return false;
      return true;
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
