import { createHash } from "node:crypto";

export type PublicVendorSlugPage = {
  data: Array<{ vendor_slug: unknown }> | null;
  error: unknown;
};

const PUBLIC_VENDOR_SLUG_PAGE_SIZE = 500;
const PUBLIC_VENDOR_SLUG_CAP = 50_000;
const SAFE_VENDOR_SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export type PublishedVendorCatalogExpectation = {
  count: number;
  slugSha256: string;
};

export async function collectPublishedVendorSlugs(
  fetchPage: (from: number, to: number) => Promise<PublicVendorSlugPage>,
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<string[]> {
  const pageSize = options.pageSize ?? PUBLIC_VENDOR_SLUG_PAGE_SIZE;
  const maxRows = options.maxRows ?? PUBLIC_VENDOR_SLUG_CAP;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1
    || !Number.isSafeInteger(maxRows) || maxRows < 1) {
    throw new Error("PUBLIC_VENDOR_STATIC_PARAMS_LIMIT_INVALID");
  }

  const slugs = new Set<string>();
  let fetched = 0;
  while (true) {
    const remaining = maxRows - fetched;
    const requested = remaining > 0 ? Math.min(pageSize, remaining) : 1;
    const page = await fetchPage(fetched, fetched + requested - 1);
    if (page.error) throw new Error("PUBLIC_VENDOR_STATIC_PARAMS_UNAVAILABLE");
    const rows = page.data ?? [];
    if (!Array.isArray(rows) || rows.length > requested) {
      throw new Error("PUBLIC_VENDOR_STATIC_PARAMS_INVALID");
    }
    if (remaining === 0) {
      if (rows.length > 0) throw new Error("PUBLIC_VENDOR_STATIC_PARAMS_LIMIT");
      break;
    }
    if (rows.length === 0) break;

    for (const row of rows) {
      if (typeof row.vendor_slug !== "string" || !SAFE_VENDOR_SLUG.test(row.vendor_slug)) {
        throw new Error("PUBLIC_VENDOR_STATIC_PARAMS_INVALID");
      }
      slugs.add(row.vendor_slug);
    }
    fetched += rows.length;
    if (rows.length < requested) break;
  }
  return [...slugs].sort((left, right) => left.localeCompare(right, "en"));
}

export function requiredPublishedVendorCatalogExpectation(
  env: Readonly<Record<string, string | undefined>>,
): PublishedVendorCatalogExpectation | null {
  const isProduction = env.VERCEL_ENV === "production"
    || env.HANBANG_DEPLOYMENT_ENV === "production";
  if (!isProduction) return null;

  const rawCount = env.PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_COUNT;
  if (!rawCount || !/^[1-9][0-9]{0,5}$/.test(rawCount)) {
    throw new Error("PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_COUNT_REQUIRED");
  }

  const slugSha256 = env.PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_SLUGS_SHA256;
  if (!slugSha256 || !SHA256_HEX.test(slugSha256)) {
    throw new Error("PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_SLUGS_SHA256_REQUIRED");
  }

  return { count: Number(rawCount), slugSha256 };
}

export function assertPublishedVendorCatalog(
  slugs: readonly string[],
  expectation: PublishedVendorCatalogExpectation,
): void {
  const uniqueSlugs = new Set(slugs);
  if (uniqueSlugs.size !== expectation.count) {
    throw new Error("PUBLIC_VENDOR_CATALOG_COUNT_MISMATCH");
  }
  if (canonicalPublishedVendorSlugSha256(slugs) !== expectation.slugSha256) {
    throw new Error("PUBLIC_VENDOR_CATALOG_DIGEST_MISMATCH");
  }
}

export function canonicalPublishedVendorSlugSha256(slugs: readonly string[]): string {
  const canonicalSlugs = [...new Set(slugs)];
  if (canonicalSlugs.some((slug) => !SAFE_VENDOR_SLUG.test(slug))) {
    throw new Error("PUBLIC_VENDOR_CATALOG_INVALID");
  }
  canonicalSlugs.sort();
  return createHash("sha256")
    .update(JSON.stringify(canonicalSlugs), "utf8")
    .digest("hex");
}
