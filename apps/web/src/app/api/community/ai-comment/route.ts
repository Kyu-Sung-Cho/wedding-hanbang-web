import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Hidden AI-authored community comments are not part of the product. */
export async function POST() {
  return NextResponse.json(
    {
      error: "커뮤니티 AI 댓글 생성은 제공하지 않습니다.",
      code: "community_ai_comments_retired",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
