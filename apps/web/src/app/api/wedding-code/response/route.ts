import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * WeddingCode and its response collection are retired. Keep this handler
 * request-independent so legacy clients cannot submit or persist answers.
 */
export async function POST() {
  return NextResponse.json(
    { error: "웨딩코드와 응답 수집은 현재 제공하지 않습니다." },
    { status: 410, headers: { "Cache-Control": "no-store" } }
  );
}
