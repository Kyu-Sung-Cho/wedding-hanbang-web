import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { filterPriceCatalog } from "./catalog";
import { loadPublicPriceCatalog } from "./publicListData";

function fakePublicClient(fixtures: Record<string, Array<Record<string, unknown>>>) {
  const client = {
    from(table: string) {
      let rows = [...(fixtures[table] ?? [])];
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return query;
      };
      query.not = (column: string, operator: string, value: unknown) => {
        if (operator === "is" && value === null) rows = rows.filter((row) => row[column] !== null);
        return query;
      };
      query.in = (column: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(row[column]));
        return query;
      };
      query.order = () => query;
      query.range = (from: number, to: number) => Promise.resolve({
        data: rows.slice(from, to + 1),
        error: null,
      });
      return query;
    },
  } as unknown as SupabaseClient;
  return client;
}

describe("loadPublicPriceCatalog", () => {
  it("loads only the requested public-price categories for an Amora evidence query", async () => {
    const base = {
      period_label: "2026Q3",
      source: "kca_tprice",
      is_current: true,
      region_code: "seoul_etc",
      agency_id: "agency-1",
      agency_name: "공시 대행사",
      agency_display_name: "공시 대행사",
      price_min_krw: 1_000_000,
      price_max_krw: 1_000_000,
      price_note: null,
      vat_note: null,
      base_spec: "기본 구성",
      vendor_aliases: [],
    };
    const client = fakePublicClient({
      v_public_official_prices: [
        {
          ...base,
          id: "studio-price",
          vendor_id: "studio-vendor",
          vendor_slug: "studio-vendor",
          vendor_name: "공시 스튜디오",
          vendor_category: "studio",
          price_category: "studio",
          item_name: "촬영 기본 구성",
        },
        {
          ...base,
          id: "dress-price",
          vendor_id: "dress-vendor",
          vendor_slug: "dress-vendor",
          vendor_name: "공시 드레스",
          vendor_category: "dress",
          price_category: "dress",
          item_name: "드레스 기본 구성",
        },
      ],
    });

    const catalog = await loadPublicPriceCatalog(client, {
      optionCategories: [],
      priceCategories: ["studio"],
    });

    expect(catalog.counts).toEqual({ studio: 1, dress: 0, makeup: 0, hall: 0 });
  });

  it("groups current prices with approved raw option text but no source quotes", async () => {
    const base = {
      snapshot_id: "snapshot-current",
      period_label: "2026Q3",
      source: "kca_tprice",
      published_at: "2026-07-01",
      is_current: true,
      region_code: "seoul_etc",
      price_max_krw: 1_200_000,
      price_note: null,
      base_spec: "샘플 기본 구성",
    };
    const client = fakePublicClient({
      v_public_official_prices: [
        {
          ...base,
          id: "price-studio",
          vendor_id: "vendor-studio",
          vendor_slug: "sample-studio",
          vendor_name: "샘플 스튜디오",
          vendor_aliases: ["샘플 옛 상호"],
          vendor_category: "studio",
          agency_id: "agency-1",
          agency_name: "샘플 대행사 주식회사",
          agency_display_name: "샘플 대행사",
          price_category: "studio",
          item_name: "샘플 기본 촬영",
          price_min_krw: 1_000_000,
        },
        {
          ...base,
          id: "price-dress",
          vendor_id: "vendor-dress",
          vendor_slug: "sample-dress",
          vendor_name: "샘플 드레스",
          vendor_category: "dress",
          agency_id: null,
          agency_name: null,
          price_category: "dress",
          item_name: "샘플 기본 드레스",
          price_min_krw: 800_000,
        },
        {
          ...base,
          id: "price-draft",
          snapshot_id: "snapshot-draft",
          is_current: false,
          vendor_id: "vendor-draft",
          vendor_slug: "sample-draft",
          vendor_name: "샘플 미발행",
          vendor_category: "studio",
          agency_id: null,
          agency_name: null,
          price_category: "studio",
          item_name: "샘플 미발행 가격",
          price_min_krw: 500_000,
        },
      ],
      v_public_official_price_options: [
        {
          id: "option-1",
          official_price_id: "price-studio",
          name: "샘플 원본 제공",
          price_min_krw: 100_000,
          price_max_krw: 100_000,
          unit: null,
          condition: null,
          raw_text: "샘플 원본 제공 10만원",
          source_quote: "샘플 원본 제공 10만원",
          is_effectively_mandatory: true,
          sort_order: 2,
        },
        {
          id: "option-0",
          official_price_id: "price-studio",
          name: "샘플 선행 옵션",
          price_min_krw: 200_000,
          price_max_krw: 200_000,
          unit: null,
          condition: null,
          raw_text: "샘플 선행 옵션 20만원",
          source_quote: "샘플 선행 옵션 20만원",
          is_effectively_mandatory: false,
          sort_order: 1,
        },
        {
          id: "option-dress",
          official_price_id: "price-dress",
          name: "샘플 드레스 옵션",
          price_min_krw: 300_000,
          price_max_krw: 300_000,
          unit: null,
          condition: null,
          raw_text: "샘플 드레스 옵션 30만원",
          source_quote: "샘플 드레스 옵션 30만원",
          is_effectively_mandatory: false,
          sort_order: 1,
        },
      ],
    });

    const catalog = await loadPublicPriceCatalog(client, { optionCategories: ["studio"] });

    expect(catalog.periodLabel).toBe("2026Q3");
    expect(catalog.counts).toEqual({ studio: 1, dress: 1, makeup: 0, hall: 0 });
    expect(catalog.categories.studio[0].offers[0].options[1].rawText)
      .toBe("샘플 원본 제공 10만원");
    expect(catalog.categories.studio[0].offers[0].itemName).toBe("샘플 기본 촬영");
    expect(catalog.categories.studio[0].aliases).toEqual(["샘플 옛 상호"]);
    expect(catalog.categories.studio[0].offers[0].options[1].isEffectivelyMandatory)
      .toBe(true);
    expect(catalog.categories.studio[0].offers[0].options.map(({ name }) => name))
      .toEqual(["샘플 선행 옵션", "샘플 원본 제공"]);
    expect(catalog.categories.dress[0].offers[0].options).toEqual([]);
    expect(JSON.stringify(catalog)).not.toContain("샘플 미발행");
    expect(JSON.stringify(catalog)).not.toContain("source_quote");
    expect(catalog.agencies).toEqual([{ id: "agency-1", name: "샘플 대행사" }]);
  });

  it("uses the canonical row name and keeps every verified sibling spelling searchable", async () => {
    const base = {
      period_label: "2026Q3",
      source: "kca_tprice",
      is_current: true,
      vendor_category: "studio",
      price_category: "studio",
      price_max_krw: 1_200_000,
      price_note: null,
      vat_note: null,
      base_spec: "기본 촬영",
    };
    const client = fakePublicClient({
      v_public_official_prices: [
        {
          ...base,
          id: "price-autumn",
          vendor_id: "vendor-autumn",
          vendor_slug: "studio-z-autumn",
          vendor_name: "가을",
          vendor_aliases: ["가을 옛 상호"],
          region_code: "seoul_gangnam3",
          agency_id: "agency-seoul",
          agency_name: "서울 대행사",
          agency_display_name: "서울 대행사",
          item_name: "가을 기본 촬영",
          price_min_krw: 1_000_000,
        },
        {
          ...base,
          id: "price-autumn-studio",
          vendor_id: "vendor-autumn-studio",
          vendor_slug: "studio-a-autumn-studio",
          vendor_name: "가을스튜디오",
          vendor_aliases: ["가을 사진관"],
          region_code: "gangwon",
          agency_id: "agency-gangwon",
          agency_name: "강원 대행사",
          agency_display_name: "강원 대행사",
          item_name: "가을스튜디오 기본 촬영",
          price_min_krw: 1_100_000,
        },
      ],
    });

    const catalog = await loadPublicPriceCatalog(client, { optionCategories: [] });
    const [merged] = catalog.categories.studio;

    expect(catalog.categories.studio).toHaveLength(1);
    // 대표 이름은 채택한 병합표를 따른다 — `["studio|가을스튜디오", "가을"]`이므로
    // 대표는 짧은 쪽이다. 병합 자체(카드 1장)는 아래 단언이 계속 고정한다.
    expect(merged).toMatchObject({
      id: "vendor-autumn-studio",
      slug: "studio-a-autumn-studio",
      name: "가을",
    });
    expect(merged.offers.map(({ id, regionCode }) => ({ id, regionCode }))).toEqual([
      { id: "price-autumn", regionCode: "seoul_gangnam3" },
      { id: "price-autumn-studio", regionCode: "gangwon" },
    ]);
    // 형제 표기("가을", "가을 사진관")는 별칭으로 노출되지 않는다. 그 노출은 slug
    // 단위 병합표(2026-07-28)가 하던 일이고, 이름표+지점표(2026-08-05)로 통일하면서
    // 함께 빠졌다. 병합 자체는 유지된다 — 위 `toHaveLength(1)`이 그것을 고정한다.
    // 검색은 아래 단언이 계속 확인한다(옛 상호로 찾으면 이 카드가 나온다).
    expect(new Set(merged.aliases)).toEqual(new Set(["가을 옛 상호"]));
    expect(filterPriceCatalog(catalog.categories.studio, { search: "가을 옛 상호" }))
      .toHaveLength(1);
  });
});
