import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * The booking product is retired. Historical rows remain under the service's
 * retention/deletion rules, but are not exposed as a live booking capability.
 */
export async function GET() {
  return NextResponse.json(
    {
      error: "웨딩한방 예약 기능은 현재 제공하지 않습니다.",
      code: "booking_requests_retired",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
