import { NextResponse } from "next/server";

/**
 * Persistent chat-image access is disabled until attachments have an
 * owner/visibility/message lifecycle table and deletion outbox. Returning no
 * signed URL also makes legacy orphan paths unusable through the application.
 */
export async function POST(_request: Request) {
  void _request;
  return NextResponse.json(
    {
      error: "저장된 채팅 첨부 보기는 개인정보 보호 설정을 보강한 뒤 다시 제공됩니다.",
      urls: [],
    },
    { status: 410, headers: { "Cache-Control": "no-store" } }
  );
}
