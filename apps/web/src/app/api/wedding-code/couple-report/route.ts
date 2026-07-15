import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** See the pairing route. Plaintext query-token report access is disabled. */
export async function GET() {
  return NextResponse.json(
    { error: "웨딩코드와 커플 비교는 현재 제공하지 않습니다.", status: "retired" },
    { status: 410, headers: { "Cache-Control": "no-store" } }
  );
}
