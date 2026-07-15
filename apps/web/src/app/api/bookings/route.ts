import { NextResponse } from "next/server";

export const BOOKING_REQUESTS_ENABLED = false as const;
export const BOOKING_REQUESTS_DISABLED_CODE = "booking_requests_disabled" as const;

/**
 * Public booking delivery is retired until an independently verified vendor
 * delivery, consent, withdrawal, and status loop exists. Keep this route free
 * of authentication, request parsing, PII access, and persistence code so old
 * clients also fail closed before any user data can be handled.
 */
export async function POST(_request: Request) {
  void _request;
  return NextResponse.json(
    {
      error: "업체 연결을 현재 제공하지 않습니다. 상담 요청은 업체에 전송되지 않으며 저장되지 않습니다.",
      code: BOOKING_REQUESTS_DISABLED_CODE,
    },
    {
      status: 410,
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
