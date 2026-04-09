import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

// Admin 클라이언트 (service role key)
function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(request: Request) {
  try {
    const { email, password, name } = await request.json();

    if (!email || !password || !name) {
      return NextResponse.json({ error: "모든 필드를 입력해주세요." }, { status: 400 });
    }

    const supabase = getAdminSupabase();

    // Admin API로 확인 링크 생성 (유저 생성 + 이메일 확인 링크)
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "signup",
      email,
      password,
      options: {
        data: { name },
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "https://hanbang.ai"}/api/auth/callback`,
      },
    });

    if (error) {
      // 이미 가입된 이메일
      if (error.message.includes("already been registered") || error.message.includes("already registered")) {
        return NextResponse.json({ error: "이미 가입된 이메일입니다. 로그인해주세요." }, { status: 409 });
      }
      console.error("generateLink error:", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!data?.properties?.action_link) {
      return NextResponse.json({ error: "확인 링크 생성에 실패했습니다." }, { status: 500 });
    }

    // Resend로 확인 이메일 발송
    const confirmLink = data.properties.action_link;
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: "웨딩한방 <noreply@hanbang.ai>",
      to: email,
      subject: "웨딩한방 이메일 인증을 완료해주세요",
      html: `
        <div style="font-family: 'Noto Sans KR', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FDFCFA;">
          <div style="text-align: center; margin-bottom: 32px;">
            <img src="https://hanbang.ai/images/logo-512-transparent.png" alt="웨딩한방" width="64" height="64" style="width: 64px; height: 64px; object-fit: contain;" />
          </div>
          <h1 style="font-size: 24px; font-weight: 300; color: #1A1A1F; text-align: center; margin-bottom: 16px;">
            이메일 인증
          </h1>
          <p style="font-size: 15px; color: #4A4A52; line-height: 1.7; text-align: center; margin-bottom: 32px;">
            안녕하세요, <strong>${name}</strong>님!<br>
            아래 버튼을 클릭하여 이메일 인증을 완료해주세요.
          </p>
          <div style="text-align: center; margin-bottom: 32px;">
            <a href="${confirmLink}" style="display: inline-block; padding: 14px 40px; background: #1A1A1F; color: white; border-radius: 24px; text-decoration: none; font-size: 14px; font-weight: 500;">
              이메일 인증하기
            </a>
          </div>
          <p style="font-size: 13px; color: #928980; text-align: center; margin-bottom: 24px;">
            버튼이 작동하지 않으면 아래 링크를 복사하여 브라우저에 붙여넣으세요:
          </p>
          <p style="font-size: 12px; color: #B5ADA3; word-break: break-all; text-align: center; margin-bottom: 32px; padding: 16px; background: #FAF7F2; border-radius: 12px;">
            ${confirmLink}
          </p>
          <p style="font-size: 12px; color: #B5ADA3; text-align: center;">
            본 메일은 웨딩한방 회원가입 요청에 의해 발송되었습니다.<br>
            요청하지 않으셨다면 이 메일을 무시하셔도 됩니다.
          </p>
          <p style="font-size: 11px; color: #D5D0C9; text-align: center; margin-top: 24px;">
            © 2026 웨딩한방. All rights reserved.
          </p>
        </div>
      `,
    });

    return NextResponse.json({ success: true, message: "인증 이메일을 발송했습니다." });
  } catch (err) {
    console.error("Signup API error:", err);
    return NextResponse.json({ error: "회원가입 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
