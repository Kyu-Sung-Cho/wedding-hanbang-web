import { NextResponse } from "next/server";
import { setDemoCookies } from "@/lib/demoSession";
import { isPreviewStubMode } from "@/lib/previewStub";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { AMORA_EVAL_HEADER, verifyAmoraEvalToken } from "@/lib/ai/amoraEvalAuth";

const MAX_BODY_BYTES = 1_024;

const CLIENT_REQUEST_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 릴리스 평가기가 자기를 밝히는 헤더. 토큰이 이 값에 묶인다. */
const AMORA_EVAL_REQUEST_ID_HEADER = "x-amora-eval-request-id";

/**
 * 릴리스 평가기인가.
 *
 * ## 왜 필요한가
 *
 * `isTrustedMutationRequest` 는 **브라우저의 교차 사이트 요청**을 막는 장치다. 그래서
 * 헤더를 안 붙이는 서버 측 도구는 통과하지 못한다. 그 결과 운영 대화 평가가
 * **2026-08-03 이후 한 번도 못 돌았다** — 데모 세션을 만드는 첫 걸음에서 403 이 났고,
 * 아무도 몰랐다.
 *
 *     Error: Demo session failed: 403 {"error":"untrusted_mutation_origin"}
 *
 * `/api/chat` 은 이미 이 도구를 안다. 데모 요청이면 출처 검사를 건너뛰고, 평가 쿼터는
 * `X-Amora-Eval` 토큰으로 연다. 세션을 **만드는** 이 경로만 그 통로가 없었다.
 *
 * 스크립트가 Origin 헤더를 지어내게 하는 방법도 있지만 그러지 않았다. 그건 도구가
 * 브라우저인 척하는 것이고, 가드가 조금만 더 엄해지면 조용히 다시 깨진다. 저장소에는
 * "나는 릴리스 평가기다"라고 말하는 정식 수단이 이미 있다.
 *
 * ## 무엇이 넓어지는가
 *
 * 데모 세션 생성이 **64자 릴리스 비밀값을 가진 쪽**에도 열린다. 토큰은 HMAC-SHA256 이고
 * 요청 ID 하나에 묶이며 5분 뒤 만료된다(`amoraEvalAuth`). 같은 토큰으로 `/api/chat` 은
 * 이미 **더 많은 것**(평가 쿼터)을 연다. 새 신뢰 경로가 아니라 있던 경로를 한 걸음
 * 앞으로 옮긴 것이다.
 */
function isReleaseEvaluationRequest(request: Request): boolean {
  const token = request.headers.get(AMORA_EVAL_HEADER);
  if (!token) return false;
  const requestId = request.headers.get(AMORA_EVAL_REQUEST_ID_HEADER);
  if (!requestId || !CLIENT_REQUEST_ID_RE.test(requestId)) return false;
  return verifyAmoraEvalToken(token, requestId);
}

export async function POST(request: Request) {
  const evaluation = isReleaseEvaluationRequest(request);
  // 토큰을 들고 왔는데 검증에 실패하면 조용히 브라우저 검사로 흘려보내지 않는다.
  // `/api/chat` 이 같은 자리에서 401 을 내므로 모양을 맞춘다.
  if (!evaluation && request.headers.get(AMORA_EVAL_HEADER)) {
    return NextResponse.json(
      { error: "운영 평가 인증을 확인하지 못했습니다." },
      { status: 401, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }
  if (!evaluation && !isTrustedMutationRequest(request)) {
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
