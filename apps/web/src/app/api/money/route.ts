import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import {
  cleanOptionalEnum,
  cleanOptionalIsoDate,
  cleanOptionalText,
  isBodyTooLarge,
  isRecord,
  isUuid,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const MAX_BODY_BYTES = 8 * 1024;
const MONEY_SIDES = ["groom", "bride", "both"] as const;
const MONEY_METHODS = ["cash", "transfer", "etc"] as const;

export async function GET(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const coupleId = searchParams.get("coupleId");
    if (!coupleId) return NextResponse.json({ error: "coupleId 필요" }, { status: 400 });
    if (!isUuid(coupleId)) return NextResponse.json({ error: "coupleId 형식이 올바르지 않습니다." }, { status: 400 });

    // 본인 couple만 조회 가능
    const { data: profile } = await supabase
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    if (!profile || profile.couple_id !== coupleId) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("congratulatory_money")
      .select("*")
      .eq("couple_id", coupleId)
      .order("received_at", { ascending: false });

    if (error) {
      console.error("[money GET] supabase:", error);
      return NextResponse.json({ error: "축의금 정보를 불러올 수 없습니다." }, { status: 500 });
    }
    return NextResponse.json({ moneyList: data ?? [] });
  } catch (err) {
    console.error("[money GET]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
    }
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 본문이 너무 큽니다." }, { status: 413 });
    }

    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

    const limited = checkRateLimit(rateLimitKey("money:create", request, user.id), {
      maxRequests: 60,
      windowMs: 60 * 1000,
    });
    if (limited) return limited;

    const body = await request.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    if (!profile?.couple_id) {
      return NextResponse.json({ error: "커플 정보 없음" }, { status: 400 });
    }

    // 입력 검증 — amount는 INTEGER 컬럼에 CHECK 제약이 없어 음수·비정수·오버플로가
    // 합계를 왜곡하거나 500을 유발할 수 있다. 경계에서 막는다.
    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000) {
      return NextResponse.json({ error: "금액을 0~1억원 사이 숫자로 입력해주세요." }, { status: 400 });
    }
    const guestName = typeof body.guest_name === "string" ? body.guest_name.trim().slice(0, 60) : "";
    if (!guestName) {
      return NextResponse.json({ error: "이름을 입력해주세요." }, { status: 400 });
    }
    const side = cleanOptionalEnum(body.side, MONEY_SIDES);
    if (!side) {
      return NextResponse.json({ error: "구분을 선택해주세요." }, { status: 400 });
    }
    const method = cleanOptionalEnum(body.method ?? "cash", MONEY_METHODS);
    if (!method) {
      return NextResponse.json({ error: "수령 방식을 선택해주세요." }, { status: 400 });
    }
    const cleanReceivedAt = cleanOptionalIsoDate(body.received_at);
    if (cleanReceivedAt === undefined) {
      return NextResponse.json({ error: "날짜 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const receivedAt = cleanReceivedAt ?? new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("congratulatory_money")
      .insert({
        couple_id: profile.couple_id,
        guest_name: guestName,
        amount,
        side,
        relation: cleanOptionalText(body.relation, 60),
        method,
        memo: cleanOptionalText(body.memo, 500),
        received_at: receivedAt,
      })
      .select()
      .single();

    if (error) {
      // 이 한 줄만 DB 오류 원문을 사용자에게 돌려주고 서버 로그도 안 남겼다. 같은 파일의
      // GET(:46-48)과 `money/[id]` 의 PATCH·DELETE 는 이미 올바른 모양이다 — 원문은 서버에,
      // 화면에는 한국어 고정 문구. 운영자는 못 보고 사용자만 Postgres 문장을 받던 역전이었다.
      console.error("[money POST] supabase:", error);
      return NextResponse.json({ error: "축의금을 저장하지 못했습니다." }, { status: 500 });
    }
    return NextResponse.json({ money: data }, { status: 201 });
  } catch (err) {
    console.error("[money POST]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
