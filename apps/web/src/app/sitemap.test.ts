import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalPublishedVendorSlugSha256 } from "@/lib/price/staticVendorSlugs";

type PublicVendorRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  region_code: string | null;
};

const mocks = vi.hoisted(() => ({
  vendorRows: [] as Array<{
    official_price_id: string;
    vendor_slug: string;
    published_at: string | null;
  }>,
  failVendorPageStartingAt: null as number | null,
  vendorRanges: vi.fn(),
  vendorOrders: vi.fn(),
  publicVendorRows: null as PublicVendorRow[] | null,
  identityLookups: vi.fn(),
  failIdentityLookup: false,
  failVendorSeeds: false,
  activeIdentityLookups: 0,
  peakIdentityLookups: 0,
  rejectIdentityLookup: false,
  failIdentityPattern: null as string | null,
  identityRanges: vi.fn(),
  failIdentityPageStartingAt: null as number | null,
  publicIdentityCount: undefined as number | null | undefined,
}));

vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: vi.fn(() => ({
    from(table: string) {
      if (table === "v_public_vendors") {
        let slugs: string[] | null = null;
        let category: string | null = null;
        let pattern = "";
        const rows = () => mocks.publicVendorRows ?? [...new Set(mocks.vendorRows.map((row) => row.vendor_slug))]
          .map((slug) => ({ id: slug, slug, name: slug, category: "studio", region_code: null }));
        const query = {
          select: vi.fn(() => query),
          in: vi.fn((_column: string, values: string[]) => { slugs = values; return query; }),
          eq: vi.fn((_column: string, value: string) => { category = value; return query; }),
          ilike: vi.fn((_column: string, value: string) => { pattern = value; return query; }),
          order: vi.fn(() => query),
          range: vi.fn(async (from: number, to: number) => {
            mocks.identityRanges(from, to);
            return {
              data: rows().filter((row) => !slugs || slugs.includes(row.slug))
                .sort((left, right) => left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0)
                .slice(from, to + 1),
              count: mocks.publicIdentityCount === undefined ? rows().length : mocks.publicIdentityCount,
              error: mocks.failVendorSeeds || mocks.failIdentityPageStartingAt === from ? { code: "provider_error" } : null,
            };
          }),
          limit: vi.fn(async (limit: number) => {
            mocks.identityLookups(category, pattern);
            mocks.activeIdentityLookups += 1;
            mocks.peakIdentityLookups = Math.max(mocks.peakIdentityLookups, mocks.activeIdentityLookups);
            await Promise.resolve();
            mocks.activeIdentityLookups -= 1;
            if (mocks.rejectIdentityLookup) throw new Error("network_error");
            const matcher = new RegExp(`^${pattern.split("%").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i");
            return {
              data: rows().filter((row) => row.category === category && matcher.test(row.name))
                .sort((left, right) => left.slug.localeCompare(right.slug)).slice(0, limit),
              error: mocks.failIdentityLookup || mocks.failIdentityPattern === pattern ? { code: "provider_error" } : null,
            };
          }),
        };
        return query;
      }
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
    mocks.publicVendorRows = null;
    mocks.identityLookups.mockClear();
    mocks.failIdentityLookup = false;
    mocks.failVendorSeeds = false;
    mocks.activeIdentityLookups = 0;
    mocks.peakIdentityLookups = 0;
    mocks.rejectIdentityLookup = false;
    mocks.failIdentityPattern = null;
    mocks.identityRanges.mockClear();
    mocks.failIdentityPageStartingAt = null;
    mocks.publicIdentityCount = undefined;
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

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        url: "https://hanbang.ai/landing",
        priority: 1,
      }),
    ]));
    expect(result.some(({ url }) => url.includes("/price/vendor/"))).toBe(false);
    expect(mocks.vendorRanges).not.toHaveBeenCalled();
  });

  it("excludes unvalidated WeddingCode entries and all answer-carrying links", async () => {
    vi.stubEnv("CI", "true");

    const urls = (await sitemap()).map(({ url }) => url);

    expect(urls).not.toContain("https://hanbang.ai/wedding-code");
    expect(urls).not.toContain("https://hanbang.ai/wedding-code-next");
    expect(urls.some((url) => /wedding-code.*[?#]/.test(url))).toBe(false);
  });

  it("omits unknown static modification dates instead of claiming the build time", async () => {
    vi.stubEnv("CI", "true");

    const result = await sitemap();

    expect(result.length).toBeGreaterThan(0);
    expect(result.every((entry) => !("lastModified" in entry))).toBe(true);
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
    expect(mocks.identityLookups).not.toHaveBeenCalled();
    expect(mocks.identityRanges).toHaveBeenNthCalledWith(1, 0, 499);
    expect(mocks.identityRanges).toHaveBeenNthCalledWith(2, 500, 999);
    expect(mocks.peakIdentityLookups).toBeLessThanOrEqual(4);
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

  it("keeps only the detail canonical, including a public sibling without current prices", async () => {
    mocks.vendorRows = [
      { official_price_id: "price-b", vendor_slug: "mei-b", published_at: "2026-07-01T00:00:00.000Z" },
      { official_price_id: "price-c", vendor_slug: "mei-c", published_at: "2026-07-18T09:30:00.000Z" },
    ];
    mocks.publicVendorRows = ["mei-a", "mei-b", "mei-c"].map((slug) => ({
      id: slug, slug, name: "메이 스튜디오", category: "studio", region_code: null,
    }));
    vi.stubEnv("HANBANG_DEPLOYMENT_ENV", "production");
    vi.stubEnv("PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_COUNT", "2");
    vi.stubEnv("PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_SLUGS_SHA256", canonicalPublishedVendorSlugSha256(["mei-b", "mei-c"]));

    const result = (await sitemap()).filter(({ url }) => url.includes("/price/vendor/"));

    expect(result).toEqual([
      expect.objectContaining({ url: "https://hanbang.ai/price/vendor/mei-a", lastModified: new Date("2026-07-18T09:30:00.000Z") }),
    ]);
    expect(mocks.identityLookups).toHaveBeenCalledTimes(1);
    await sitemap();
    expect(mocks.identityLookups).toHaveBeenCalledTimes(2);
  });

  it("preserves the detail resolver's name-change pattern and self inclusion", async () => {
    mocks.vendorRows = [
      { official_price_id: "price-a", vendor_slug: "dress-a", published_at: null },
      { official_price_id: "price-z", vendor_slug: "dress-z", published_at: null },
    ];
    mocks.publicVendorRows = [
      { id: "a", slug: "dress-a", name: "레이첼웨딩", category: "dress", region_code: null },
      { id: "z", slug: "dress-z", name: "르네아뜰리에", category: "dress", region_code: null },
    ];

    const result = (await sitemap()).filter(({ url }) => url.includes("/price/vendor/"));

    expect(result.map(({ url }) => url)).toEqual([
      "https://hanbang.ai/price/vendor/dress-a",
      "https://hanbang.ai/price/vendor/dress-z",
    ]);
    expect(result.every((entry) => !("lastModified" in entry))).toBe(true);
    expect(mocks.identityLookups).toHaveBeenCalledTimes(1);
  });

  it("rejects a canonical whose own detail cannot see the alias's current price", async () => {
    mocks.vendorRows = [{ official_price_id: "price-z", vendor_slug: "dress-z", published_at: null }];
    mocks.publicVendorRows = [
      { id: "z", slug: "dress-z", name: "레이첼웨딩", category: "dress", region_code: null },
      { id: "a", slug: "dress-a", name: "르네아뜰리에", category: "dress", region_code: null },
    ];

    await expect(sitemap()).rejects.toThrow("PUBLIC_VENDOR_SITEMAP_CANONICAL_WITHOUT_CURRENT_PRICE");
  });

  it("fails rather than publishing alias URLs when identity lookup fails", async () => {
    mocks.vendorRows = [{ official_price_id: "price", vendor_slug: "vendor-a", published_at: null }];
    mocks.publicVendorRows = ["vendor-0", "vendor-a"].map((slug) => ({ id: slug, slug, name: "메이", category: "studio", region_code: null }));
    mocks.failIdentityLookup = true;

    await expect(sitemap()).rejects.toThrow("PUBLIC_VENDOR_IDENTITY_UNAVAILABLE");
  });

  it("fails when a published slug has no public vendor seed", async () => {
    mocks.vendorRows = [{ official_price_id: "price", vendor_slug: "vendor-a", published_at: null }];
    mocks.publicVendorRows = [];

    await expect(sitemap()).rejects.toThrow("PUBLIC_VENDOR_SITEMAP_IDENTITY_MISSING");
  });

  it.each(["failVendorSeeds", "rejectIdentityLookup"] as const)("propagates %s without a raw-slug fallback", async (failure) => {
    mocks.vendorRows = [{ official_price_id: "price", vendor_slug: "vendor-a", published_at: null }];
    mocks.publicVendorRows = ["vendor-0", "vendor-a"].map((slug) => ({ id: slug, slug, name: "메이", category: "studio", region_code: null }));
    mocks[failure] = true;

    await expect(sitemap()).rejects.toThrow("PUBLIC_VENDOR_IDENTITY_UNAVAILABLE");
  });

  it("stops scheduling further lookups after one worker fails", async () => {
    mocks.vendorRows = Array.from({ length: 12 }, (_, index) => ({
      official_price_id: `price-${index}`,
      vendor_slug: `vendor-${String(index).padStart(3, "0")}`,
      published_at: null,
    }));
    mocks.publicVendorRows = mocks.vendorRows.flatMap(({ vendor_slug: slug }) => [
      { id: slug, slug, name: slug, category: "studio", region_code: null },
      { id: `aaa-${slug}`, slug: `aaa-${slug}`, name: slug, category: "studio", region_code: null },
    ]);
    mocks.failIdentityPattern = "%v%e%n%d%o%r%0%0%0%";

    await expect(sitemap()).rejects.toThrow("PUBLIC_VENDOR_IDENTITY_UNAVAILABLE");
    await Promise.resolve();

    expect(mocks.identityLookups).toHaveBeenCalledTimes(4);
    expect(mocks.peakIdentityLookups).toBe(4);
  });

  it("skips only provable minima and keeps the existing resolver for larger siblings", async () => {
    mocks.vendorRows = ["mei-a", "mei-b"].map((slug) => ({ official_price_id: slug, vendor_slug: slug, published_at: null }));
    mocks.publicVendorRows = ["mei-a", "mei-b"].map((slug) => ({ id: slug, slug, name: "메이", category: "studio", region_code: null }));

    const result = (await sitemap()).filter(({ url }) => url.includes("/price/vendor/"));

    expect(result.map(({ url }) => url)).toEqual(["https://hanbang.ai/price/vendor/mei-a"]);
    expect(mocks.identityLookups).toHaveBeenCalledTimes(1);
  });

  it.each(["duplicate", "invalid", "later-page"] as const)("rejects an incomplete public identity scan: %s", async (failure) => {
    mocks.vendorRows = [{ official_price_id: "price", vendor_slug: "vendor-a", published_at: null }];
    const seed = { id: "vendor-a", slug: "vendor-a", name: "메이", category: "studio", region_code: null };
    if (failure === "duplicate") mocks.publicVendorRows = [seed, seed];
    if (failure === "invalid") mocks.publicVendorRows = [seed, { ...seed, id: "other", slug: "/invalid" }];
    if (failure === "later-page") {
      mocks.publicVendorRows = [seed];
      mocks.failIdentityPageStartingAt = 1;
    }

    await expect(sitemap()).rejects.toThrow(failure === "later-page"
      ? "PUBLIC_VENDOR_IDENTITY_UNAVAILABLE" : "PUBLIC_VENDOR_SITEMAP_IDENTITY_INVALID");
    expect(mocks.identityLookups).not.toHaveBeenCalled();
  });

  it.each([
    [null, "PUBLIC_VENDOR_SITEMAP_IDENTITY_INVALID"],
    [2, "PUBLIC_VENDOR_SITEMAP_IDENTITY_INCOMPLETE"],
    [50_001, "PUBLIC_VENDOR_SITEMAP_IDENTITY_LIMIT"],
  ] as const)("rejects an unverified public identity count: %s", async (count, error) => {
    mocks.vendorRows = [{ official_price_id: "price", vendor_slug: "vendor-a", published_at: null }];
    mocks.publicIdentityCount = count;

    await expect(sitemap()).rejects.toThrow(error);
    expect(mocks.identityLookups).not.toHaveBeenCalled();
  });

  it("keeps same-name business exceptions and exact DB categories separate", async () => {
    mocks.publicVendorRows = [
      { id: "a", slug: "studio-a", name: "랑게", category: "studio", region_code: null },
      { id: "b", slug: "studio-b", name: "랑게", category: "studio", region_code: null },
      { id: "c", slug: "hall-a", name: "메이", category: "hall", region_code: null },
      { id: "d", slug: "venue-b", name: "메이", category: "venue", region_code: null },
    ];
    mocks.vendorRows = mocks.publicVendorRows.map(({ slug }) => ({ official_price_id: slug, vendor_slug: slug, published_at: null }));
    mocks.failIdentityLookup = true;

    const result = (await sitemap()).filter(({ url }) => url.includes("/price/vendor/"));

    expect(result).toHaveLength(4);
    expect(mocks.identityLookups).not.toHaveBeenCalled();
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
