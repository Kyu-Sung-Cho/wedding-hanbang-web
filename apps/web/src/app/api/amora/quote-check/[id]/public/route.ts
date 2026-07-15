import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Historical bearer-link reads are retired before parameters or storage. */
export async function GET() {
  return NextResponse.json(
    {
      error: "이전 견적 체크 공개 링크는 더 이상 제공하지 않습니다.",
      code: "quote_check_public_read_retired",
    },
    { status: 410, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
