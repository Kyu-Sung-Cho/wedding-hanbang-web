import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const RETIRED_RESPONSE = {
  error: "견적 체크 기능은 현재 신규 제공하지 않습니다.",
  code: "quote_check_retired",
} as const;

export async function POST(_request: NextRequest) {
  void _request;
  return NextResponse.json(RETIRED_RESPONSE, {
    status: 410,
    headers: NO_STORE_HEADERS,
  });
}
