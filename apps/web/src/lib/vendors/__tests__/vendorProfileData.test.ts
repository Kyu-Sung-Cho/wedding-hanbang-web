import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assembleVendorProfile,
  collectVendorProfileRelationChunks,
  loadVendorProfile,
} from "../vendorProfileData";

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
      query.then = (
        resolve: (result: { data: Array<Record<string, unknown>>; error: null }) => unknown,
      ) => resolve({ data: rows, error: null });
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("assembleVendorProfile", () => {
  it("returns one evidence-rich profile while stripping private enrichment notes", () => {
    const profile = assembleVendorProfile({
      id: "vendor-1",
      slug: "sample-hall",
      name: "샘플 예식장",
      category: "venue",
      region_code: "seoul_gangnam3",
      status: "approved",
      attributes: {
        hall_type: "hotel",
        notes_internal: "private",
        price_band: "premium",
        secret_future_key: "must never leave the server",
      },
      official_url: "https://vendor.example",
      instagram_url: null,
      naver_place_url: null,
    }, [{
      slug: "city-view",
      label: "시티뷰",
      tagGroup: "hall_mood",
    }], [{
      id: "price-1",
      category: "hall",
      itemName: "대관료",
      baseSpec: null,
      minKrw: 1_000_000,
      maxKrw: 1_200_000,
      vatNote: "VAT 포함",
      priceNote: null,
      sourceLabel: "한국소비자원 참가격 · 2026Q3",
      periodLabel: "2026Q3",
      isCurrent: true,
      options: [{
        id: "option-1",
        name: "오후 추가금",
        minKrw: 100_000,
        maxKrw: 100_000,
        unit: null,
        condition: "오후 예식",
        rawText: "오후 예식 추가금 10만원",
      }],
    }]);

    expect(profile).toMatchObject({
      vendor: { id: "vendor-1", category: "hall" },
      attributes: { hall_type: "hotel" },
      tags: [{ slug: "city-view", label: "시티뷰", tag_group: "hall_mood" }],
      official_prices: [{
        id: "price-1",
        source: "한국소비자원 참가격 2026Q3 공시 기준",
        options: [{ name: "오후 추가금", raw_text: "오후 예식 추가금 10만원" }],
      }],
      data_badges: expect.arrayContaining(["공시가", "최신 공시"]),
      sources: ["한국소비자원 참가격 2026Q3 공시 기준"],
    });
    expect(profile?.attributes).not.toHaveProperty("notes_internal");
    expect(profile?.attributes).not.toHaveProperty("price_band");
    expect(profile?.attributes).not.toHaveProperty("secret_future_key");
    expect(JSON.stringify(profile)).not.toContain("source_file");
    expect(JSON.stringify(profile)).not.toContain("예식장/샘플.xlsx");
    expect(JSON.stringify(profile)).not.toContain("source_quote");
  });

  it("rejects non-approved vendors and profiles without stable slugs", () => {
    const base = {
      id: "vendor-1",
      slug: "sample",
      name: "샘플",
      category: "studio",
      region_code: null,
      status: "approved",
      attributes: {},
      official_url: null,
      instagram_url: null,
      naver_place_url: null,
    };

    expect(assembleVendorProfile({ ...base, status: "pending" }, [], [])).toBeNull();
    expect(assembleVendorProfile({ ...base, slug: null }, [], [])).toBeNull();
  });

  it("stabilizes tag, price, and option ordering before returning the API profile", () => {
    const vendor = {
      id: "vendor-1",
      slug: "sample",
      name: "샘플",
      category: "studio",
      region_code: null,
      status: "approved",
      attributes: {},
      official_url: null,
      instagram_url: null,
      naver_place_url: null,
    };
    const price = (id: string, periodLabel: string, minKrw: number) => ({
      id,
      category: "studio",
      itemName: "기본 촬영",
      baseSpec: null,
      minKrw,
      maxKrw: minKrw,
      vatNote: null,
      priceNote: null,
      sourceLabel: `한국소비자원 참가격 · ${periodLabel}`,
      periodLabel,
      isCurrent: periodLabel === "2026Q3",
      options: id === "price-a"
        ? [
          {
            id: "option-b",
            name: "후순위",
            minKrw: 200_000,
            maxKrw: 200_000,
            unit: null,
            condition: null,
            rawText: "후순위 20만원",
          },
          {
            id: "option-a",
            name: "선순위",
            minKrw: 100_000,
            maxKrw: 100_000,
            unit: null,
            condition: null,
            rawText: "선순위 10만원",
          },
        ]
        : [],
    });

    const profile = assembleVendorProfile(
      vendor,
      [
        { slug: "z-tag", label: "후순위", tagGroup: "style" },
        { slug: "a-tag", label: "선순위", tagGroup: "style" },
      ],
      [price("price-b", "2026Q2", 900_000), price("price-a", "2026Q3", 1_000_000)],
    );

    expect(profile?.tags.map(({ slug }) => slug)).toEqual(["a-tag", "z-tag"]);
    expect(profile?.official_prices.map(({ id }) => id)).toEqual(["price-a", "price-b"]);
    expect(profile?.official_prices[0].options.map(({ id }) => id)).toEqual(["option-a", "option-b"]);
  });
});

