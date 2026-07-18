import { describe, expect, it, vi } from "vitest";

import {
  assertPublishedVendorMinimum,
  collectPublishedVendorSlugs,
  requiredPublishedVendorMinimum,
} from "./staticVendorSlugs";

describe("published vendor static params", () => {
  it("paginates, deduplicates, and sorts the complete published slug set", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      vendor_slug: index === 500 ? "vendor-001" : `vendor-${String(index + 1).padStart(3, "0")}`,
    }));
    const fetchPage = vi.fn(async (from: number, to: number) => ({
      data: rows.slice(from, to + 1),
      error: null,
    }));

    const slugs = await collectPublishedVendorSlugs(fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(slugs).toHaveLength(500);
    expect(slugs).toEqual([...slugs].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("fails closed on provider errors, malformed slugs, and silent truncation", async () => {
    await expect(collectPublishedVendorSlugs(async () => ({
      data: null,
      error: { code: "provider_error" },
    }))).rejects.toThrow("PUBLIC_VENDOR_STATIC_PARAMS_UNAVAILABLE");

    await expect(collectPublishedVendorSlugs(async () => ({
      data: [{ vendor_slug: "Unsafe Slug" }],
      error: null,
    }))).rejects.toThrow("PUBLIC_VENDOR_STATIC_PARAMS_INVALID");

    const rows = [{ vendor_slug: "vendor-one" }, { vendor_slug: "vendor-two" }];
    await expect(collectPublishedVendorSlugs(
      async (from, to) => ({ data: rows.slice(from, to + 1), error: null }),
      { pageSize: 1, maxRows: 1 },
    )).rejects.toThrow("PUBLIC_VENDOR_STATIC_PARAMS_LIMIT");
  });

  it("requires an explicit positive production minimum and enforces it", () => {
    expect(requiredPublishedVendorMinimum({ VERCEL_ENV: "preview" })).toBe(0);
    expect(() => requiredPublishedVendorMinimum({ VERCEL_ENV: "production" }))
      .toThrow("PRICE_CATALOG_MIN_PUBLISHED_VENDORS_REQUIRED");
    expect(requiredPublishedVendorMinimum({
      VERCEL_ENV: "production",
      PRICE_CATALOG_MIN_PUBLISHED_VENDORS: "12",
    })).toBe(12);
    expect(() => assertPublishedVendorMinimum(11, 12))
      .toThrow("PUBLIC_VENDOR_STATIC_PARAMS_BELOW_MINIMUM");
    expect(() => assertPublishedVendorMinimum(12, 12)).not.toThrow();
  });
});
