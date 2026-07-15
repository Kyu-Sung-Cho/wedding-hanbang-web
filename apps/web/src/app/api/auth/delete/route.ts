import { NextResponse } from "next/server";

const ACCOUNT_DELETION_UNAVAILABLE_MESSAGE =
  "현재 계정 삭제 요청은 안전한 처리와 복구 절차를 검증 중이라 접수하지 않습니다. 제공 준비가 끝나기 전에는 요청을 저장하거나 로그아웃시키지 않습니다.";

/**
 * 계정 삭제는 비가역 작업이다. 공개 베타 capability가 꺼진 동안에는
 * 환경변수, 인증 상태, 요청 본문과 무관하게 큐나 데이터베이스에 접근하지 않는다.
 */
export async function DELETE() {
  return NextResponse.json(
    {
      accepted: false,
      code: "ACCOUNT_DELETION_UNAVAILABLE",
      message: ACCOUNT_DELETION_UNAVAILABLE_MESSAGE,
      error: ACCOUNT_DELETION_UNAVAILABLE_MESSAGE,
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Retry-After": "3600",
      },
    },
  );
}
