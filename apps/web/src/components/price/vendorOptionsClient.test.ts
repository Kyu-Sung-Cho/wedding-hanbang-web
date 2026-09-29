import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PriceOption, PriceVendor } from "@/lib/price/catalog";

function vendor(count: number): PriceVendor {
  return {
    id: "vendor", slug: "vendor", name: "업체", aliases: [], category: "studio", regionCode: null,
    offers: Array.from({ length: count }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      agencyId: null, agencyName: "직접 공시", minimumKrw: 1000, maximumKrw: null,
      priceNote: null, baseSpec: null, options: [], optionCount: 1,
    })),
  };
}

function option(id: string): PriceOption & { officialPriceId: string } {
  return {
    id: `option-${id}`, officialPriceId: id, name: "추가금", minimumKrw: 1000,
    maximumKrw: null, unit: null, condition: null, rawText: "공개 추가금",
    isEffectivelyMandatory: false, sortOrder: 0,
  };
}

function ids(url: string) {
  return new URL(url, "https://hanbang.ai").searchParams.get("ids")!.split(",");
}

describe("vendor options client batches", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("splits a vendor with more than 60 offers into supported batches", async () => {
    const fetcher = vi.fn(async (url: string) => {
      const requested = ids(url);
      return Response.json({ options: requested.map(option) }, { status: requested.length > 60 ? 400 : 200 });
    });
    vi.stubGlobal("fetch", fetcher);
    const { loadVendorOptions } = await import("./vendorOptionsClient");
    const result = await loadVendorOptions(vendor(61));
    expect(fetcher.mock.calls.map(([url]) => ids(url).length)).toEqual([60, 1]);
    expect(result.size).toBe(61);
    expect([...result.values()].every((options) => options.length === 1)).toBe(true);
  });

  it("retries only a failed batch while retaining completed batch results", async () => {
    let shouldFailLast = true;
    const fetcher = vi.fn(async (url: string) => {
      const requested = ids(url);
      return shouldFailLast && requested.length === 1
        ? Response.json({ error: "unavailable" }, { status: 503 })
        : Response.json({ options: requested.map(option) });
    });
    vi.stubGlobal("fetch", fetcher);
    const { loadVendorOptions } = await import("./vendorOptionsClient");
    await expect(loadVendorOptions(vendor(61))).rejects.toThrow();
    shouldFailLast = false;
    const result = await loadVendorOptions(vendor(61));
    expect(fetcher.mock.calls.map(([url]) => ids(url).length)).toEqual([60, 1, 1]);
    expect([...result.values()].every((options) => options.length === 1)).toBe(true);
  });

  it("does not cache a malformed successful response as an empty option list", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ options: null }))
      .mockImplementation(async (url: string) => Response.json({ options: ids(url).map(option) }));
    vi.stubGlobal("fetch", fetcher);
    const { loadVendorOptions } = await import("./vendorOptionsClient");
    await expect(loadVendorOptions(vendor(1))).rejects.toThrow();
    const result = await loadVendorOptions(vendor(1));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect([...result.values()][0]).toHaveLength(1);
  });

  it("shares concurrent requests and uses completed cache entries", async () => {
    const fetcher = vi.fn(async (url: string) => Response.json({ options: ids(url).map(option) }));
    vi.stubGlobal("fetch", fetcher);
    const { loadVendorOptions } = await import("./vendorOptionsClient");
    await Promise.all([loadVendorOptions(vendor(2)), loadVendorOptions(vendor(2))]);
    await loadVendorOptions(vendor(2));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["invalid-row", "unexpected-parent", "duplicate-row"])(
    "does not poison the cache with a %s after valid rows",
    async (kind) => {
      const id = vendor(1).offers[0].id;
      const first = option(id);
      const invalid = kind === "invalid-row" ? { ...first, minimumKrw: -1 }
        : kind === "unexpected-parent" ? option("other-parent") : first;
      const fetcher = vi.fn()
        .mockResolvedValueOnce(Response.json({ options: [first, invalid] }))
        .mockResolvedValueOnce(Response.json({ options: [first] }));
      vi.stubGlobal("fetch", fetcher);
      const { loadVendorOptions } = await import("./vendorOptionsClient");
      await expect(loadVendorOptions(vendor(1))).rejects.toThrow();
      const result = await loadVendorOptions(vendor(1));
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect([...result.values()][0]).toHaveLength(1);
    },
  );

  it("accepts the public row mapper's nullable money and fallback sort order", async () => {
    const { optionFromRow } = await import("@/lib/price/publicListData");
    const id = vendor(1).offers[0].id;
    const mapped = optionFromRow({
      id: "mapped-option", official_price_id: id, name: "원문 옵션", raw_text: "별도 문의",
      price_min_krw: -1, price_max_krw: Number.POSITIVE_INFINITY, unit: null,
      condition: null, is_effectively_mandatory: null, sort_order: null,
    });
    expect(mapped).toMatchObject({ minimumKrw: null, maximumKrw: null, sortOrder: Number.MAX_SAFE_INTEGER });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ options: [{ ...mapped, officialPriceId: id }] })));
    const { loadVendorOptions } = await import("./vendorOptionsClient");
    const result = await loadVendorOptions(vendor(1));
    expect(result.get(id)).toEqual([mapped]);
  });
});
