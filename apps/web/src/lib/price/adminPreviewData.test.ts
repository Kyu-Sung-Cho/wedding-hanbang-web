import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { loadAdminPreviewPriceCatalog } from "./adminPreviewData";

type Row = Record<string, unknown>;

function fakeClient(tables: Record<string, Row[]>) {
  const selections: Array<{ table: string; columns: string }> = [];
  const from = vi.fn((table: string) => ({
    select(columns: string) {
      selections.push({ table, columns });
      let rows = [...(tables[table] ?? [])];
      const query = {
        eq(column: string, value: unknown) {
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
        order() {
          return query;
        },
        range(start: number, end: number) {
          return Promise.resolve({ data: rows.slice(start, end + 1), error: null });
        },
      };
      return query;
    },
  }));
  return {
    client: { from } as unknown as SupabaseClient,
    selections,
  };
}

describe("admin vendor preview data", () => {
  it("loads only an unpublished snapshot, keeps all offers, and strips private evidence", async () => {
    const secretQuote = "PRIVATE SOURCE QUOTE";
    const secretObjectKey = `${"a".repeat(64)}.xlsx`;
    const { client, selections } = fakeClient({
      price_snapshots: [
        {
          id: "published-snapshot",
          period_label: "2026Q2",
          source: "kca_tprice",
          published: true,
          created_at: "2026-07-01T00:00:00.000Z",
        },
        {
          id: "draft-snapshot",
          period_label: "2026Q3",
          source: "kca_tprice",
          published: false,
          created_at: "2026-07-20T00:00:00.000Z",
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
      ],
      official_price_options: [],
      disclosure_semantic_staging: [{
        snapshot_id: "draft-snapshot",
        partner_vendor_id: "vendor-policy-only",
        subject_kind: "vendor",
        semantic_type: "cancellation_policy",
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
      ],
      agencies: [{
        id: "agency-1",
        name: "대행사 하나",
        display_name: "대행사 하나",
      }],
    });

    const catalog = await loadAdminPreviewPriceCatalog(client);

    expect(catalog.periodLabel).toBe("2026Q3");
    expect(catalog.counts).toEqual({ studio: 1, dress: 0, makeup: 0, hall: 1 });
    expect(catalog.categories.studio[0]).toMatchObject({
      id: "vendor-policy-only",
      offers: [],
    });
    expect(catalog.categories.hall[0]?.offers).toHaveLength(2);
    expect(catalog.categories.hall[0]?.offers.map((offer) => offer.itemName))
      .toEqual(["그랜드홀 식대", "그랜드홀 대관료"]);

    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toContain(secretQuote);
    expect(serialized).not.toContain(secretObjectKey);
    expect(serialized).not.toContain("C:\\private");
    const selectedColumns = selections.map(({ columns }) => columns).join(",");
    expect(selectedColumns).not.toContain("source_quote");
    expect(selectedColumns).not.toContain("source_object_keys");
    expect(selectedColumns).not.toContain("source_file");
  });
});
