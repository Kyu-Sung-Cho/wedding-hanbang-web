import { NextResponse } from "next/server";
import { resolveAmoraPreparationSource } from "@/lib/amora/preparationHandoff";

const HEADERS = { "Cache-Control": "no-store" };

/** 앱도 웹과 같은 공개 안내 ID를 사용한다. 사용자·커플 데이터나 AI 호출은 없다. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.getAll("source").length !== 1 || [...params.keys()].some(key => key !== "source")) {
    return NextResponse.json({ error: "invalid_preparation_source" }, { status: 400, headers: HEADERS });
  }
  const source = params.get("source")!;
  const draft = await resolveAmoraPreparationSource(source);
  if (!draft) {
    return NextResponse.json({ error: "invalid_preparation_source" }, { status: 400, headers: HEADERS });
  }
  // 원문은 모델 요청 시 서버가 다시 읽는다. 클라이언트는 공개 제목·짧은 질문만 받는다.
  return NextResponse.json({
    source,
    text: draft.text,
    sourceLabel: draft.sourceLabel,
    sourceHref: draft.sourceHref,
  }, { headers: HEADERS });
}
