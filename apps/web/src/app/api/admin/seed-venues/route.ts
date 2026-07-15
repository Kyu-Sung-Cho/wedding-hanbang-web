import { NextResponse } from "next/server";

const RETIRED_BODY = {
  error: "합성 업체 시드 경로는 종료되었습니다.",
  code: "synthetic_vendor_seed_retired",
} as const;

export function POST() {
  return NextResponse.json(RETIRED_BODY, {
    status: 410,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
