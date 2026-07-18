import {
  PRICE_CATEGORIES,
  type PriceCatalog,
  type PriceCategory,
  type PriceVendor,
} from "./catalog";

export type OfficialPriceWishlistGroup = {
  category: PriceCategory;
  vendors: PriceVendor[];
};

/**
 * Joins private favorite IDs to the already-public official price catalog.
 * IDs absent from the catalog are deliberately omitted instead of falling
 * back to the legacy vendor API.
 */
export function selectOfficialWishlistedVendors(
  catalog: PriceCatalog,
  favoriteIds: readonly string[],
): OfficialPriceWishlistGroup[] {
  const favoriteOrder = new Map<string, number>();
  favoriteIds.forEach((id, index) => {
    if (!favoriteOrder.has(id)) favoriteOrder.set(id, index);
  });

  return PRICE_CATEGORIES.map((category) => ({
    category,
    vendors: catalog.categories[category]
      .filter(({ id }) => favoriteOrder.has(id))
      .sort((left, right) => (
        (favoriteOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER)
        - (favoriteOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      )),
  }));
}