describe("collectVendorProfileRelationChunks", () => {
  it("continues after a short max_rows page until it reaches an empty sentinel", async () => {
    const rows = Array.from({ length: 250 }, (_, index) => ({ id: index }));
    const collected = await collectVendorProfileRelationChunks(
      [["vendor-1"]],
      async (_ids, from, to) => ({
        data: rows.slice(from, Math.min(to + 1, from + 100)),
        error: null,
      }),
      { maxRows: 1_000, limitError: "PROFILE_TEST_LIMIT" },
    );

    expect(collected).toHaveLength(250);
  });

  it("paginates profile children and detects rows beyond an exact cap", async () => {
    const rows = Array.from({ length: 401 }, (_, index) => ({ id: index }));
    const ranges: Array<[number, number]> = [];
    const collected = await collectVendorProfileRelationChunks(
      [["vendor-1"]],
      async (_ids, from, to) => {
        ranges.push([from, to]);
        return { data: rows.slice(from, to + 1), error: null };
      },
      { maxRows: 500, limitError: "PROFILE_TEST_LIMIT" },
    );

    expect(collected).toHaveLength(401);
    expect(ranges).toEqual([[0, 199], [200, 399], [400, 499], [401, 499]]);
  });

  it("fails closed when a later chunk has data after the global cap", async () => {
    await expect(collectVendorProfileRelationChunks(
      [["price-a"], ["price-b"]],
      async (ids, from, to) => ({
        data: ids[0] === "price-a"
          ? Array.from({ length: Math.min(2, to - from + 1) }, (_, index) => ({ id: index }))
          : [{ id: 3 }],
        error: null,
      }),
      { maxRows: 2, limitError: "PROFILE_TEST_LIMIT" },
    )).rejects.toThrow("PROFILE_TEST_LIMIT");
  });
});

describe("loadVendorProfile", () => {
  it("uses evidence-gated public price views with paginated, bounded child queries", async () => {
    const prices = Array.from({ length: 51 }, (_, index) => ({
      id: `price-${index.toString().padStart(2, "0")}`,
      snapshot_id: "snapshot-1",
      vendor_id: "vendor-1",
      source: "kca_tprice",
      price_category: "studio",
      item_name: `상품 ${index}`,
      base_spec: null,
      price_min_krw: 1_000_000 + index,
      price_max_krw: 1_000_000 + index,
      vat_note: null,
      price_note: null,
      source_label: "한국소비자원 참가격 · 2026Q3",
      period_label: "2026Q3",
      is_current: true,
    }));
    const { client, calls } = fakeSupabase({
      v_public_vendor_enrichment: [{
        id: "vendor-1",
        slug: "sample-studio",
        name: "샘플 스튜디오",
        category: "studio",
        region_code: "seoul_etc",
        attributes: {},
        official_url: null,
        instagram_url: null,
        naver_place_url: null,
        tags: [{ slug: "natural", label: "내추럴", group: "style" }],
      }],
      vendors: [{
        id: "vendor-1",
        status: "approved",
        instagram_url: "https://instagram.com.evil.example/sample",
        attributes: { notes_internal: "private", future_secret: "private" },
      }],
      v_public_official_prices: prices,
      official_prices: [{
        id: "legacy-no-evidence",
        vendor_id: "vendor-1",
        review_status: "approved",
      }],
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

    const profile = await loadVendorProfile(client, "vendor-1");

    expect(profile?.official_prices).toHaveLength(51);
    expect(profile?.attributes).toEqual({});
    expect(profile?.tags).toEqual([{ slug: "natural", label: "내추럴", tag_group: "style" }]);
    expect(calls.map(({ table }) => table)).toContain("v_public_vendor_enrichment");
    expect(calls.map(({ table }) => table)).toContain("v_public_official_prices");
    expect(calls.map(({ table }) => table)).not.toContain("vendors");
    expect(calls.map(({ table }) => table)).not.toContain("vendor_tags");
    expect(calls.map(({ table }) => table)).not.toContain("official_prices");
    const priceCall = calls.find(({ table }) => table === "v_public_official_prices");
    expect(priceCall).toMatchObject({
      orders: ["period_label", "price_min_krw", "id"],
      ranges: [[0, 199]],
    });
    const optionCalls = calls.filter(({ table }) => table === "v_public_official_price_options");
    expect(optionCalls).toHaveLength(4);
    expect(optionCalls.every(({ inValues }) => (inValues?.length ?? 0) <= 50)).toBe(true);
    expect(optionCalls.every(({ ranges }) => ranges.length > 0)).toBe(true);
    expect(calls.map(({ table }) => table)).not.toContain("price_snapshots");
  });
});
