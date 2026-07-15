import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "고객 행동 원시 로그 수집은 현재 제공하지 않습니다.",
      code: "customer_event_collection_retired",
    },
    {
      status: 410,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
