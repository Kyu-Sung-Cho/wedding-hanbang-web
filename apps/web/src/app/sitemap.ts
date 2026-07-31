import { MetadataRoute } from "next";
import { isPriceCatalogBuildPlaceholderEnvironment } from "@/lib/price/buildCatalog";
import { PRICE_CATEGORIES } from "@/lib/price/catalog";
import {
  assertPublishedVendorCatalog,
  collectPublishedVendorSlugs,
  requiredPublishedVendorCatalogExpectation,
} from "@/lib/price/staticVendorSlugs";
import { createPublicClient } from "@/lib/supabase/public";

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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/wedding`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/price`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/start-here`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    ...PRICE_CATEGORIES.map((category) => ({
      url: `${BASE_URL}/price/${category}`,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 0.9,
    })),
    {
      url: `${BASE_URL}/wedding/community/quote-check`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/login`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];

  if (isPriceCatalogBuildPlaceholderEnvironment(process.env)) {
    return staticPages;
  }

  let vendorPages: MetadataRoute.Sitemap = [];

  const supabase = createPublicClient() as unknown as SitemapVendorClient;
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
  vendorPages = vendorSlugs.map((slug) => {
    const lastModified = latestPublicationBySlug.get(slug);
    return {
      url: `${BASE_URL}/price/vendor/${slug}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    };
  });

  return [...staticPages, ...vendorPages];
}
