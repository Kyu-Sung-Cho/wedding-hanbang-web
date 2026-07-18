export type PublicVendorSlugPage = {
  data: Array<{ vendor_slug: unknown }> | null;
  error: unknown;
};

const PUBLIC_VENDOR_SLUG_PAGE_SIZE = 500;
const PUBLIC_VENDOR_SLUG_CAP = 50_000;
const SAFE_VENDOR_SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;

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

export function requiredPublishedVendorMinimum(
  env: Readonly<Record<string, string | undefined>>,
): number {
  const isProduction = env.VERCEL_ENV === "production"
    || env.HANBANG_DEPLOYMENT_ENV === "production";
  if (!isProduction) return 0;

  const raw = env.PRICE_CATALOG_MIN_PUBLISHED_VENDORS;
  if (!raw || !/^[1-9][0-9]{0,5}$/.test(raw)) {
    throw new Error("PRICE_CATALOG_MIN_PUBLISHED_VENDORS_REQUIRED");
  }
  return Number(raw);
}

export function assertPublishedVendorMinimum(actual: number, minimum: number): void {
  if (!Number.isSafeInteger(actual) || actual < minimum) {
    throw new Error("PUBLIC_VENDOR_STATIC_PARAMS_BELOW_MINIMUM");
  }
}
