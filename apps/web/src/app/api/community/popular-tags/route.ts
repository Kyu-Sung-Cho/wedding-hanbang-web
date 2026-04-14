import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// 인기 태그 조회
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);

    // 최근 30일간 게시글의 태그 집계
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: posts, error } = await supabase
      .from("community_posts")
      .select("tags")
      .eq("visibility", "public")
      .gte("created_at", thirtyDaysAgo.toISOString())
      .not("tags", "eq", "{}");

    if (error) {
      console.error("Popular tags error:", error);
      return NextResponse.json(
        { error: "태그를 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    // 태그 카운트 집계
    const tagCounts: Record<string, number> = {};
    for (const post of posts ?? []) {
      if (post.tags && Array.isArray(post.tags)) {
        for (const tag of post.tags) {
          tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
        }
      }
    }

    // 상위 20개 태그 정렬
    const sortedTags = Object.entries(tagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }));

    return NextResponse.json(
      { tags: sortedTags },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      }
    );
  } catch (err) {
    console.error("Popular tags error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
