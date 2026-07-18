// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { lookupPublishedVendorPrices } from "./priceUploadLookup";

describe("lookupPublishedVendorPrices", () => {
  it("returns the exact empty public contract without querying price views", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const from = vi.fn();

    await expect(lookupPublishedVendorPrices({ rpc, from } as never, {
      query: "없는업체",
    })).resolves.toStrictEqual({
      matches: [],
      disclaimer: "공시 기준 가격이며 실제 계약 조건에 따라 달라질 수 있습니다.",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("returns only the documented public fields from the latest published snapshot", async () => {
    const vendorId = "00000000-0000-4000-8000-000000000001";
    const latestPriceId = "00000000-0000-4000-8000-000000000002";
    const olderPriceId = "00000000-0000-4000-8000-000000000006";
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        vendor_id: vendorId,
        vendor_slug: "sample-studio-a",
        vendor_name: "샘플스튜디오가",
        vendor_category: "studio",
        aliases: ["샘플스튜디오구명"],
        similarity: 0.74,
      }],
      error: null,
    });
    const rows: Record<string, unknown[]> = {
      v_public_official_prices: [{
        id: latestPriceId,
        snapshot_id: "00000000-0000-4000-8000-000000000003",
        vendor_id: vendorId,
        vendor_slug: "sample-studio-a",
        vendor_name: "샘플스튜디오가",
        vendor_category: "studio",
        region_code: "seoul_gangnam3",
        agency_id: "00000000-0000-4000-8000-000000000004",
        agency_name: "샘플대행사가",
        period_label: "2026Q3",
        published_at: "2026-07-18T10:00:00.000Z",
        price_min_krw: 1_000_000,
        price_max_krw: 1_200_000,
        price_note: null,
        is_current: true,
      }, {
        id: olderPriceId,
        snapshot_id: "00000000-0000-4000-8000-000000000007",
        vendor_id: vendorId,
        vendor_slug: "sample-studio-a",
        vendor_name: "샘플스튜디오가",
        vendor_category: "studio",
        region_code: "seoul_gangnam3",
        agency_id: null,
        agency_name: null,
        period_label: "2026Q2",
        published_at: "2026-04-01T10:00:00.000Z",
        price_min_krw: 900_000,
        price_max_krw: 900_000,
        price_note: "이전 분기",
        is_current: true,
      }],
      v_public_official_price_options: [{
        id: "00000000-0000-4000-8000-000000000005",
        official_price_id: latestPriceId,
        name: "샘플 추가 구성",
        price_min_krw: 100_000,
        raw_text: "샘플 추가 구성 10만원",
        is_effectively_mandatory: false,
        sort_order: 0,
      }],
    };
    const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
    const from = vi.fn((table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "in", "eq", "order"] as const) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      }
      builder.range = async (start: number, end: number) => ({
        data: rows[table]?.slice(start, end + 1) ?? [],
        error: null,
      });
      return builder;
    });

    const result = await lookupPublishedVendorPrices({ rpc, from } as never, {
      query: "샘플스튜됴",
      category: "studio",
    });

    expect(rpc).toHaveBeenCalledWith("lookup_public_price_vendors", {
      p_query: "샘플스튜됴",
      p_category: "studio",
      p_limit: 3,
    });
    expect(result).toStrictEqual({
      matches: [{
        vendor: {
          id: vendorId,
          slug: "sample-studio-a",
          name: "샘플스튜디오가",
          category: "studio",
          region_code: "seoul_gangnam3",
        },
        period_label: "2026Q3",
        prices: [{
          agency: "샘플대행사가",
          price_min_krw: 1_000_000,
          price_max_krw: 1_200_000,
          price_note: null,
          options: [{
            name: "샘플 추가 구성",
            price_min_krw: 100_000,
            raw_text: "샘플 추가 구성 10만원",
            is_effectively_mandatory: false,
          }],
        }],
        detail_url: "/price/vendor/sample-studio-a",
      }],
      disclaimer: "공시 기준 가격이며 실제 계약 조건에 따라 달라질 수 있습니다.",
    });
    expect(from).toHaveBeenCalledWith("v_public_official_prices");
    expect(from).toHaveBeenCalledWith("v_public_official_price_options");
    expect(from).not.toHaveBeenCalledWith("v_private_admin_official_prices");
    expect(from).not.toHaveBeenCalledWith("v_private_admin_official_price_options");
    expect(calls.filter(({ method }) => method === "select"))
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({ args: [expect.stringContaining("source_quote")] }),
      ]));
  });
});
