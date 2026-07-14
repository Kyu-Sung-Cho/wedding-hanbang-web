import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { error: "웨딩코드 커플 연결은 정식 검증 준비를 위해 중단되었습니다." },
    {
      status: 410,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
