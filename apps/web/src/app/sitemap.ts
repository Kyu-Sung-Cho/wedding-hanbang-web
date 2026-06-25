import { MetadataRoute } from "next";
import { PUBLIC_COMMUNITY_POST_VISIBILITY } from "@/lib/community/publicPostRules";
import { communityPostPath } from "@/lib/community/routes";
import { createPublicClient } from "@/lib/supabase/public";

const BASE_URL = "https://hanbang.ai";

type SitemapPostRow = {
  id: string;
  updated_at: string;
};

type SitemapPostBuilder = {
  eq(column: string, value: string): SitemapPostBuilder;
  order(column: string, options: { ascending: boolean }): SitemapPostBuilder;
  limit(count: number): Promise<{ data: SitemapPostRow[] | null }>;
};

type SitemapPostQuery = {
  select(columns: string): SitemapPostBuilder;
};

type SitemapPublicClient = {
  from(table: "community_posts"): SitemapPostQuery;
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/wedding`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/wedding/market-prices`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/wedding/etiquette`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
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

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return staticPages;
  }

  let communityPages: MetadataRoute.Sitemap = [];
  try {
    const supabase = createPublicClient() as unknown as SitemapPublicClient;
    const { data: posts } = await supabase
      .from("community_posts")
      .select("id, updated_at")
      .eq("visibility", PUBLIC_COMMUNITY_POST_VISIBILITY)
      .order("updated_at", { ascending: false })
      .limit(5000);

    if (posts) {
      communityPages = posts.map((post) => ({
        url: `${BASE_URL}${communityPostPath(post.id)}`,
        lastModified: new Date(post.updated_at),
        changeFrequency: "weekly" as const,
        priority: 0.6,
      }));
    }
  } catch {
    // Keep sitemap.xml available even if the dynamic community post query fails.
  }

  return [...staticPages, ...communityPages];
}
