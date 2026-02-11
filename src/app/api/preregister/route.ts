import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const { email, name, weddingDate, source, utmSource, utmMedium, utmCampaign } =
      await request.json();

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "유효한 이메일을 입력해주세요." },
        { status: 400 }
      );
    }

    const supabase = await createServiceClient();

    // 중복 체크
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

    // 저장
    const { error: insertError } = await supabase
      .from("preregistrations")
      .insert({
        email,
        name: name || null,
        wedding_date: weddingDate || null,
        source: source || "web",
        utm_source: utmSource || null,
        utm_medium: utmMedium || null,
        utm_campaign: utmCampaign || null,
      });

    if (insertError) {
      console.error("사전등록 저장 실패:", insertError);
      return NextResponse.json(
        { error: "등록에 실패했습니다. 잠시 후 다시 시도해주세요." },
        { status: 500 }
      );
    }

    // Resend 이메일 발송 (API 키가 있을 때만)
    if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== "여기에_내_resend_key") {
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: "웨딩한방 <noreply@hanbang.ai>",
          to: email,
          subject: "웨딩한방 사전등록이 완료되었습니다 ✨",
          html: `
            <div style="font-family: 'Noto Sans KR', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
              <h2 style="color: #1A1A1F; font-size: 24px; font-weight: 400;">사전등록 감사합니다!</h2>
              <p style="color: #4A4A52; font-size: 15px; line-height: 1.7;">
                웨딩한방 사전등록이 완료되었습니다.<br/>
                정식 출시 시 우선 초대와 특별 할인 혜택을 드릴게요.
              </p>
              <div style="margin-top: 32px; padding: 20px; background: #FAF7F2; border-radius: 12px;">
                <p style="color: #928980; font-size: 13px; margin: 0;">
                  AI 웨딩 플래너가 곧 여러분을 찾아갑니다 ✦
                </p>
              </div>
              <p style="color: #B5ADA3; font-size: 12px; margin-top: 32px;">
                © 2025 웨딩한방. All rights reserved.
              </p>
            </div>
          `,
        });
      } catch (emailError) {
        console.error("이메일 발송 실패:", emailError);
      }
    }

    return NextResponse.json({ success: true, message: "사전등록이 완료되었습니다!" });
  } catch (error) {
    console.error("사전등록 API 오류:", error);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
