import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export const AMORA_ACTIONS_RETIRED_CODE = "amora_actions_retired";

const RETIRED_BODY = {
  code: AMORA_ACTIONS_RETIRED_CODE,
  error:
    "아모라 행동 기능은 종료되었습니다. 준비 항목은 체크리스트에, 날짜가 있는 약속은 일정에 직접 기록해 주세요.",
};

function retiredResponse() {
  return NextResponse.json(RETIRED_BODY, {
    status: 410,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * 과거 행동 데이터는 삭제하지 않는다. 공개 베타에서는 역할이 겹치는 별도 행동
 * 시스템을 읽거나 쓰지 않고, 체크리스트와 사용자가 직접 등록한 일정을 사용한다.
 */
export async function GET() {
  return retiredResponse();
}

export async function POST() {
  return retiredResponse();
}
