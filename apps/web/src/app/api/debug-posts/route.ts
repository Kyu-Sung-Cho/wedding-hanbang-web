import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    // 1단계: createClientFromRequest import
    const { createClientFromRequest } = await import("@/lib/supabase/server");

    // 2단계: 클라이언트 생성
    const supabase = await createClientFromRequest(req);

    // 3단계: 간단한 쿼리
    const { data, error } = await supabase
      .from("community_posts")
      .select("id, title, category")
      .limit(1);

    if (error) {
      return NextResponse.json({ step: "query", error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, posts: data });
  } catch (err) {
    return NextResponse.json({
      step: "catch",
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 5) : undefined,
    }, { status: 500 });
  }
}
