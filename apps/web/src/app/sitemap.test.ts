import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  vendorRows: [] as Array<{
    official_price_id: string;
    vendor_slug: string;
    published_at: string | null;
  }>,
  failVendorPageStartingAt: null as number | null,
  vendorRanges: vi.fn(),
  vendorOrders: vi.fn(),
}));

vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: vi.fn(() => ({
    from(table: string) {
      if (table === "community_posts") {
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          order: vi.fn(() => query),
          limit: vi.fn(async () => ({ data: [] })),
        };
        return query;
      }

      if (table === "v_public_prices") {
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          order: vi.fn((column: string, options: { ascending: boolean }) => {
            mocks.vendorOrders(column, options);
            return query;
          }),
          range: vi.fn(async (from: number, to: number) => {
            mocks.vendorRanges(from, to);
            if (mocks.failVendorPageStartingAt === from) {
              return { data: null, error: { code: "provider_error" } };
            }
            return {
              data: mocks.vendorRows.slice(from, to + 1),
              error: null,
            };
          }),
        };
        return query;
      }

      throw new Error(`Unexpected table ${table}`);
    },
  })),
}));

import sitemap from "./sitemap";

describe("vendor sitemap", () => {
  beforeEach(() => {
    mocks.vendorRows = [];
    mocks.failVendorPageStartingAt = null;
    mocks.vendorRanges.mockClear();
    mocks.vendorOrders.mockClear();
    vi.stubEnv("CI", "false");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses static-only output for the exact CI placeholder environment", async () => {
    vi.stubEnv("CI", "true");

    const result = await sitemap();

    expect(result.some(({ url }) => url.includes("/price/vendor/"))).toBe(false);
    expect(mocks.vendorRanges).not.toHaveBeenCalled();
  });

  it("publishes every unique vendor beyond one page with its latest real publication time", async () => {
    mocks.vendorRows = [
      ...Array.from({ length: 501 }, (_, index) => ({
        official_price_id: `price-${String(index).padStart(3, "0")}`,
        vendor_slug: `vendor-${String(index).padStart(3, "0")}`,
        published_at: "2026-07-01T00:00:00.000Z",
      })),
      {
        official_price_id: "price-latest-duplicate",
        vendor_slug: "vendor-000",
        published_at: "2026-07-18T09:30:00.000Z",
      },
    ];

    const result = await sitemap();
    const vendorPages = result.filter(({ url }) => url.includes("/price/vendor/"));

    expect(mocks.vendorRanges).toHaveBeenNthCalledWith(1, 0, 499);
    expect(mocks.vendorRanges).toHaveBeenNthCalledWith(2, 500, 999);
    expect(vendorPages).toHaveLength(501);
    expect(vendorPages.find(({ url }) => url.endsWith("/vendor-000"))?.lastModified)
      .toEqual(new Date("2026-07-18T09:30:00.000Z"));
    expect(mocks.vendorOrders.mock.calls).toEqual([
      ["vendor_slug", { ascending: true }],
      ["published_at", { ascending: false }],
      ["official_price_id", { ascending: true }],
      ["vendor_slug", { ascending: true }],
      ["published_at", { ascending: false }],
      ["official_price_id", { ascending: true }],
    ]);
  });

  it("fails instead of publishing a partial vendor sitemap when a later page errors", async () => {
    mocks.vendorRows = Array.from({ length: 501 }, (_, index) => ({
      official_price_id: `price-${index}`,
      vendor_slug: `vendor-${String(index).padStart(3, "0")}`,
      published_at: "2026-07-01T00:00:00.000Z",
    }));
    mocks.failVendorPageStartingAt = 500;

    await expect(sitemap()).rejects.toThrow("PUBLIC_VENDOR_STATIC_PARAMS_UNAVAILABLE");
  });

  it("fails instead of silently truncating vendors beyond the bounded sitemap scan", async () => {
    mocks.vendorRows = Array.from({ length: 50_001 }, (_, index) => ({
      official_price_id: `price-${index}`,
      vendor_slug: `vendor-${String(index).padStart(5, "0")}`,
      published_at: "2026-07-01T00:00:00.000Z",
    }));

    await expect(sitemap()).rejects.toThrow("PUBLIC_VENDOR_STATIC_PARAMS_LIMIT");
    expect(mocks.vendorRanges).toHaveBeenLastCalledWith(50_000, 50_000);
  });
});
