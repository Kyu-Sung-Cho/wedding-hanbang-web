import { Resend } from "resend";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export async function sendPreregistrationEmail(email: string) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    await getResend().emails.send({
      from: "Hanbang <noreply@hanbang.ai>",
      to: email,
      subject: "웨딩한방 사전등록이 완료되었습니다!",
      html: `
        <div style="font-family: 'Noto Sans KR', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FDFCFA;">
          <div style="text-align: center; margin-bottom: 32px;">
            <div style="display: inline-block; width: 48px; height: 48px; background: linear-gradient(135deg, #C4967E, #C9A96E); border-radius: 12px; line-height: 48px; color: white; font-size: 20px; font-weight: bold;">한</div>
          </div>
          <h1 style="font-size: 24px; font-weight: 300; color: #1A1A1F; text-align: center; margin-bottom: 16px;">
            사전등록이 완료되었습니다!
          </h1>
          <p style="font-size: 15px; color: #4A4A52; line-height: 1.7; text-align: center; margin-bottom: 32px;">
            웨딩한방에 관심을 가져주셔서 감사합니다.<br>
            정식 출시 시 우선 초대와 특별 할인 혜택을 보내드리겠습니다.
          </p>
          <div style="text-align: center; padding: 24px; background: #FAF7F2; border-radius: 16px; margin-bottom: 32px;">
            <p style="font-size: 13px; color: #928980; margin: 0;">등록된 이메일</p>
            <p style="font-size: 16px; color: #1A1A1F; font-weight: 500; margin: 8px 0 0;">${email}</p>
          </div>
          <p style="font-size: 12px; color: #B5ADA3; text-align: center;">
            © 2025 웨딩한방. All rights reserved.
          </p>
        </div>
      `,
    });
  } catch (error) {
    console.error("이메일 발송 실패:", error);
  }
}
