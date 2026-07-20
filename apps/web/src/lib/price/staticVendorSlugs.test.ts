import { describe, expect, it, vi } from "vitest";

import {
  assertPublishedVendorCatalog,
  canonicalPublishedVendorSlugSha256,
  collectPublishedVendorSlugs,
  requiredPublishedVendorCatalogExpectation,
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

  it("requires an exact production catalog count and canonical slug digest", () => {
    expect(requiredPublishedVendorCatalogExpectation({ VERCEL_ENV: "preview" }))
      .toBeNull();
    expect(() => requiredPublishedVendorCatalogExpectation({
      VERCEL_ENV: "production",
      PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_COUNT: "12",
    })).toThrow("PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_SLUGS_SHA256_REQUIRED");
    expect(requiredPublishedVendorCatalogExpectation({
      VERCEL_ENV: "production",
      PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_COUNT: "12",
      PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_SLUGS_SHA256: "a".repeat(64),
    })).toEqual({ count: 12, slugSha256: "a".repeat(64) });
  });

  it("rejects a published catalog whose unique slug count is not exact", () => {
    expect(() => assertPublishedVendorCatalog(
      ["alpha", "beta"],
      { count: 1, slugSha256: "a".repeat(64) },
    )).toThrow("PUBLIC_VENDOR_CATALOG_COUNT_MISMATCH");
  });

  it("hashes the sorted unique slug list with one canonical encoding", () => {
    expect(canonicalPublishedVendorSlugSha256(["beta", "alpha", "beta"]))
      .toBe("138bf4722f7ae17122c7282d0eb156499d349940e129bd4cdf27c8ffdcbb3d25");
  });

  it("requires the exact canonical slug digest even when the count matches", () => {
    expect(() => assertPublishedVendorCatalog(
      ["beta", "alpha"],
      { count: 2, slugSha256: "a".repeat(64) },
    )).toThrow("PUBLIC_VENDOR_CATALOG_DIGEST_MISMATCH");
    expect(() => assertPublishedVendorCatalog(
      ["beta", "alpha"],
      {
        count: 2,
        slugSha256: "138bf4722f7ae17122c7282d0eb156499d349940e129bd4cdf27c8ffdcbb3d25",
      },
    )).not.toThrow();
  });
});
