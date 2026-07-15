import { NextResponse } from "next/server";
import { AMORA_ACTIONS_RETIRED_CODE } from "../route";

export const dynamic = "force-dynamic";

/** 기존 행은 보존하되 공개 베타에서 더 이상 상태를 변경하지 않는다. */
export async function PATCH() {
  return NextResponse.json(
    {
      code: AMORA_ACTIONS_RETIRED_CODE,
      error:
        "아모라 행동 기능은 종료되었습니다. 준비 항목은 체크리스트에, 날짜가 있는 약속은 일정에 직접 기록해 주세요.",
    },
    {
      status: 410,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
