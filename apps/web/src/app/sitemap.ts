import { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = "https://hanbang.ai";

// 서비스 역할 키로 Supabase 클라이언트 생성 (RLS 우회)
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = getServiceClient();

  // 정적 페이지
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
      url: `${BASE_URL}/login`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/vendor/login`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];

  // 커뮤니티 게시글 동적 페이지
  let communityPages: MetadataRoute.Sitemap = [];
  try {
    const { data: posts } = await supabase
      .from("community_posts")
      .select("id, updated_at")
      .order("updated_at", { ascending: false })
      .limit(5000);

    if (posts) {
      communityPages = posts.map((post) => ({
        url: `${BASE_URL}/wedding/community/post/${post.id}`,
        lastModified: new Date(post.updated_at),
        changeFrequency: "weekly" as const,
        priority: 0.6,
      }));
    }
  } catch {
    // DB 오류 시 동적 페이지 없이 정적 페이지만 반환
  }

  // 업체 페이지는 사용자 측 비활성 — 사이트맵에서 제외
  // (업체 DB가 쌓이고 /vendors 사용자 측 재오픈 시 복원 검토)

  return [...staticPages, ...communityPages];
}
