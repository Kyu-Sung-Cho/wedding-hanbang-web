import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      error: "업체 연결 메시지함은 현재 제공하지 않습니다.",
      code: "vendor_messages_disabled",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
