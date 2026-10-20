import type { SupabaseClient } from "@supabase/supabase-js";
import { createEmptyPriceCatalog } from "./buildCatalog";
import type { PriceVendor } from "./catalog";
import type { SavedComboPreview } from "./savedComboRestore";
import { loadPublicVendorPriceProfile } from "@/lib/vendors/publicVendorPriceData";
import { isUuid } from "@/utils/requestValidation";

/** 목록의 축약본 대신 저장된 최대 세 업체의 현재 공개 상세를 읽는다. */
export async function loadSavedComboRestoreCatalog(client: SupabaseClient, saved: SavedComboPreview) {
  const selections = Object.entries(saved.selections).flatMap(([category, selection]) => selection ? [{ category, selection }] : []);
  const ids = [...new Set(selections.map(({ selection }) => selection.vendorId))];
  if (ids.length < 1 || ids.length > 3 || ids.some((id) => !isUuid(id))) throw new Error("INVALID_SAVED_COMBO");
  const { data, error } = await client.from("v_public_vendors").select("id, slug").in("id", ids);
  if (error || !Array.isArray(data)) throw new Error("SAVED_COMBO_CATALOG_UNAVAILABLE");
  const vendors = data;
  const catalog = createEmptyPriceCatalog();
  const profiles = await Promise.all(ids.map(async (id) => {
    const row = vendors.find((vendor) => vendor.id === id);
    return row ? await loadPublicVendorPriceProfile(client, row.slug, { strictIdentity: true, currentOnly: true }) : null;
  }));
  for (const { category, selection } of selections) {
    if (category !== "studio" && category !== "dress" && category !== "makeup") continue;
    const profile = profiles[ids.indexOf(selection.vendorId)];
    if (!profile || profile.vendor.category !== category) continue;
    const vendor: PriceVendor = {
      id: selection.vendorId,
      slug: profile.identity.canonicalSlug,
      name: profile.vendor.displayName,
      aliases: profile.vendor.aliases,
      category,
      regionCode: profile.vendor.region_code,
      offers: profile.prices.filter((price) => price.is_current && price.category === category).map((price) => ({
        id: price.id,
        itemName: price.item_name,
        agencyId: price.agency?.id ?? null,
        agencyName: price.agency?.name ?? "업체 직접 공시",
        minimumKrw: price.price_min_krw,
        maximumKrw: price.price_max_krw,
        baseSpec: price.base_spec,
        priceNote: [price.vat_note, price.price_note].filter(Boolean).join(" · ") || null,
        options: price.options.map((option) => ({
          id: option.id, name: option.name, minimumKrw: option.price_min_krw, maximumKrw: option.price_max_krw,
          unit: option.unit, condition: option.condition, rawText: option.raw_text,
          isEffectivelyMandatory: option.is_effectively_mandatory, sortOrder: option.sort_order,
        })),
      })),
    };
    catalog.categories[category].push(vendor);
    catalog.counts[category] += 1;
  }
  return catalog;
}
