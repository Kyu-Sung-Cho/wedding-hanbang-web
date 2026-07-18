import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assemblePublicVendorPriceProfile,
  collectPublicVendorRelationChunks,
  loadPublicVendorPriceProfile,
} from "../publicVendorPriceData";

function fakeSupabase(
  fixtures: Record<string, Array<Record<string, unknown>>>,
) {
  const calls: Array<{
    table: string;
    orders: string[];
    ranges: Array<[number, number]>;
    inValues: unknown[] | null;
  }> = [];
  const client = {
    from(table: string) {
      const call = {
        table,
        orders: [] as string[],
        ranges: [] as Array<[number, number]>,
        inValues: null as unknown[] | null,
      };
      calls.push(call);
      let rows = [...(fixtures[table] ?? [])];
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return query;
      };
      query.in = (column: string, values: unknown[]) => {
        call.inValues = values;
        rows = rows.filter((row) => values.includes(row[column]));
        return query;
      };
      query.order = (column: string) => {
        call.orders.push(column);
        return query;
      };
      query.range = (from: number, to: number) => {
        call.ranges.push([from, to]);
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      };
      query.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("assemblePublicVendorPriceProfile", () => {
  it("joins approved projection rows without exposing storage paths or private fields", () => {
    const profile = assemblePublicVendorPriceProfile({
      id: "vendor-1",
      slug: "sample-studio",
      name: "샘플 스튜디오",
      category: "studio",
      region_code: "seoul_gangnam3",
      aliases: ["샘플 구상호"],
      official_url: "https://vendor.example",
      instagram_url: null,
      naver_place_url: null,
      attributes: {
        original_files_policy: "included",
        notes_internal: "private note",
        price_band: "premium",
        secret_future_key: "must never leave the server",
      },
      tags: [{ slug: "natural-light", label: "자연광", group: "shoot_style" }],
    }, [{
      id: "price-1",
      period_label: "2026Q3",
      price_category: "studio",
      item_name: "기본 촬영",
      base_spec: "20p 앨범",
      price_min_krw: 1_200_000,
      price_max_krw: 1_400_000,
      vat_note: "VAT 포함",
      price_note: null,
      source_label: "한국소비자원 참가격 · 2026Q3",
      agency_id: "agency-1",
      agency_slug: "sample-agency",
      agency_display_name: "샘플 대행사",
      is_current: true,
      published_at: "2026-07-18",
    }], [{
      id: "option-1",
      official_price_id: "price-1",
      name: "야외 촬영",
      price_min_krw: 200_000,
      price_max_krw: 200_000,
      unit: null,
      condition: null,
      raw_text: "야외 촬영 20만원",
      is_effectively_mandatory: true,
      sort_order: 1,
    }]);

    expect(profile).toMatchObject({
      vendor: {
        id: "vendor-1",
        category: "studio",
        aliases: ["샘플 구상호"],
      },
      prices: [{
        id: "price-1",
        is_current: true,
        agency: { id: "agency-1", name: "샘플 대행사" },
        options: [{
          name: "야외 촬영",
          raw_text: "야외 촬영 20만원",
          is_effectively_mandatory: true,
        }],
      }],
      sources: ["한국소비자원 참가격 · 2026Q3"],
    });
    expect(JSON.stringify(profile)).not.toContain("source_file");
    expect(JSON.stringify(profile)).not.toContain("notes_internal");
    expect(JSON.stringify(profile)).not.toContain("price_band");
    expect(JSON.stringify(profile)).not.toContain("secret_future_key");
    expect(JSON.stringify(profile)).not.toContain("source_quote");
  });

  it("maps the canonical venue category to the consumer-facing hall category", () => {
    const profile = assemblePublicVendorPriceProfile({
      id: "vendor-2",
      slug: "sample-hall",
      name: "샘플 예식장",
      category: "venue",
      region_code: "seoul_etc",
      aliases: [],
      official_url: null,
      instagram_url: null,
      naver_place_url: null,
      attributes: {},
      tags: [],
    }, [], []);

    expect(profile.vendor.category).toBe("hall");
  });

  it("returns prices and options in a deterministic order regardless of relation order", () => {
    const baseVendor = {
      id: "vendor-2",
      slug: "sample-hall",
      name: "샘플 예식장",
      category: "venue",
      region_code: "seoul_etc",
      aliases: [],
      official_url: null,
      instagram_url: null,
      naver_place_url: null,
      attributes: {},
      tags: [],
    };
    const price = (id: string, period: string, min: number) => ({
      id,
      period_label: period,
      price_category: "hall",
      item_name: "대관료",
      base_spec: null,
      price_min_krw: min,
      price_max_krw: min,
      vat_note: null,
      price_note: null,
      source_label: `한국소비자원 참가격 · ${period}`,
    });

    const profile = assemblePublicVendorPriceProfile(
      baseVendor,
      [price("price-b", "2026Q2", 900_000), price("price-a", "2026Q3", 1_000_000)],
      [
        {
          id: "option-b",
          official_price_id: "price-a",
          name: "후순위",
          price_min_krw: 200_000,
          price_max_krw: 200_000,
          unit: null,
          condition: null,
          raw_text: "후순위 20만원",
        },
        {
          id: "option-a",
          official_price_id: "price-a",
          name: "선순위",
          price_min_krw: 100_000,
          price_max_krw: 100_000,
          unit: null,
          condition: null,
          raw_text: "선순위 10만원",
        },
      ],
    );

    expect(profile.prices.map(({ id }) => id)).toEqual(["price-a", "price-b"]);
    expect(profile.prices[0].options.map(({ id }) => id)).toEqual(["option-a", "option-b"]);
  });
});

describe("collectPublicVendorRelationChunks", () => {
  it("continues after a short server-capped page until an empty sentinel", async () => {
    const rows = Array.from({ length: 250 }, (_, index) => ({ id: index }));
    const result = await collectPublicVendorRelationChunks(
      [["vendor-1"]],
      async (_ids, from, to) => ({
        data: rows.slice(from, Math.min(to + 1, from + 100)),
        error: null,
      }),
      { maxRows: 1_000, limitError: "PUBLIC_TEST_LIMIT" },
    );

    expect(result).toHaveLength(250);
  });

  it("reads beyond PostgREST's default row limit with a sentinel page", async () => {
    const rows = Array.from({ length: 1_001 }, (_, index) => ({ id: index }));
    const ranges: Array<[number, number]> = [];
    const result = await collectPublicVendorRelationChunks(
      [["vendor-1"]],
      async (_ids, from, to) => {
        ranges.push([from, to]);
        return { data: rows.slice(from, to + 1), error: null };
      },
      { maxRows: 2_000, limitError: "PUBLIC_TEST_LIMIT" },
    );

    expect(result).toHaveLength(1_001);
    expect(ranges).toEqual([
      [0, 199], [200, 399], [400, 599], [600, 799], [800, 999],
      [1_000, 1_199], [1_001, 1_200],
    ]);
  });

  it("fails closed when later option-id chunks exceed the global cap", async () => {
    await expect(collectPublicVendorRelationChunks(
      [["price-a"], ["price-b"]],
      async (ids, from, to) => ({
        data: ids[0] === "price-a"
          ? Array.from({ length: Math.min(2, to - from + 1) }, (_, index) => ({ id: index }))
          : [{ id: 3 }],
        error: null,
      }),
      { maxRows: 2, limitError: "PUBLIC_TEST_LIMIT" },
    )).rejects.toThrow("PUBLIC_TEST_LIMIT");
  });
});

describe("loadPublicVendorPriceProfile", () => {
  it("paginates the public views and chunks option IDs to bounded URLs", async () => {
    const prices = Array.from({ length: 51 }, (_, index) => ({
      id: `price-${index.toString().padStart(2, "0")}`,
      vendor_slug: "sample-studio",
      source: "kca_tprice",
      period_label: "2026Q3",
      price_category: "studio",
      item_name: `상품 ${index}`,
      base_spec: null,
      price_min_krw: 1_000_000 + index,
      price_max_krw: 1_000_000 + index,
      vat_note: null,
      price_note: null,
      source_label: "한국소비자원 참가격 · 2026Q3",
    }));
    const { client, calls } = fakeSupabase({
      v_public_vendors: [{
        id: "vendor-1",
        slug: "sample-studio",
        name: "샘플 스튜디오",
        category: "studio",
        region_code: "seoul_etc",
        aliases: [],
        official_url: null,
        instagram_url: null,
        naver_place_url: null,
        attributes: {},
        tags: [],
      }],
      v_public_official_prices: prices,
      v_public_official_price_options: prices.map((price) => ({
        id: `option-${price.id}`,
        official_price_id: price.id,
        name: "원본 제공",
        price_min_krw: 0,
        price_max_krw: 0,
        unit: null,
        condition: null,
        raw_text: "원본 제공 0원",
        source_quote: "원본 제공",
      })),
    });

    const profile = await loadPublicVendorPriceProfile(client, "sample-studio");

    expect(profile?.prices).toHaveLength(51);
    const priceCall = calls.find(({ table }) => table === "v_public_official_prices");
    expect(priceCall).toMatchObject({
      orders: ["period_label", "price_min_krw", "id"],
      ranges: [[0, 199]],
    });
    const optionCalls = calls.filter(({ table }) => table === "v_public_official_price_options");
    expect(optionCalls).toHaveLength(4);
    expect(optionCalls.every(({ inValues }) => (inValues?.length ?? 0) <= 50)).toBe(true);
    expect(optionCalls.every(({ ranges }) => ranges.length > 0)).toBe(true);
    expect(calls.map(({ table }) => table)).toContain("v_public_vendors");
  });
});
