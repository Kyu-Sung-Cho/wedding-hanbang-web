import { MetadataRoute } from "next";
import { MANNERS_PARTS } from "@/lib/manners/data";
import { isPriceCatalogBuildPlaceholderEnvironment } from "@/lib/price/buildCatalog";
import { PRICE_CATEGORIES } from "@/lib/price/catalog";
import { vendorIdentityGroup } from "@/lib/price/vendorIdentity";
import {
  assertPublishedVendorCatalog,
  collectPublishedVendorSlugs,
  requiredPublishedVendorCatalogExpectation,
} from "@/lib/price/staticVendorSlugs";
import { createPublicClient } from "@/lib/supabase/public";
import {
  canonicalVendorSlug,
  loadVendorIdentityRows,
  type VendorIdentityCandidateCache,
  type VendorIdentityRow,
} from "@/lib/vendors/publicVendorPriceData";

const BASE_URL = "https://hanbang.ai";

type SitemapVendorRow = {
  official_price_id: string;
  vendor_slug: string;
  published_at: string | null;
};

type SitemapVendorBuilder = {
  eq(column: string, value: unknown): SitemapVendorBuilder;
  order(column: string, options: { ascending: boolean }): SitemapVendorBuilder;
  range(from: number, to: number): Promise<{
    data: SitemapVendorRow[] | null;
    error: unknown;
  }>;
};

type SitemapVendorClient = {
  from(table: "v_public_prices"): {
    select(columns: string): SitemapVendorBuilder;
  };
};

function publicationDate(value: string | null): Date | null {
  if (value === null) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("PUBLIC_VENDOR_SITEMAP_TIMESTAMP_INVALID");
  }
  return new Date(timestamp);
}

function isIdentityRow(value: unknown): value is VendorIdentityRow {
  return value !== null && typeof value === "object"
    && "id" in value && typeof value.id === "string" && value.id.length > 0
    && "slug" in value && typeof value.slug === "string" && /^[a-z0-9][a-z0-9-]{0,119}$/.test(value.slug)
    && "name" in value && typeof value.name === "string"
    && "category" in value && typeof value.category === "string"
    && "region_code" in value && (value.region_code === null || typeof value.region_code === "string");
}

async function loadPublicIdentityIndex(client: ReturnType<typeof createPublicClient>) {
  const bySlug = new Map<string, VendorIdentityRow>();
  const ids = new Set<string>();
  const maxRows = 50_000;
  let expectedCount: number | undefined;
  let from = 0;
  while (true) {
    const requested = Math.min(500, maxRows - from) || 1;
    const result = await client.from("v_public_vendors")
      .select("id, slug, name, category, region_code", from === 0 ? { count: "exact" } : undefined)
      .order("slug", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + requested - 1);
    if (result.error) throw new Error("PUBLIC_VENDOR_IDENTITY_UNAVAILABLE");
    if (from === 0) {
      if (typeof result.count !== "number" || !Number.isSafeInteger(result.count) || result.count < 0) {
        throw new Error("PUBLIC_VENDOR_SITEMAP_IDENTITY_INVALID");
      }
      if (result.count > maxRows) throw new Error("PUBLIC_VENDOR_SITEMAP_IDENTITY_LIMIT");
      expectedCount = result.count;
    }
    const rows: unknown = result.data;
    if (!Array.isArray(rows) || rows.length > requested) throw new Error("PUBLIC_VENDOR_SITEMAP_IDENTITY_INVALID");
    if (rows.length === 0) {
      if (bySlug.size !== expectedCount) throw new Error("PUBLIC_VENDOR_SITEMAP_IDENTITY_INCOMPLETE");
      return bySlug;
    }
    if (from + rows.length > maxRows) throw new Error("PUBLIC_VENDOR_SITEMAP_IDENTITY_LIMIT");
    for (const row of rows) {
      if (!isIdentityRow(row) || bySlug.has(row.slug) || ids.has(row.id)) {
        throw new Error("PUBLIC_VENDOR_SITEMAP_IDENTITY_INVALID");
      }
      bySlug.set(row.slug, row);
      ids.add(row.id);
    }
    from += rows.length;
  }
}

