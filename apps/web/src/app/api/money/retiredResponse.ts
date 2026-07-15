import { NextResponse } from "next/server";

export function congratulatoryMoneyRetiredResponse() {
  return NextResponse.json(
    {
      error: "축의금 관리는 현재 제공하지 않습니다. 제3자의 이름·관계·금액을 새로 수집하거나 표시하지 않습니다.",
      code: "congratulatory_money_retired",
    },
    {
      status: 410,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    },
  );
}
