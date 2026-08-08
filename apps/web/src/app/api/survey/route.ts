import { NextResponse } from "next/server";

export function POST() {
  return NextResponse.json(
    { error: "이 설문은 종료되었습니다." },
    {
      status: 410,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
