import { describe, expect, it, vi } from "vitest";

import { slimPriceCatalogOptions, type PriceCatalog, type PriceVendor } from "./catalog";
import {
  catalogForPriceBrowser,
  parseLatestSavedComboPayload,
  restoreSavedComboAgainstCatalog,
  restoreSavedComboWithOptions,
} from "./savedComboRestore";

const catalog: PriceCatalog = {
  periodLabel: "2026Q3",
  categories: {
    studio: [{
      id: "vendor-studio",
      slug: "current-studio",
      name: "현재 스튜디오명",
      aliases: [],
      category: "studio",
      regionCode: null,
      offers: [{
        id: "price-studio",
        agencyId: "agency-a",
        agencyName: "현재 대행사명",
        minimumKrw: 1_200_000,
        maximumKrw: 1_400_000,
        priceNote: null,
        baseSpec: null,
        options: [{
          id: "option-original",
          name: "원본 파일",
          minimumKrw: 100_000,
          maximumKrw: 100_000,
          unit: null,
          condition: null,
          rawText: "원본 파일 10만원",
          isEffectivelyMandatory: false,
        }],
      }],
    }],
    dress: [],
    makeup: [],
    hall: [],
  },
  counts: { studio: 1, dress: 0, makeup: 0, hall: 0 },
  agencies: [{ id: "agency-a", name: "현재 대행사명" }],
};

function payload(overrides: Record<string, unknown> = {}) {
  return {
    combos: [{
      id: "combo-1",
      name: "내 스드메 조합",
      created_at: "2026-07-20T05:00:00.000Z",
      selections: {
        studio: {
          vendor_id: "vendor-studio",
          agency_id: "agency-a",
          base_krw: 1_200_000,
          selected_options: [{ name: "원본 파일", krw: 100_000 }],
          custom_krw: null,
        },
        dress: null,
        makeup: null,
      },
      ...overrides,
    }],
  };
}

describe("saved combo restore", () => {
  it("parses only a bounded, valid latest owner record", () => {
    const result = parseLatestSavedComboPayload(payload());

    expect(result).toMatchObject({
      ok: true,
      combo: {
        id: "combo-1",
        name: "내 스드메 조합",
        selections: {
          studio: {
            vendorId: "vendor-studio",
            agencyId: "agency-a",
            baseKrw: 1_200_000,
          },
        },
      },
    });
    expect(parseLatestSavedComboPayload({ combos: [] })).toEqual({ ok: true, combo: null });
    expect(parseLatestSavedComboPayload(payload({
      selections: { studio: null, dress: null, makeup: null },
    }))).toEqual({ ok: false });
    expect(parseLatestSavedComboPayload({ combos: Array.from({ length: 101 }, () => ({})) }))
      .toEqual({ ok: false });
  });

  it("rebuilds names and links from the current catalog instead of trusting saved labels", () => {
    const parsed = parseLatestSavedComboPayload(payload());
    if (!parsed.ok || !parsed.combo) throw new Error("fixture must parse");

    const restored = restoreSavedComboAgainstCatalog(parsed.combo, catalog);

    expect(restored.restoredCategories).toEqual(["studio"]);
    expect(restored.skippedCategories).toEqual([]);
    expect(restored.selections.studio).toMatchObject({
      vendorId: "vendor-studio",
      vendorSlug: "current-studio",
      vendorName: "현재 스튜디오명",
      agencyName: "현재 대행사명",
      baseKrw: 1_200_000,
      selectedOptions: [{ name: "원본 파일", krw: 100_000 }],
    });
  });

  it("skips deleted or price-drifted selections instead of restoring stale money", () => {
    const parsed = parseLatestSavedComboPayload(payload());
    if (!parsed.ok || !parsed.combo) throw new Error("fixture must parse");
    const changedCatalog: PriceCatalog = {
      ...catalog,
      categories: {
        ...catalog.categories,
        studio: catalog.categories.studio.map((vendor) => ({
          ...vendor,
          offers: vendor.offers.map((offer) => ({ ...offer, minimumKrw: 1_300_000 })),
        })),
      },
    };

    const restored = restoreSavedComboAgainstCatalog(parsed.combo, changedCatalog);

    expect(restored.selections.studio).toBeNull();
    expect(restored.restoredCategories).toEqual([]);
    expect(restored.skippedCategories).toEqual(["studio"]);
  });

  it("keeps non-cheapest offer identities for restoring an inactive category", async () => {
    const original = catalog.categories.studio[0];
    const fullCatalog = { ...catalog, categories: { ...catalog.categories, studio: [{
      ...original, offers: [{ ...original.offers[0], id: "cheapest", minimumKrw: 900_000 }, ...original.offers],
    }] } };
    const browserCatalog = catalogForPriceBrowser(slimPriceCatalogOptions(fullCatalog), "dress");
    expect(browserCatalog.categories.studio[0].offers.map(({ id }) => id))
      .toEqual(["cheapest", "price-studio"]);
    expect(browserCatalog.categories.studio[0].offers.every(({ options }) => options.length === 0)).toBe(true);
    const parsed = parseLatestSavedComboPayload(payload());
    if (!parsed.ok || !parsed.combo) throw new Error("fixture must parse");
    const loader = vi.fn(async (vendor: PriceVendor) => {
      expect(vendor.offers.map(({ id }) => id)).toEqual(["price-studio"]);
      return new Map([["price-studio", original.offers[0].options]]);
    });
    const result = await restoreSavedComboWithOptions(parsed.combo, browserCatalog, loader);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(result.restoredCategories).toEqual(["studio"]);
    expect(result.selections.studio?.selectedOptions).toEqual([{ name: "원본 파일", krw: 100_000 }]);
  });

  it("hydrates only saved candidates even when inactive option counts are unavailable", async () => {
    const browserCatalog = catalogForPriceBrowser(catalog, "dress");
    browserCatalog.categories.studio[0].offers[0].optionCount = undefined;
    const parsed = parseLatestSavedComboPayload(payload());
    if (!parsed.ok || !parsed.combo) throw new Error("fixture must parse");
    const loader = vi.fn(async (vendor: PriceVendor) => {
      expect(vendor.offers.map(({ id }) => id)).toEqual(["price-studio"]);
      expect(vendor.offers[0].optionCount).toBe(1);
      return new Map([["price-studio", catalog.categories.studio[0].offers[0].options]]);
    });
    const result = await restoreSavedComboWithOptions(parsed.combo, browserCatalog, loader);
    expect(result.restoredCategories).toEqual(["studio"]);
    expect(browserCatalog.categories.studio[0].offers[0].options).toEqual([]);
  });

  it("rejects a lookup failure rather than converting it to price drift", async () => {
    const parsed = parseLatestSavedComboPayload(payload());
    if (!parsed.ok || !parsed.combo) throw new Error("fixture must parse");
    await expect(restoreSavedComboWithOptions(parsed.combo, slimPriceCatalogOptions(catalog), async () => {
      throw new Error("unavailable");
    })).rejects.toThrow("unavailable");
  });

  it("checks all same-price offers before declaring a saved add-on unavailable", () => {
    const original = catalog.categories.studio[0];
    const alternatives = { ...catalog, categories: { ...catalog.categories, studio: [{
      ...original, offers: [{ ...original.offers[0], id: "without-addon", options: [] }, ...original.offers],
    }] } };
    const parsed = parseLatestSavedComboPayload(payload());
    if (!parsed.ok || !parsed.combo) throw new Error("fixture must parse");
    expect(restoreSavedComboAgainstCatalog(parsed.combo, alternatives).restoredCategories).toEqual(["studio"]);
  });
});
