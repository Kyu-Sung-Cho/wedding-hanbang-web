import { NextResponse } from "next/server";

// New comment voting is retired with public-beta comment publishing.
// Historical aggregate counts remain available from the read-only comments API.
export async function POST() {
  return NextResponse.json(
    {
      code: "community_comment_votes_retired",
      error: "댓글 투표는 현재 제공하지 않습니다. 기존 좋아요 수는 읽기 정보로만 표시됩니다.",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
