import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Anonymous response collection is disabled until purpose/items/retention,
 * withdrawal/deletion, and consent versioning are implemented and reviewed.
 * The questionnaire still works entirely in the browser.
 */
export async function POST() {
  return NextResponse.json(
    { error: "응답 수집은 중단되었습니다. 개인 결과는 이 기기에서만 계산됩니다." },
    { status: 410, headers: { "Cache-Control": "no-store" } }
  );
}
