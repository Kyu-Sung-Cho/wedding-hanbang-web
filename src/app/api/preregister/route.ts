import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Service role 클라이언트 (서버 전용)
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    // 이메일 유효성 검사
    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "유효한 이메일을 입력해주세요." },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    // 중복 이메일 체크
    const { data: existing } = await supabase
      .from("preregistrations")
      .select("id")
      .eq("email", email)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: "이미 등록된 이메일입니다." },
        { status: 409 }
      );
    }

    // UTM 파라미터 추출
    const url = new URL(request.url);
    const utm_source = url.searchParams.get("utm_source");
    const utm_medium = url.searchParams.get("utm_medium");
    const utm_campaign = url.searchParams.get("utm_campaign");

    // Supabase에 저장
    const { error: insertError } = await supabase
      .from("preregistrations")
      .insert({
        email,
        source: "web",
        utm_source,
        utm_medium,
        utm_campaign,
      });

    if (insertError) {
      console.error("사전등록 저장 실패:", insertError);
      return NextResponse.json(
        { error: "등록 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    // 확인 이메일 발송 (비동기, 실패해도 등록은 성공)
    const { sendPreregistrationEmail } = await import("@/lib/resend");
    sendPreregistrationEmail(email);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("사전등록 API 오류:", error);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