function identityGroupKey(vendor: VendorIdentityRow): string {
  const category = vendor.category === "venue" ? "hall" : vendor.category;
  return JSON.stringify([vendor.category, vendorIdentityGroup(category, vendor.name)]);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // 검증된 수정일이 없는 정적 페이지에는 빌드 시간을 lastModified로 싣지 않는다.
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/landing`,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/wedding`,
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/price`,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/start-here`,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    // 답이 없는 맨 주소만 싣는다. 답은 `#` 뒤에 실려 색인 대상이 아니고,
    // 페이지도 맨 주소에만 `index`를 준다(`wedding-code/page.tsx`).
    {
      url: `${BASE_URL}/wedding-code`,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    // `/manners`가 아니라 `/wedding/manners`를 싣는다. weddingAppRoutes에 들어간
    // 뒤로 `/manners`는 `/wedding/manners`로 리다이렉트되므로, 리다이렉트 원본을
    // 사이트맵에 실으면 색인이 한 단계 낭비된다.
    {
      url: `${BASE_URL}/wedding/manners`,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    ...MANNERS_PARTS.map((part) => ({
      url: `${BASE_URL}/wedding/manners/${part.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    ...PRICE_CATEGORIES.map((category) => ({
      url: `${BASE_URL}/price/${category}`,
      changeFrequency: "daily" as const,
      priority: 0.9,
    })),
    {
      url: `${BASE_URL}/wedding/community/quote-check`,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/login`,
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];

  if (isPriceCatalogBuildPlaceholderEnvironment(process.env)) {
    return staticPages;
  }

  const publicClient = createPublicClient();
  const supabase = publicClient as unknown as SitemapVendorClient;
  const latestPublicationBySlug = new Map<string, Date>();
  const vendorSlugs = await collectPublishedVendorSlugs(async (from, to) => {
    const page = await supabase
      .from("v_public_prices")
      .select("official_price_id, vendor_slug, published_at")
      .eq("is_current", true)
      .order("vendor_slug", { ascending: true })
      .order("published_at", { ascending: false })
      .order("official_price_id", { ascending: true })
      .range(from, to);

    if (!page.error) {
      for (const row of page.data ?? []) {
        const publishedAt = publicationDate(row.published_at);
        const previous = latestPublicationBySlug.get(row.vendor_slug);
        if (publishedAt && (!previous || publishedAt > previous)) {
          latestPublicationBySlug.set(row.vendor_slug, publishedAt);
        }
      }
    }
    return page;
  });
  const catalogExpectation = requiredPublishedVendorCatalogExpectation(process.env);
  if (catalogExpectation) {
    assertPublishedVendorCatalog(vendorSlugs, catalogExpectation);
  }
  if (vendorSlugs.length === 0) return staticPages;

  const seedBySlug = await loadPublicIdentityIndex(publicClient);
  if (vendorSlugs.some((slug) => !seedBySlug.has(slug))) {
    throw new Error("PUBLIC_VENDOR_SITEMAP_IDENTITY_MISSING");
  }
  const publishedSlugs = new Set(vendorSlugs);
  const minimumByGroup = new Map<string, string>();
  for (const seed of seedBySlug.values()) {
    const key = identityGroupKey(seed);
    const previous = minimumByGroup.get(key);
    if (!previous || seed.slug < previous) minimumByGroup.set(key, seed.slug);
  }

  // 한 실행 안의 진행 중 후보 조회도 공유한다. 상세와 같은 판정을 최대 4개씩 실행한다.
  const candidateCache: VendorIdentityCandidateCache = new Map();
  const canonicalBySlug = new Map<string, string>();
  let cursor = 0;
  let failed = false;
  await Promise.all(Array.from({ length: Math.min(4, vendorSlugs.length) }, async () => {
    try {
      while (!failed && cursor < vendorSlugs.length) {
        const slug = vendorSlugs[cursor++];
        const seed = seedBySlug.get(slug);
        if (!seed) throw new Error("PUBLIC_VENDOR_SITEMAP_IDENTITY_MISSING");
        // 상세 후보는 전체 공개 그룹의 부분집합+self다. 전체 그룹의 최소인 self는
        // ILIKE·200개 제한이 어떤 후보를 빼도 대표다. 나머지는 기존 조회로 판정한다.
        if (minimumByGroup.get(identityGroupKey(seed)) === slug) {
          canonicalBySlug.set(slug, slug);
          continue;
        }
        const identities = await loadVendorIdentityRows(publicClient, seed, { candidateCache, strict: true });
        const canonical = canonicalVendorSlug(identities.map((row) => row.slug), slug);
        if (!publishedSlugs.has(canonical)) {
          const representative = identities.find((row) => row.slug === canonical);
          if (!representative) throw new Error("PUBLIC_VENDOR_SITEMAP_IDENTITY_MISSING");
          const canonicalIdentities = await loadVendorIdentityRows(publicClient, representative, { candidateCache, strict: true });
          // 명칭 변경은 후보 조회가 비대칭일 수 있다. 대표 상세도 현재 가격을 찾을 수 있어야 한다.
          if (!canonicalIdentities.some((row) => publishedSlugs.has(row.slug))) {
            throw new Error("PUBLIC_VENDOR_SITEMAP_CANONICAL_WITHOUT_CURRENT_PRICE");
          }
        }
        canonicalBySlug.set(slug, canonical);
      }
    } catch (error) {
      failed = true;
      throw error;
    }
  }));
  const latestPublicationByCanonical = new Map<string, Date | undefined>();
  for (const slug of vendorSlugs) {
    const canonical = canonicalBySlug.get(slug);
    if (!canonical) throw new Error("PUBLIC_VENDOR_SITEMAP_IDENTITY_MISSING");
    const publishedAt = latestPublicationBySlug.get(slug);
    const previous = latestPublicationByCanonical.get(canonical);
    latestPublicationByCanonical.set(canonical, publishedAt && (!previous || publishedAt > previous) ? publishedAt : previous);
  }
  const vendorPages: MetadataRoute.Sitemap = [...latestPublicationByCanonical]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([slug, lastModified]) => ({
      url: `${BASE_URL}/price/vendor/${slug}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));

  return [...staticPages, ...vendorPages];
}
