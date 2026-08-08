import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 과거에는 계정에 저장한 견적 결과를 별도 공개 동의 없이 ID 링크로 노출했다.
 * 비공개 보관·철회 화면과 공개 공유 동의를 갖춘 새 흐름이 준비될 때까지 닫는다.
 */
export async function GET() {
  return NextResponse.json(
    { error: "공개 견적 링크 제공이 종료되었습니다." },
    {
      status: 410,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    },
  );
}
