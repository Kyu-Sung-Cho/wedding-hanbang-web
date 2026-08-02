import { NextResponse } from "next/server";
import { setDemoCookies } from "@/lib/demoSession";
import { isPreviewStubMode } from "@/lib/previewStub";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const MAX_BODY_BYTES = 1_024;

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json(
      { error: "신뢰할 수 없는 요청입니다." },
      { status: 403, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }

  const limited = checkRateLimit(rateLimitKey("demo-start", request), {
    maxRequests: 20,
    windowMs: 60 * 60 * 1000,
  });
  if (limited) return limited;

  const rawBody = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
  if (!rawBody.ok) {
    return NextResponse.json(
      { error: rawBody.reason === "too_large" ? "요청 데이터가 너무 큽니다." : "잘못된 요청입니다." },
      { status: rawBody.reason === "too_large" ? 413 : 400 },
    );
  }
  if (rawBody.text.trim().length > 0) {
    let body: unknown;
    try {
      body = JSON.parse(rawBody.text);
    } catch {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
  }

  // 앱 셸은 데모 쿠키를 실제 세션보다 우선한다. 로그인한 사용자가 공개 표면의
  // 체험 버튼을 누르면 자기 데이터 대신 샘플 화면을 보게 되므로, 실제 세션이
  // 있으면 데모를 만들지 않고 본인 화면으로 돌려보낸다.
  if (!isPreviewStubMode()) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return NextResponse.json({ success: true, alreadySignedIn: true });
  }

  const response = NextResponse.json({ success: true });
  if (!setDemoCookies(response)) {
    return NextResponse.json({ error: "데모 세션 설정을 사용할 수 없습니다." }, { status: 500 });
  }
  return response;
}
