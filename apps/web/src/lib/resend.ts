import { Resend } from "resend";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { normalizePreregistrationConfirmationLink } from "@/lib/preregistration/preregistrationIntent";

function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeEmailSubjectText(value: string): string {
  return value
    .replace(/[\r\n\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export async function sendPreregistrationConfirmationEmail(
  email: string,
  confirmationLink: string,
): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false;
  const safeLink = normalizePreregistrationConfirmationLink(confirmationLink);
  if (!safeLink) return false;

  try {
    const delivery = await getResend().emails.send({
      from: "웨딩한방 <noreply@hanbang.ai>",
      to: email,
      subject: "웨딩한방 베타 신청 이메일을 확인해주세요",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FDFCFA;">
          <h1 style="font-size: 24px; font-weight: 400; color: #1A1A1F; text-align: center; margin-bottom: 16px;">
            베타 신청 이메일 확인
          </h1>
          <p style="font-size: 15px; color: #4A4A52; line-height: 1.7; text-align: center; margin-bottom: 28px;">
            아래 버튼을 누른 뒤 확인 화면에서 직접 신청을 완료해주세요.<br>
            이 링크를 여는 것만으로는 신청이 확정되지 않습니다.
          </p>
          <div style="text-align: center; margin-bottom: 28px;">
            <a href="${escapeEmailHtml(safeLink)}" style="display: inline-block; padding: 14px 36px; background: #1A1A1F; color: white; border-radius: 24px; text-decoration: none; font-size: 14px; font-weight: 500;">
              신청 확인 화면 열기
            </a>
          </div>
          <p style="font-size: 12px; color: #928980; line-height: 1.7; text-align: center;">
            확인 링크는 30분 동안 유효합니다. 요청하지 않았다면 확인 화면에서 취소하거나 이 메일을 무시해주세요.
          </p>
          <p style="font-size: 11px; color: #B5ADA3; line-height: 1.7; text-align: center; margin-top: 24px;">
            확인 전 임시 신청 정보는 암호화되어 보관되며 만료 후 파기 대상이 됩니다.
          </p>
        </div>
      `,
    });

    return !delivery.error
      && typeof delivery.data?.id === "string"
      && delivery.data.id.trim().length > 0;
  } catch (error) {
    console.error("Preregistration confirmation email failed", safeErrorDiagnostic(error));
    return false;
  }
}

export async function sendVendorApprovalEmail(email: string, vendorName: string) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const safeVendorName = escapeEmailHtml(vendorName);
    const subjectVendorName = safeEmailSubjectText(vendorName);
    await getResend().emails.send({
      from: "Hanbang <noreply@hanbang.ai>",
      to: email,
      subject: `[웨딩한방] ${subjectVendorName} 업체 등록이 승인되었습니다!`,
      html: `
        <div style="font-family: 'Paperlogy', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FDFCFA;">
          <div style="text-align: center; margin-bottom: 32px;">
            <img src="https://hanbang.ai/images/logo-512-transparent.png" alt="웨딩한방" width="64" height="64" style="width: 64px; height: 64px; object-fit: contain;" />
          </div>
          <h1 style="font-size: 24px; font-weight: 300; color: #1A1A1F; text-align: center; margin-bottom: 16px;">
            업체 등록이 승인되었습니다!
          </h1>
          <p style="font-size: 15px; color: #4A4A52; line-height: 1.7; text-align: center; margin-bottom: 32px;">
            <strong>${safeVendorName}</strong>의 파트너 등록이 승인 완료되었습니다.<br>
            이제 웨딩한방 업체 탐색에 노출됩니다.<br>
            문의사항은 partner@hanbang.ai로 연락해주세요.
          </p>
          <p style="font-size: 12px; color: #B5ADA3; text-align: center;">
            © 2026 웨딩한방. All rights reserved.
          </p>
        </div>
      `,
    });
  } catch (error) {
    console.error("업체 승인 이메일 발송 실패:", safeErrorDiagnostic(error));
  }
}

export async function sendVendorRejectionEmail(email: string, vendorName: string, reason?: string) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const safeVendorName = escapeEmailHtml(vendorName);
    const subjectVendorName = safeEmailSubjectText(vendorName);
    const reasonBlock = reason
      ? `<div style="padding: 20px; background: #FFF5F5; border-radius: 12px; margin-bottom: 24px; border-left: 3px solid #E53E3E;">
            <p style="font-size: 13px; color: #928980; margin: 0 0 8px;">반려 사유</p>
            <p style="font-size: 14px; color: #1A1A1F; margin: 0; line-height: 1.6;">${escapeEmailHtml(reason).replace(/\r?\n/g, "<br>")}</p>
          </div>`
      : "";

    await getResend().emails.send({
      from: "Hanbang <noreply@hanbang.ai>",
      to: email,
      subject: `[웨딩한방] ${subjectVendorName} 업체 등록 심사 결과 안내`,
      html: `
        <div style="font-family: 'Paperlogy', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FDFCFA;">
          <div style="text-align: center; margin-bottom: 32px;">
            <img src="https://hanbang.ai/images/logo-512-transparent.png" alt="웨딩한방" width="64" height="64" style="width: 64px; height: 64px; object-fit: contain;" />
          </div>
          <h1 style="font-size: 24px; font-weight: 300; color: #1A1A1F; text-align: center; margin-bottom: 16px;">
            업체 등록 심사 결과 안내
          </h1>
          <p style="font-size: 15px; color: #4A4A52; line-height: 1.7; text-align: center; margin-bottom: 24px;">
            <strong>${safeVendorName}</strong>의 파트너 등록 심사 결과,<br>
            아쉽게도 현재 기준으로 승인이 어렵습니다.
          </p>
          ${reasonBlock}
          <p style="font-size: 14px; color: #4A4A52; line-height: 1.7; text-align: center; margin-bottom: 32px;">
            문의사항은 partner@hanbang.ai로 연락해주세요.
          </p>
          <p style="font-size: 12px; color: #B5ADA3; text-align: center;">
            © 2026 웨딩한방. All rights reserved.
          </p>
        </div>
      `,
    });
  } catch (error) {
    console.error("업체 반려 이메일 발송 실패:", safeErrorDiagnostic(error));
  }
}
