import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { loadAdminPreviewPriceCatalog, loadAdminPreviewVendor } from "./adminPreviewData";

type Row = Record<string, unknown>;

function fakeClient(
  tables: Record<string, Row[]>,
  options: { rangeDelayMs?: number } = {},
) {
  const selections: Array<{ table: string; columns: string }> = [];
  const equalities: Array<{ table: string; column: string; value: unknown }> = [];
  const rangeCalls: Array<{ table: string; start: number; end: number }> = [];
  let activeRanges = 0;
  let maximumActiveRanges = 0;
  const from = vi.fn((table: string) => ({
    select(columns: string) {
      selections.push({ table, columns });
      let rows = [...(tables[table] ?? [])];
      const orderings: Array<{ column: string; ascending: boolean }> = [];
      const query = {
        eq(column: string, value: unknown) {
          equalities.push({ table, column, value });
          rows = rows.filter((row) => row[column] === value);
          return query;
        },
        is(column: string, value: unknown) {
          rows = rows.filter((row) => row[column] === value);
          return query;
        },
        in(column: string, values: unknown[]) {
          rows = rows.filter((row) => values.includes(row[column]));
          return query;
        },
        not(column: string, operator: string, value: unknown) {
          if (operator === "is" && value === null) {
            rows = rows.filter((row) => row[column] !== null && row[column] !== undefined);
          }
          return query;
        },
        order(column: string, options?: { ascending?: boolean }) {
          orderings.push({ column, ascending: options?.ascending !== false });
          return query;
        },
        async range(start: number, end: number) {
          rangeCalls.push({ table, start, end });
          activeRanges += 1;
          maximumActiveRanges = Math.max(maximumActiveRanges, activeRanges);
          if (options.rangeDelayMs) {
            await new Promise((resolve) => setTimeout(resolve, options.rangeDelayMs));
          }
          const ordered = [...rows].sort((left, right) => {
            for (const { column, ascending } of orderings) {
              const leftValue = left[column];
              const rightValue = right[column];
              if (leftValue === rightValue) continue;
              if (leftValue === null || leftValue === undefined) return ascending ? 1 : -1;
              if (rightValue === null || rightValue === undefined) return ascending ? -1 : 1;
              const comparison = String(leftValue).localeCompare(String(rightValue), "en");
              if (comparison !== 0) return ascending ? comparison : -comparison;
            }
            return 0;
          });
          activeRanges -= 1;
          return { data: ordered.slice(start, end + 1), error: null };
        },
      };
      return query;
    },
  }));
  const rpc = vi.fn((name: string) => {
    if (name === "get_vendor_disclosure_admin_preview_scope") {
      return Promise.resolve({ data: tables.__admin_preview_scope ?? [], error: null });
    }
    if (name === "get_vendor_disclosure_admin_preview_vendor_scope") {
      return Promise.resolve({
        data: tables.__admin_preview_vendor_scope ?? tables.__admin_preview_scope ?? [],
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: new Error("unexpected rpc") });
  });
  return {
    client: { from, rpc } as unknown as SupabaseClient,
    selections,
    equalities,
    rangeCalls,
    getMaximumActiveRanges: () => maximumActiveRanges,
    rpc,
  };
}

function previewScope(input: {
  priceIds?: string[];
  semanticIds?: string[];
  unitIds?: string[];
} = {}): Row {
  return {
    run_sha256: "d".repeat(64),
    snapshot_id: "draft-snapshot",
    period_label: "2026Q3",
    unit_ids: input.unitIds ?? ["a".repeat(64)],
    official_price_ids: input.priceIds ?? [],
    semantic_ids: input.semanticIds ?? [],
  };
}

describe("admin vendor preview data", () => {
  it("uses a vendor-scoped RPC instead of traversing run-wide price and policy chunks", async () => {
    const unrelatedPriceIds = Array.from({ length: 120 }, (_, index) => `other-price-${index}`);
    const unrelatedSemanticIds = Array.from({ length: 120 }, (_, index) => `other-policy-${index}`);
    const { client, rangeCalls, rpc } = fakeClient({
      __admin_preview_scope: [previewScope({
        priceIds: [...unrelatedPriceIds, "target-price"],
        semanticIds: [...unrelatedSemanticIds, "target-policy"],
      })],
      __admin_preview_vendor_scope: [previewScope({
        priceIds: ["target-price"],
        semanticIds: ["target-policy"],
      })],
      vendor_disclosure_ingest_runs: [{
        snapshot_id: "draft-snapshot",
        snapshot_source: "kca_tprice",
        status: "complete",
        dedupe_finalized_at: "2026-07-20T00:00:00.000Z",
      }],
      price_snapshots: [{
        id: "draft-snapshot",
        period_label: "2026Q3",
        source: "kca_tprice",
        published: false,
        is_current: false,
        published_at: null,
      }],
      official_prices: [{
        id: "target-price",
        snapshot_id: "draft-snapshot",
        vendor_id: "target-vendor",
        agency_id: null,
        category: "studio",
        item_name: "Target offer",
        base_spec: null,
        price_min_krw: 100_000,
        price_max_krw: 100_000,
        price_note: null,
        review_status: "pending",
      }],
      official_price_options: [],
      disclosure_semantic_staging: [{
        id: "target-policy",
        snapshot_id: "draft-snapshot",
        partner_vendor_id: "target-vendor",
        official_price_id: null,
        source_agency: null,
        record_kind: "vendor_policy",
        subject_kind: "vendor",
        semantic_type: "change",
        title: null,
        summary: null,
        content_verbatim: "Changes require confirmation.",
        review_status: "pending",
      }],
      vendors: [{
        id: "target-vendor",
        slug: "target-vendor",
        name: "Target vendor",
        aliases: [],
        category: "studio",
        region_code: "seoul_etc",
        status: "pending",
      }],
      agencies: [],
    });

    const profile = await loadAdminPreviewVendor(client, "target-vendor");

    expect(profile?.vendor.id).toBe("target-vendor");
    expect(rpc).toHaveBeenCalledWith("get_vendor_disclosure_admin_preview_vendor_scope", {
      p_vendor_id: "target-vendor",
    });
    expect(rpc).not.toHaveBeenCalledWith("get_vendor_disclosure_admin_preview_scope");
    expect(rangeCalls.filter(({ table }) => table === "official_prices")).toHaveLength(1);
    expect(rangeCalls.filter(({ table }) => table === "disclosure_semantic_staging")).toHaveLength(1);
  });

  it("fails closed when a vendor-scoped ownership ID cannot be read back", async () => {
    const { client } = fakeClient({
      __admin_preview_scope: [previewScope({ priceIds: ["owned-price"] })],
      price_snapshots: [{
        id: "draft-snapshot",
        period_label: "2026Q3",
        source: "kca_tprice",
        published: false,
        is_current: false,
        published_at: null,
      }],
      official_prices: [{
        id: "same-snapshot-other-run-price",
        snapshot_id: "draft-snapshot",
        vendor_id: "target-vendor",
        agency_id: null,
        category: "studio",
        item_name: "Must not cross the run boundary",
        base_spec: null,
        price_min_krw: 100_000,
        price_max_krw: 100_000,
        price_note: null,
        review_status: "pending",
      }],
      disclosure_semantic_staging: [],
    });

    await expect(loadAdminPreviewVendor(client, "target-vendor"))
      .rejects.toThrow("ADMIN_PREVIEW_DATA_UNAVAILABLE");
  });

  it("bounds full-catalog chunk reads to four concurrent requests", async () => {
    const priceIds = Array.from({ length: 250 }, (_, index) => `price-${index}`);
    const prices = priceIds.map((id, index) => ({
      id,
      snapshot_id: "draft-snapshot",
      vendor_id: "bounded-vendor",
      agency_id: null,
      category: "studio",
      item_name: `Offer ${index}`,
      base_spec: null,
      price_min_krw: 100_000 + index,
      price_max_krw: 100_000 + index,
      price_note: null,
      review_status: "pending",
    }));
    const { client, getMaximumActiveRanges } = fakeClient({
      __admin_preview_scope: [previewScope({ priceIds })],
      price_snapshots: [{
        id: "draft-snapshot",
        period_label: "2026Q3",
        source: "kca_tprice",
        published: false,
        is_current: false,
        published_at: null,
      }],
      official_prices: prices,
      official_price_options: [],
      disclosure_semantic_staging: [],
      vendors: [{
        id: "bounded-vendor",
        slug: "bounded-vendor",
        name: "Bounded Vendor",
        aliases: [],
        category: "studio",
        region_code: "seoul_etc",
        status: "pending",
      }],
      agencies: [],
    }, { rangeDelayMs: 2 });

    const catalog = await loadAdminPreviewPriceCatalog(client);

    expect(catalog.categories.studio[0]?.offers).toHaveLength(250);
    expect(getMaximumActiveRanges()).toBeGreaterThan(1);
    expect(getMaximumActiveRanges()).toBeLessThanOrEqual(4);
  });

  it("fails closed when a price row category does not match its linked vendor", async () => {
    const { client } = fakeClient({
      __admin_preview_scope: [previewScope({ priceIds: ["mismatched-price"] })],
      vendor_disclosure_ingest_runs: [{
        snapshot_id: "draft-snapshot",
        snapshot_source: "kca_tprice",
        status: "complete",
        dedupe_finalized_at: "2026-07-20T00:00:00.000Z",
      }],
      price_snapshots: [{
        id: "draft-snapshot",
        period_label: "2026Q3",
        source: "kca_tprice",
        published: false,
        is_current: false,
        published_at: null,
      }],
      official_prices: [{
        id: "mismatched-price",
        snapshot_id: "draft-snapshot",
        vendor_id: "studio-vendor",
        agency_id: null,
        category: "dress",
        item_name: "Wrong category offer",
        base_spec: null,
        price_min_krw: 100_000,
        price_max_krw: 100_000,
        price_note: null,
        review_status: "pending",
      }],
      official_price_options: [],
      disclosure_semantic_staging: [],
      vendors: [{
        id: "studio-vendor",
        slug: "studio-vendor",
        name: "Studio vendor",
        aliases: [],
        category: "studio",
        region_code: "seoul_gangnam3",
        status: "pending",
      }],
      agencies: [],
    });

    const catalog = await loadAdminPreviewPriceCatalog(client);

    expect(catalog.categories.studio[0]?.offers).toEqual([]);
  });

  it("loads the latest completed ingest snapshot, includes linked drafts, and strips private evidence", async () => {
    const secretQuote = "PRIVATE SOURCE QUOTE";
    const secretObjectKey = `${"a".repeat(64)}.xlsx`;
    const { client, selections } = fakeClient({
      __admin_preview_scope: [previewScope({
        priceIds: ["price-1", "price-2", "price-draft-identity"],
        semanticIds: ["policy-1"],
      })],
      vendor_disclosure_ingest_runs: [
        {
          run_sha256: "c".repeat(64),
          snapshot_id: "older-complete-snapshot",
          snapshot_source: "kca_tprice",
          status: "complete",
          dedupe_finalized_at: "2026-07-19T00:00:00.000Z",
        },
        {
          run_sha256: "d".repeat(64),
          snapshot_id: "draft-snapshot",
          snapshot_source: "kca_tprice",
          status: "complete",
          dedupe_finalized_at: "2026-07-20T00:00:00.000Z",
        },
        {
          run_sha256: "e".repeat(64),
          snapshot_id: "newer-active-empty-snapshot",
          snapshot_source: "kca_tprice",
          status: "active",
          dedupe_finalized_at: null,
        },
      ],
      price_snapshots: [
        {
          id: "published-snapshot",
          period_label: "2026Q2",
          source: "kca_tprice",
          published: true,
          is_current: true,
          published_at: "2026-07-01T00:00:00.000Z",
          created_at: "2026-07-01T00:00:00.000Z",
        },
        {
          id: "older-complete-snapshot",
          period_label: "2026Q1",
          source: "kca_tprice",
          published: false,
          is_current: false,
          published_at: null,
          created_at: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "draft-snapshot",
          period_label: "2026Q3",
          source: "kca_tprice",
          published: false,
          is_current: false,
          published_at: null,
          created_at: "2026-07-20T00:00:00.000Z",
        },
        {
          id: "newer-active-empty-snapshot",
          period_label: "2026Q4",
          source: "kca_tprice",
          published: false,
          is_current: false,
          published_at: null,
          created_at: "2026-07-21T00:00:00.000Z",
        },
      ],
      official_prices: [
        {
          id: "price-1",
          snapshot_id: "draft-snapshot",
          vendor_id: "vendor-priced",
          agency_id: "agency-1",
          category: "hall",
          item_name: "그랜드홀 대관료",
          base_spec: null,
          price_min_krw: 1_000_000,
          price_max_krw: 1_000_000,
          price_note: null,
          review_status: "pending",
          source_quote: secretQuote,
          source_object_keys: [secretObjectKey],
          source_file: "C:\\private\\source.xlsx",
        },
        {
          id: "price-2",
          snapshot_id: "draft-snapshot",
          vendor_id: "vendor-priced",
          agency_id: "agency-1",
          category: "hall",
          item_name: "그랜드홀 식대",
          base_spec: null,
          price_min_krw: 80_000,
          price_max_krw: 80_000,
          price_note: null,
          review_status: "pending",
        },
        {
          id: "price-draft-identity",
          snapshot_id: "draft-snapshot",
          vendor_id: "vendor-draft",
          agency_id: null,
          category: "makeup",
          item_name: "공시 가격 검수 대기",
          base_spec: null,
          price_min_krw: null,
          price_max_krw: null,
          price_note: null,
          review_status: "pending",
        },
      ],
      official_price_options: [],
      disclosure_semantic_staging: [{
        id: "policy-1",
        snapshot_id: "draft-snapshot",
        partner_vendor_id: "vendor-policy-only",
        record_kind: "vendor_policy",
        subject_kind: "vendor",
        semantic_type: "penalty",
        title: null,
        summary: null,
        content_verbatim: "Cancellation fee applies after booking.",
        review_status: "pending",
      }],
      vendors: [
        {
          id: "vendor-priced",
          slug: "priced-hall",
          name: "가격 있는 예식장",
          aliases: [],
          category: "hall",
          region_code: "seoul_gangnam3",
          status: "pending",
        },
        {
          id: "vendor-policy-only",
          slug: "policy-only-studio",
          name: "정책만 있는 스튜디오",
          aliases: [],
          category: "studio",
          region_code: "seoul_etc",
          status: "pending",
        },
        {
          id: "vendor-draft",
          slug: "draft-makeup",
          name: "연결된 검수 전 메이크업",
          aliases: [],
          category: "makeup",
          region_code: "gyeongsang",
          status: "draft",
        },
      ],
      agencies: [{
        id: "agency-1",
        name: "대행사 하나",
        display_name: "대행사 하나",
      }],
    });

    const catalog = await loadAdminPreviewPriceCatalog(client);

    expect(catalog.periodLabel).toBe("2026Q3");
    expect(catalog.counts).toEqual({ studio: 1, dress: 0, makeup: 1, hall: 1 });
    expect(catalog.categories.studio[0]).toMatchObject({
      id: "vendor-policy-only",
      offers: [],
      policies: [{
        id: "policy-1",
        type: "penalty",
        title: null,
        summary: null,
        content: "Cancellation fee applies after booking.",
      }],
    });
    expect(catalog.categories.hall[0]?.offers).toHaveLength(2);
    expect(catalog.categories.hall[0]?.offers.map((offer) => offer.itemName))
      .toEqual(["그랜드홀 식대", "그랜드홀 대관료"]);
    expect(catalog.categories.makeup[0]).toMatchObject({
      id: "vendor-draft",
      regionCode: "gyeongsang",
      offers: [{
        itemName: "공시 가격 검수 대기",
        minimumKrw: null,
        maximumKrw: null,
      }],
    });

    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toContain(secretQuote);
    expect(serialized).not.toContain(secretObjectKey);
    expect(serialized).not.toContain("C:\\private");
    const selectedColumns = selections.map(({ columns }) => columns).join(",");
    expect(selectedColumns).not.toContain("source_quote");
    expect(selectedColumns).not.toContain("source_object_keys");
    expect(selectedColumns).not.toContain("source_file");
  });

  it("fails closed with an empty catalog when no ingest run is complete", async () => {
    const { client, selections, rpc } = fakeClient({
      __admin_preview_scope: [],
      vendor_disclosure_ingest_runs: [{
        run_sha256: "f".repeat(64),
        snapshot_id: "active-snapshot",
        snapshot_source: "kca_tprice",
        status: "active",
        dedupe_finalized_at: null,
      }],
      price_snapshots: [{
        id: "active-snapshot",
        period_label: "2026Q4",
        source: "kca_tprice",
        published: false,
        is_current: false,
        published_at: null,
      }],
    });

    const catalog = await loadAdminPreviewPriceCatalog(client);

    expect(catalog).toEqual({
      periodLabel: "검수 전 공시",
      categories: { studio: [], dress: [], makeup: [], hall: [] },
      counts: { studio: 0, dress: 0, makeup: 0, hall: 0 },
      agencies: [],
    });
    expect(rpc).toHaveBeenCalledWith("get_vendor_disclosure_admin_preview_scope");
    expect(selections).toEqual([]);
  });

  it("renders only rows owned by the exact completed run even when another run shares the snapshot", async () => {
    const { client } = fakeClient({
      __admin_preview_scope: [previewScope({
        unitIds: ["a".repeat(64)],
        priceIds: ["owned-price"],
        semanticIds: ["owned-policy", "owned-refund-policy"],
      })],
      price_snapshots: [{
        id: "draft-snapshot",
        period_label: "2026Q3",
        source: "kca_tprice",
        published: false,
        is_current: false,
        published_at: null,
      }],
      official_prices: [
        {
          id: "owned-price",
          snapshot_id: "draft-snapshot",
          vendor_id: "owned-vendor",
          agency_id: null,
          category: "studio",
          item_name: "Owned offer",
          base_spec: null,
          price_min_krw: 100_000,
          price_max_krw: 100_000,
          price_note: null,
          review_status: "pending",
        },
        {
          id: "other-run-price",
          snapshot_id: "draft-snapshot",
          vendor_id: "other-run-vendor",
          agency_id: null,
          category: "dress",
          item_name: "Must not leak into preview",
          base_spec: null,
          price_min_krw: 200_000,
          price_max_krw: 200_000,
          price_note: null,
          review_status: "pending",
        },
      ],
      official_price_options: [],
      disclosure_semantic_staging: [
        {
          id: "owned-policy",
          snapshot_id: "draft-snapshot",
          partner_vendor_id: "owned-vendor",
          official_price_id: "owned-price",
          source_agency: { name: "Owned Agency" },
          record_kind: "vendor_policy",
          subject_kind: "vendor",
          semantic_type: "penalty",
          title: "Cancellation",
          summary: null,
          content_verbatim: "Owned policy content",
          review_status: "pending",
        },
        {
          id: "other-run-policy",
          snapshot_id: "draft-snapshot",
          partner_vendor_id: "other-run-vendor",
          official_price_id: "other-run-price",
          source_agency: null,
          record_kind: "vendor_policy",
          subject_kind: "vendor",
          semantic_type: "penalty",
          title: "Must not leak",
          summary: null,
          content_verbatim: "Other run policy",
          review_status: "pending",
        },
        {
          id: "owned-refund-policy",
          snapshot_id: "draft-snapshot",
          partner_vendor_id: "owned-vendor",
          official_price_id: null,
          source_agency: null,
          record_kind: "vendor_policy",
          subject_kind: "vendor",
          semantic_type: "refund_policy",
          title: "Refund terms",
          summary: null,
          content_verbatim: "Owned refund policy content",
          review_status: "pending",
        },
      ],
      vendors: [
        {
          id: "owned-vendor",
          slug: "owned-vendor",
          name: "Owned Vendor",
          aliases: [],
          category: "studio",
          region_code: "seoul_gangnam3",
          status: "pending",
        },
        {
          id: "other-run-vendor",
          slug: "other-run-vendor",
          name: "Other Run Vendor",
          aliases: [],
          category: "dress",
          region_code: "seoul_gangnam3",
          status: "pending",
        },
      ],
      agencies: [],
    });

    const catalog = await loadAdminPreviewPriceCatalog(client);

    expect(catalog.counts).toEqual({ studio: 1, dress: 0, makeup: 0, hall: 0 });
    expect(catalog.categories.studio[0]?.offers.map(({ id }) => id)).toEqual(["owned-price"]);
    expect(catalog.categories.studio[0]?.policies).toEqual([
      expect.objectContaining({
        id: "owned-policy",
        title: "Cancellation · 적용 범위: Owned Agency / Owned offer",
      }),
      expect.objectContaining({
        id: "owned-refund-policy",
        type: "refund",
        title: "Refund terms",
      }),
    ]);
    expect(JSON.stringify(catalog)).not.toContain("other-run");
  });
});
