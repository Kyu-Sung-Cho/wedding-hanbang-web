import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    // community/posts/route.ts 와 동일한 import 테스트
    const { createClientFromRequest } = await import("@/lib/supabase/server");
    const { sanitizeHtml, sanitizeText } = await import("@/utils/sanitize");
    const { checkRateLimit, rateLimitKey } = await import("@/utils/rateLimit");

    let anthropicOk = false;
    try {
      await import("@anthropic-ai/sdk");
      anthropicOk = true;
    } catch (e) {
      return NextResponse.json({
        step: "anthropic-import",
        error: e instanceof Error ? e.message : String(e),
      }, { status: 500 });
    }

    const supabase = await createClientFromRequest(req);
    const { data, error } = await supabase
      .from("community_posts")
      .select("id, title")
      .limit(1);

    return NextResponse.json({
      ok: true,
      anthropicOk,
      sanitizeOk: typeof sanitizeHtml === "function",
      rateLimitOk: typeof checkRateLimit === "function",
      posts: data,
      queryError: error?.message ?? null,
    });
  } catch (err) {
    return NextResponse.json({
      step: "catch",
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
