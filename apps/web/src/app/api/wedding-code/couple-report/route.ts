import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** See the pairing route. Plaintext query-token report access is disabled. */
export async function GET() {
  return NextResponse.json(
    { error: "커플 비교 기능을 안전 점검 중입니다.", status: "disabled" },
    { status: 410, headers: { "Cache-Control": "no-store" } }
  );
}
