import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assembleRecommendationCandidates,
  collectRecommendationRelationChunks,
  collectRecommendationVendorPages,
  loadRecommendationCandidates,
  logRecommendationImpressions,
} from "../recommendationData";

function fakeSupabase(
  fixtures: Record<string, Array<Record<string, unknown>>>,
) {
  const calls: Array<{
    table: string;
    select: string;
    orders: string[];
    ranges: Array<[number, number]>;
  }> = [];
  const client = {
    from(table: string) {
      const call = { table, select: "", orders: [] as string[], ranges: [] as Array<[number, number]> };
      calls.push(call);
      let rows = [...(fixtures[table] ?? [])];
      const query: Record<string, unknown> = {};
      query.select = (columns: string) => {
        call.select = columns;
        return query;
      };
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
      query.order = (column: string) => {
        call.orders.push(column);
        return query;
      };
      query.range = (from: number, to: number) => {
        call.ranges.push([from, to]);
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      };
      query.then = (
        resolve: (result: { data: Array<Record<string, unknown>>; error: null }) => unknown,
      ) => resolve({ data: rows, error: null });
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const vendor = {
  id: "vendor-1",
  slug: "sample-hall",
  name: "샘플 예식장",
  category: "venue",
  region_code: "seoul_gangnam3",
  status: "approved",
  attributes: {
    hall_type: "hotel",
    notes_internal: "must never leave the server",
    price_band: "premium",
    secret_future_key: "must never leave the server",
  },
  official_url: "https://vendor.example",
  instagram_url: null,
  naver_place_url: null,
};

describe("assembleRecommendationCandidates", () => {
  it("adapts the public hall category to the canonical venue DB category and strips internal notes", () => {
    const candidates = assembleRecommendationCandidates("hall", [vendor], [], [{
      vendorId: "vendor-1",
      id: "price-1",
      priceCategory: "hall",
      itemName: "대관료",
      minKrw: 1_000_000,
      maxKrw: 1_200_000,
      periodLabel: "2026Q3",
      isCurrent: true,
      publishedAt: "2026-07-01",
      createdAt: "2026-07-02T00:00:00Z",
    }]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      category: "hall",
      attributes: { hall_type: "hotel" },
    });
    expect(candidates[0].attributes).not.toHaveProperty("notes_internal");
    expect(candidates[0].attributes).not.toHaveProperty("price_band");
    expect(candidates[0].attributes).not.toHaveProperty("secret_future_key");
  });

  it("aggregates only the newest selected snapshot and uses tag labels and slugs", () => {
    const candidates = assembleRecommendationCandidates("hall", [vendor], [
      { vendorId: "vendor-1", slug: "city-view", label: "시티뷰" },
      {
        vendorId: "vendor-1",
        slug: "retired-tag",
        label: "비활성 태그",
        isActive: false,
      },
    ], [
      {
        vendorId: "vendor-1",
        id: "price-old",
        priceCategory: "hall",
        itemName: "대관료",
        minKrw: 900_000,
        maxKrw: 900_000,
        periodLabel: "2026Q2",
        isCurrent: false,
        publishedAt: "2026-04-01",
        createdAt: "2026-04-02T00:00:00Z",
      },
      {
        vendorId: "vendor-1",
        id: "price-venue",
        priceCategory: "hall",
        itemName: "대관료",
        minKrw: 1_200_000,
        maxKrw: 1_400_000,
        periodLabel: "2026Q3",
        isCurrent: true,
        publishedAt: "2026-07-01",
        createdAt: "2026-07-02T00:00:00Z",
      },
      {
        vendorId: "vendor-1",
        id: "price-meal",
        priceCategory: "hall",
        itemName: "식대",
        minKrw: 150_000,
        maxKrw: 200_000,
        periodLabel: "2026Q3",
        isCurrent: true,
        publishedAt: "2026-07-01",
        createdAt: "2026-07-02T00:00:00Z",
      },
      {
        vendorId: "vendor-1",
        id: "price-venue-morning",
        priceCategory: "hall",
        itemName: "대관료(오전)",
        minKrw: 1_100_000,
        maxKrw: 1_300_000,
        periodLabel: "2026Q3",
        isCurrent: true,
        publishedAt: "2026-07-01",
        createdAt: "2026-07-02T00:00:00Z",
      },
    ]);

    expect(candidates[0].tags).toEqual([
      { slug: "city-view", label: "시티뷰" },
    ]);
    expect(candidates[0].price).toEqual({
      minKrw: 1_100_000,
      maxKrw: 1_400_000,
      periodLabel: "2026Q3",
      hasMarketData: false,
      isLatestSnapshot: true,
    });
  });

  it("fails closed for a hall whose public prices contain only meal or ambiguous items", () => {
    const candidates = assembleRecommendationCandidates("hall", [vendor], [], [
      {
        vendorId: "vendor-1",
        id: "price-meal",
        priceCategory: "hall",
        itemName: "식대",
        minKrw: 80_000,
        maxKrw: 120_000,
        periodLabel: "2026Q3",
        isCurrent: true,
        publishedAt: "2026-07-01",
        createdAt: "2026-07-02T00:00:00Z",
      },
      {
        vendorId: "vendor-1",
        id: "price-ambiguous",
        priceCategory: "hall",
        itemName: "패키지",
        minKrw: 500_000,
        maxKrw: 900_000,
        periodLabel: "2026Q3",
        isCurrent: true,
        publishedAt: "2026-07-01",
        createdAt: "2026-07-02T00:00:00Z",
      },
    ]);

    expect(candidates).toEqual([]);
  });

  it("does not invent an aggregate maximum when any selected public row has no maximum", () => {
    const candidates = assembleRecommendationCandidates("studio", [{
      ...vendor,
      category: "studio",
      slug: "sample-studio",
    }], [], [
      {
        vendorId: "vendor-1",
        id: "price-open-ended",
        snapshotId: "snapshot-1",
        priceCategory: "studio",
        itemName: "기본 촬영",
        minKrw: 1_500_000,
        maxKrw: null,
        periodLabel: "2026Q3",
        isCurrent: true,
        publishedAt: "2026-07-01",
        createdAt: "2026-07-02T00:00:00Z",
      },
      {
        vendorId: "vendor-1",
        id: "price-bounded",
        snapshotId: "snapshot-1",
        priceCategory: "studio",
        itemName: "간소화 촬영",
        minKrw: 1_000_000,
        maxKrw: 1_200_000,
        periodLabel: "2026Q3",
        isCurrent: true,
        publishedAt: "2026-07-01",
        createdAt: "2026-07-02T00:00:00Z",
      },
    ]);

    expect(candidates[0].price).toMatchObject({ minKrw: 1_000_000, maxKrw: null });
  });

  it("drops candidates without an approved public price or a stable slug", () => {
    const withoutSlug = { ...vendor, id: "vendor-2", slug: null };
    const candidates = assembleRecommendationCandidates(
      "hall",
      [vendor, withoutSlug],
      [],
      [],
    );

    expect(candidates).toEqual([]);
  });

  it("assembles the maximum bounded dataset without per-vendor relation rescans", () => {
    const vendorCount = 5_000;
    const relationCount = 25_000;
    const vendors = Array.from({ length: vendorCount }, (_, index) => ({
      ...vendor,
      id: `vendor-${index}`,
      slug: `sample-studio-${index}`,
      category: "studio",
    }));
    const tags = Array.from({ length: relationCount }, (_, index) => ({
      vendorId: `vendor-${index % vendorCount}`,
      slug: `tag-${index}`,
      label: `샘플 태그 ${index}`,
    }));
    const prices = Array.from({ length: relationCount }, (_, index) => ({
      vendorId: `vendor-${index % vendorCount}`,
      id: `price-${index}`,
      snapshotId: "snapshot-current",
      priceCategory: "studio",
      itemName: `샘플 촬영 ${index}`,
      minKrw: 1_000_000 + index,
      maxKrw: 1_200_000 + index,
      periodLabel: "2026Q3",
      isCurrent: true,
      publishedAt: "2026-07-01",
      createdAt: "2026-07-02T00:00:00Z",
    }));

    const startedAt = performance.now();
    const candidates = assembleRecommendationCandidates("studio", vendors, tags, prices);
    const elapsedMs = performance.now() - startedAt;

    expect(candidates).toHaveLength(vendorCount);
    // A linear Map index stays comfortably below this generous CI budget. The
    // previous V×(P+T) implementation performs about 250 million comparisons.
    expect(elapsedMs).toBeLessThan(2_000);
  });
});

describe("collectRecommendationRelationChunks", () => {
  it("keeps paging when the server returns fewer rows than requested because of max_rows", async () => {
    const data = Array.from({ length: 250 }, (_, index) => ({ id: index }));

    const rows = await collectRecommendationRelationChunks(
      [["vendor-1"]],
      async (_ids, from, to) => ({
        data: data.slice(from, Math.min(to + 1, from + 100)),
        error: null,
      }),
      { maxRows: 1_000, limitError: "TEST_LIMIT" },
    );

    expect(rows).toHaveLength(250);
  });

  it("sentinel-paginates every id chunk and does not accept a full first page as complete", async () => {
    const data = new Map([
      ["vendor-1", Array.from({ length: 501 }, (_, index) => ({ id: `tag-${index}` }))],
      ["vendor-2", [{ id: "tag-last" }]],
    ]);
    const ranges: Array<{ ids: string[]; from: number; to: number }> = [];

    const rows = await collectRecommendationRelationChunks(
      [["vendor-1"], ["vendor-2"]],
      async (ids, from, to) => {
        ranges.push({ ids, from, to });
        return { data: data.get(ids[0])?.slice(from, to + 1) ?? [], error: null };
      },
      { maxRows: 1_000, limitError: "TEST_LIMIT" },
    );

    expect(rows).toHaveLength(502);
    expect(ranges).toEqual([
      { ids: ["vendor-1"], from: 0, to: 999 },
      { ids: ["vendor-1"], from: 501, to: 999 },
      { ids: ["vendor-2"], from: 0, to: 498 },
      { ids: ["vendor-2"], from: 1, to: 498 },
    ]);
  });

  it("fails closed after an explicit global relation cap, including later chunks", async () => {
    await expect(collectRecommendationRelationChunks(
      [["vendor-1"], ["vendor-2"]],
      async (ids, from, to) => ({
        data: ids[0] === "vendor-1"
          ? Array.from({ length: Math.min(2, to - from + 1) }, (_, index) => ({ id: index }))
          : [{ id: 3 }],
        error: null,
      }),
      { maxRows: 2, limitError: "TEST_LIMIT" },
    )).rejects.toThrow("TEST_LIMIT");
  });
});

describe("collectRecommendationVendorPages", () => {
  it("reads every deterministic page instead of silently truncating at 1,000 rows", async () => {
    const rows = Array.from({ length: 1_201 }, (_, index) => ({
      ...vendor,
      id: `vendor-${index.toString().padStart(4, "0")}`,
    }));
    const ranges: Array<[number, number]> = [];

    const collected = await collectRecommendationVendorPages(async (from, to) => {
      ranges.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    });

    expect(collected).toHaveLength(1_201);
    expect(ranges).toEqual([[0, 999], [1_000, 1_999], [1_201, 2_200]]);
  });

  it("fails closed when the explicit candidate ceiling is exceeded", async () => {
    await expect(collectRecommendationVendorPages(async (from, to) => ({
      data: Array.from({ length: to - from + 1 }, (_, index) => ({
        ...vendor,
        id: `vendor-${from + index}`,
      })),
      error: null,
    }))).rejects.toThrow("VENDOR_RECOMMENDATION_CANDIDATE_LIMIT");
  });
});

describe("loadRecommendationCandidates", () => {
  it("loads only the evidence-gated public price projection with ordered paginated children", async () => {
    const { client, calls } = fakeSupabase({
      v_public_vendor_enrichment: [{
        ...vendor,
        tags: [{ slug: "city-view", label: "시티뷰", group: "hall_mood" }],
      }],
      v_public_official_prices: [{
        id: "price-public",
        snapshot_id: "snapshot-1",
        vendor_id: "vendor-1",
        source: "kca_tprice",
        price_category: "hall",
        item_name: "대관료",
        price_min_krw: 1_000_000,
        price_max_krw: 1_200_000,
        period_label: "2026Q3",
        is_current: true,
        published_at: "2026-07-01",
        created_at: "2026-07-02T00:00:00Z",
      }],
      // A legacy approved raw row must never be queried or considered.
      official_prices: [{
        id: "price-legacy-no-evidence",
        vendor_id: "vendor-1",
        review_status: "approved",
        price_min_krw: 1,
      }],
    });

    const candidates = await loadRecommendationCandidates(client, "hall");

    expect(candidates).toHaveLength(1);
    expect(candidates[0].price?.minKrw).toBe(1_000_000);
    expect(calls.map(({ table }) => table)).toContain("v_public_official_prices");
    expect(calls.map(({ table }) => table)).not.toContain("official_prices");
    const priceCall = calls.find(({ table }) => table === "v_public_official_prices");
    expect(priceCall?.orders).toEqual(["vendor_id", "id"]);
    expect(priceCall?.ranges[0]).toEqual([0, 999]);
    expect(calls.map(({ table }) => table)).not.toContain("vendor_tags");
    expect(calls.map(({ table }) => table)).not.toContain("price_snapshots");
  });

  it("uses DB-aggregated public vendor data and keeps worst-case REST calls bounded", async () => {
    const vendors = Array.from({ length: 5_000 }, (_, index) => ({
      ...vendor,
      id: `vendor-${index.toString().padStart(4, "0")}`,
      slug: `sample-studio-${index}`,
      category: "studio",
    }));
    const { client, calls } = fakeSupabase({
      vendors,
      v_public_vendor_enrichment: vendors.map((row) => ({ ...row, tags: [] })),
      v_public_official_prices: [],
    });

    await loadRecommendationCandidates(client, "studio");

    expect(calls.length).toBeLessThanOrEqual(32);
    expect(calls.map(({ table }) => table).every((table) => (
      table === "v_public_vendor_enrichment" || table === "v_public_official_prices"
    ))).toBe(true);
  });
});

describe("logRecommendationImpressions", () => {
  it("uses only the database-whitelisted context and never free-form metadata", async () => {
    let inserted: Array<Record<string, unknown>> = [];
    const client = {
      from: () => ({
        insert: async (rows: Array<Record<string, unknown>>) => {
          inserted = rows;
          return { error: null };
        },
      }),
    } as unknown as SupabaseClient;

    await expect(logRecommendationImpressions(client, {
      category: "hall",
      region_codes: ["seoul_gangnam3"],
    }, {
      results: [{
        vendor: {
          id: "00000000-0000-4000-8000-000000000001",
          slug: "sample-hall",
          name: "샘플 예식장",
          category: "hall",
          region_code: "seoul_gangnam3",
        },
        score: 0.9,
        match_reasons: ["샘플 이유"],
        price_summary: {
          min_krw: 1_000_000,
          max_krw: 1_200_000,
          period_label: "2026Q3",
          has_market_data: false,
        },
        data_badges: ["공시가"],
        detail_url: "/price/vendor/sample-hall",
      }],
      coverage_note: "가격을 공개한 업체 기준 추천입니다.",
      disclaimer: "공시 기준 가격이며 실제 계약 조건에 따라 달라질 수 있습니다.",
    })).resolves.toBe(true);

    expect(inserted).toEqual([expect.objectContaining({
      context: {
        category: "hall",
        region: "seoul_gangnam3",
        surface: "amora_reco",
      },
    })]);
    expect(inserted[0]).not.toHaveProperty("metadata");
  });
});
