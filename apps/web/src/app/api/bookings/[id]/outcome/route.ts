import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const BOOKING_OUTCOMES_ENABLED = false as const;
export const BOOKING_OUTCOMES_DISABLED_CODE = "booking_outcomes_disabled" as const;

/**
 * A consultation request is not proof of a contract, payment, completed
 * service, or publishable review. This endpoint remains a 410-only boundary
 * and intentionally contains no auth, body parsing, PII, or persistence path.
 */
export async function PATCH(
  _request: Request,
  _context: { params: Promise<{ id: string }> },
) {
  void _request;
  void _context;
  return NextResponse.json(
    {
      error: "과거·예시 요청은 조회 전용입니다. 결과 저장과 공개 후기는 현재 지원하지 않습니다.",
      code: BOOKING_OUTCOMES_DISABLED_CODE,
    },
    {
      status: 410,
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
