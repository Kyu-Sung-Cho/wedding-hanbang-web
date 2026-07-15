import { NextResponse } from "next/server";

export const ADMIN_BOOKING_HISTORY_RETIRED = "ADMIN_BOOKING_HISTORY_RETIRED" as const;

/**
 * The booking product is retired. Keeping a convenience endpoint that lists
 * historical names, phone numbers and free-text notes would create an unnecessary PII
 * browsing surface, so operational retention/deletion work must use the
 * separately audited database procedure instead.
 */
export async function GET() {
  return NextResponse.json(
    {
      error: "과거 예약 개인정보 조회 화면은 종료되었습니다.",
      code: ADMIN_BOOKING_HISTORY_RETIRED,
    },
    {
      status: 410,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    },
  );
}
