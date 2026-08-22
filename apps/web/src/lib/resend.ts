import { Resend } from "resend";
import { CONTACT } from "@/lib/constants/contact";

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
        <div style="font-family: 'Paperlogy', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FDFCFA;">
          <div style="text-align: center; margin-bottom: 32px;">
            <img src="https://hanbang.ai/images/logo-512-transparent.png" alt="웨딩한방" width="64" height="64" style="width: 64px; height: 64px; object-fit: contain;" />
          </div>
          <h1 style="font-size: 24px; font-weight: 300; color: #1A1A1F; text-align: center; margin-bottom: 16px;">
            사전등록이 완료되었습니다!
          </h1>
          <p style="font-size: 15px; color: #4A4A52; line-height: 1.7; text-align: center; margin-bottom: 32px;">
            웨딩한방에 관심을 가져주셔서 감사합니다.<br>
            새 소식이 생기면 이 주소로 알려드릴게요.
          </p>
          <div style="text-align: center; padding: 24px; background: #FAF7F2; border-radius: 16px; margin-bottom: 32px;">
            <p style="font-size: 13px; color: #928980; margin: 0;">등록된 이메일</p>
            <p style="font-size: 16px; color: #1A1A1F; font-weight: 500; margin: 8px 0 0;">${email}</p>
          </div>
          <p style="font-size: 12px; color: #B5ADA3; text-align: center;">
            © 2026 웨딩한방. All rights reserved.
          </p>
        </div>
      `,
    });
  } catch (error) {
    console.error("이메일 발송 실패:", error);
  }
}

export async function sendVendorApprovalEmail(email: string, vendorName: string) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    await getResend().emails.send({
      from: "Hanbang <noreply@hanbang.ai>",
      to: email,
      subject: `[웨딩한방] ${vendorName} 업체 등록이 승인되었습니다!`,
      html: `
        <div style="font-family: 'Paperlogy', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FDFCFA;">
          <div style="text-align: center; margin-bottom: 32px;">
            <img src="https://hanbang.ai/images/logo-512-transparent.png" alt="웨딩한방" width="64" height="64" style="width: 64px; height: 64px; object-fit: contain;" />
          </div>
          <h1 style="font-size: 24px; font-weight: 300; color: #1A1A1F; text-align: center; margin-bottom: 16px;">
            업체 등록이 승인되었습니다!
          </h1>
          <p style="font-size: 15px; color: #4A4A52; line-height: 1.7; text-align: center; margin-bottom: 32px;">
            <strong>${vendorName}</strong>의 파트너 등록이 승인 완료되었습니다.<br>
            이제 웨딩한방 업체 탐색에 노출됩니다.<br>
            문의사항은 ${CONTACT.email}로 연락해주세요.
          </p>
          <p style="font-size: 12px; color: #B5ADA3; text-align: center;">
            © 2026 웨딩한방. All rights reserved.
          </p>
        </div>
      `,
    });
  } catch (error) {
    console.error("업체 승인 이메일 발송 실패:", error);
  }
}

export async function sendVendorRejectionEmail(email: string, vendorName: string, reason?: string) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const reasonBlock = reason
      ? `<div style="padding: 20px; background: #FFF5F5; border-radius: 12px; margin-bottom: 24px; border-left: 3px solid #E53E3E;">
            <p style="font-size: 13px; color: #928980; margin: 0 0 8px;">반려 사유</p>
            <p style="font-size: 14px; color: #1A1A1F; margin: 0; line-height: 1.6;">${reason}</p>
          </div>`
      : "";

    await getResend().emails.send({
      from: "Hanbang <noreply@hanbang.ai>",
      to: email,
      subject: `[웨딩한방] ${vendorName} 업체 등록 심사 결과 안내`,
      html: `
        <div style="font-family: 'Paperlogy', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FDFCFA;">
          <div style="text-align: center; margin-bottom: 32px;">
            <img src="https://hanbang.ai/images/logo-512-transparent.png" alt="웨딩한방" width="64" height="64" style="width: 64px; height: 64px; object-fit: contain;" />
          </div>
          <h1 style="font-size: 24px; font-weight: 300; color: #1A1A1F; text-align: center; margin-bottom: 16px;">
            업체 등록 심사 결과 안내
          </h1>
          <p style="font-size: 15px; color: #4A4A52; line-height: 1.7; text-align: center; margin-bottom: 24px;">
            <strong>${vendorName}</strong>의 파트너 등록 심사 결과,<br>
            아쉽게도 현재 기준으로 승인이 어렵습니다.
          </p>
          ${reasonBlock}
          <p style="font-size: 14px; color: #4A4A52; line-height: 1.7; text-align: center; margin-bottom: 32px;">
            문의사항은 ${CONTACT.email}로 연락해주세요.
          </p>
          <p style="font-size: 12px; color: #B5ADA3; text-align: center;">
            © 2026 웨딩한방. All rights reserved.
          </p>
        </div>
      `,
    });
  } catch (error) {
    console.error("업체 반려 이메일 발송 실패:", error);
  }
}
