import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 서로 다른 포함 범위의 견적을 하나의 평균과 비교하면 사용자가 가격의
 * 적정성을 오해할 수 있다. 기존 세션 없는 자동 판정 경로와 신규 구조화
 * 가격 입력은 영구 중단한다. 과거 입력은 사용자 작성 기록으로만 조회한다.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "자동 가격 판정은 중단되었습니다. 계약서의 포함 항목과 추가 조건을 직접 확인해 주세요.",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
