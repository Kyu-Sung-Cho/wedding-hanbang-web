import { NextResponse } from "next/server";

/**
 * Vendor onboarding and approval are outside the current service boundary.
 * Keep the historical path as a fixed response so an old admin client cannot
 * mutate vendor state or send approval/rejection email.
 */
export function PATCH() {
  return NextResponse.json(
    {
      code: "VENDOR_ADMIN_MUTATION_RETIRED",
      error: "업체 승인·반려·승인 취소 기능은 현재 운영하지 않습니다.",
    },
    {
      status: 410,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    },
  );
}
