import { createPublicClient } from "@/lib/supabase/public";
import { NextRequest, NextResponse } from "next/server";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";

const MAX_TAG_SOURCE_POSTS = 5_000;

// 인기 태그 조회
export async function GET(req: NextRequest) {
  try {
    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:popular-tags", req),
      { maxRequests: 60, windowMs: 60 * 1000 },
      { failClosed: true },
    );
    if (limited) {
      limited.headers.set("Cache-Control", "private, no-store, max-age=0");
      return limited;
    }

    // This response is deliberately invariant across caller cookies/tokens.
    // Use the anonymous public client so a request credential cannot widen it.
    const supabase = createPublicClient();

    // 최근 30일간 게시글의 태그 집계
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: posts, error } = await supabase
      .from("community_posts")
      .select("tags")
      .eq("visibility", "public")
      .eq("under_review", false)
      .gte("created_at", thirtyDaysAgo.toISOString())
      .not("tags", "eq", "{}")
      .order("created_at", { ascending: false })
      // 인기 태그는 보조 UI다. 트래픽이 커져도 한 요청이 지난 30일의
      // 모든 게시글을 메모리로 끌어오지 않도록 명시적으로 작업량을 제한한다.
      .limit(MAX_TAG_SOURCE_POSTS);

    if (error) {
      console.error("Popular tags error:", safeErrorDiagnostic(error));
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
    console.error("Popular tags error:", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
