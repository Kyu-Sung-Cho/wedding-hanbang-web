import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const VENDOR_MESSAGES_ENABLED = false as const;
export const VENDOR_MESSAGES_DISABLED_CODE = "vendor_messages_disabled" as const;

function retiredVendorMessagesResponse() {
  return NextResponse.json(
    {
      error: "업체 연결을 현재 제공하지 않습니다. 문의는 업체에 전송되지 않으며 저장되지 않습니다.",
      code: VENDOR_MESSAGES_DISABLED_CODE,
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}

/** Legacy reads and writes stop before authentication, request parsing, or storage. */
export async function GET() {
  return retiredVendorMessagesResponse();
}

export async function POST() {
  return retiredVendorMessagesResponse();
}
