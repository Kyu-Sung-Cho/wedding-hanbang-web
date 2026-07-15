import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      error: "커뮤니티 미디어는 안전한 보관·삭제 수명주기가 검증될 때까지 제공하지 않습니다.",
      code: "community_media_retired",
    },
    {
      status: 410,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
