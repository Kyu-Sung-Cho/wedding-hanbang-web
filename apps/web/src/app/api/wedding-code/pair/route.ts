// 웨딩코드 페어링 — 토큰 "생성자" 본인의 응답 행에 couple_token을 연결한다.
// (제출 시점엔 토큰이 없고, 결과 화면에서 '상대와 비교해보기'를 눌러야 생성되므로
//  본인 행은 사후 연결이 필요 — 지시서 §6의 설계 공백 보완, 승인됨.)
// response_id(UUID)는 제출자만 아는 capability 역할. PII 없음.
// 규칙: 이미 토큰이 있는 행은 불변(1회성) / 페어 최대 2행 — 초과 토큰은 409.

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord, isUuid } from "@/utils/requestValidation";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(request: NextRequest) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const limited = await checkRateLimitPersistent(rateLimitKey("wedding-code-pair", request), {
      maxRequests: 20,
      windowMs: 60 * 60 * 1000,
    });
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    if (!isRecord(body) || !isUuid(body.response_id) || !isUuid(body.couple_token)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    const responseId = body.response_id as string;
    const coupleToken = body.couple_token as string;

    const admin = getServiceClient();

    // Row lock + token advisory lock + count + update execute in one DB
    // transaction, so two concurrent requests cannot claim a third slot.
    const { data: pairedResult, error } = await admin.rpc("pair_wedding_code_response", {
      p_response_id: responseId,
      p_couple_token: coupleToken,
    });

    if (error) {
      console.error("[wedding-code/pair] atomic pair 실패:", error.message);
      return NextResponse.json(
        { error: "연결에 실패했습니다.", pairingStatus: "error" },
        { status: 503 }
      );
    }

    const row = Array.isArray(pairedResult) ? pairedResult[0] : pairedResult;
    const pairingStatus = isRecord(row) ? row.pairing_status : null;
    const storedCoupleToken = isRecord(row) ? row.couple_token : null;
    if (pairingStatus === "full") {
      if (storedCoupleToken !== null) {
        console.error("[wedding-code/pair] full 응답에 토큰이 포함됨");
        return NextResponse.json(
          { error: "연결 결과를 확인하지 못했어요.", pairingStatus: "error" },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: "이 링크는 이미 두 분이 사용했어요.", pairingStatus: "full" },
        { status: 409 }
      );
    }
    if (pairingStatus === "not_found") {
      return NextResponse.json(
        { error: "이미 연결됐거나 응답을 찾을 수 없어요.", pairingStatus: "conflict" },
        { status: 409 }
      );
    }
    if (
      (pairingStatus !== "waiting" && pairingStatus !== "paired") ||
      !isUuid(storedCoupleToken)
    ) {
      console.error("[wedding-code/pair] atomic pair 응답 형식 오류");
      return NextResponse.json(
        { error: "연결 결과를 확인하지 못했어요.", pairingStatus: "error" },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: true,
      pairingStatus,
      coupleToken: storedCoupleToken,
    });
  } catch (err) {
    console.error("[wedding-code/pair] 서버 오류:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다.", pairingStatus: "error" },
      { status: 503 }
    );
  }
}
