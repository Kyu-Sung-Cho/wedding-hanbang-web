import { Resend } from "resend";

import { buildResearchEmailVerificationUrl } from "@/lib/researchEmailVerification";
import { isResearchCohortApplicationsEnabled } from "@/lib/researchCohortAvailability";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

export function buildResearchCohortReceiptEmail(email: string, verificationUrl: string) {
  const safeEmail = escapeHtml(email);
  const safeVerificationUrl = escapeHtml(verificationUrl);
  return {
    from: "Hanbang <noreply@hanbang.ai>",
    to: email,
    subject: "[웨딩한방] 사용자 연구 신청 이메일을 확인해주세요",
    html: `
      <div style="font-family: 'Paperlogy', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FDFCFA;">
        <div style="text-align: center; margin-bottom: 32px;">
          <img src="https://hanbang.ai/images/logo-512-transparent.png" alt="웨딩한방" width="64" height="64" style="width: 64px; height: 64px; object-fit: contain;" />
        </div>
        <h1 style="font-size: 24px; font-weight: 300; color: #1A1A1F; text-align: center; margin-bottom: 16px;">
          신청 이메일을 확인해주세요
        </h1>
        <p style="font-size: 15px; color: #4A4A52; line-height: 1.7; text-align: center; margin-bottom: 24px;">
          6주 사용자 연구에 관심을 가져주셔서 감사합니다.<br>
          아래 버튼으로 안전한 확인 페이지를 연 뒤,<br>
          페이지에서 확인 버튼을 한 번 더 직접 눌러주세요.
        </p>
        <div style="text-align: center; padding: 24px; background: #FAF7F2; border-radius: 16px; margin-bottom: 24px;">
          <p style="font-size: 13px; color: #928980; margin: 0;">신청 이메일</p>
          <p style="font-size: 16px; color: #1A1A1F; font-weight: 500; margin: 8px 0 0;">${safeEmail}</p>
        </div>
        <div style="text-align: center; margin: 0 0 24px;">
          <a href="${safeVerificationUrl}" style="display: inline-block; padding: 14px 24px; border-radius: 14px; background: #36534E; color: #FFFFFF; font-size: 15px; font-weight: 600; text-decoration: none;">
            이메일 주소 확인하기
          </a>
          <p style="font-size: 12px; color: #928980; line-height: 1.7; margin: 12px 0 0;">
            보안을 위해 이 확인 링크는 발송 후 2시간 동안만 유효합니다.
          </p>
        </div>
        <p style="font-size: 13px; color: #795252; line-height: 1.7; text-align: center; margin-bottom: 20px;">
          이 메일은 선정 또는 정식 베타 초대를 의미하지 않습니다.<br>
          이메일 확인은 신청 주소의 소유 확인만을 위한 절차입니다.<br>
          신청 내용을 검토한 뒤 선정 여부와 다음 단계는 별도 이메일로 안내드립니다.
        </p>
        <p style="font-size: 12px; color: #6F6B66; line-height: 1.7; text-align: center; margin-bottom: 20px;">
          본인이 신청하지 않았다면 확인 버튼을 누르지 말고 이 메일을 무시해주세요.<br>
          현재 공개 사용자 연구 접수는 닫혀 있습니다. 이 메일은 공개 전 내부 검증에서만 발송되어야 합니다.<br>
          이 메일을 실제로 받았다면 추가 개인정보를 입력하거나 회신하지 마세요.
        </p>
        <p style="font-size: 12px; color: #928980; line-height: 1.7; text-align: center;">
          신청 정보 보관 상한: 접수일로부터 180일
        </p>
        <p style="font-size: 12px; color: #B5ADA3; text-align: center;">
          © 2026 웨딩한방. All rights reserved.
        </p>
      </div>
    `,
    text: [
      "웨딩한방 6주 사용자 연구 신청 이메일 확인",
      "",
      `신청 이메일: ${email}`,
      "아래 링크로 확인 페이지를 연 뒤 페이지의 확인 버튼을 한 번 더 직접 눌러주세요.",
      "링크는 발송 후 2시간 동안 유효합니다.",
      verificationUrl,
      "",
      "이 메일은 선정 또는 정식 베타 초대를 의미하지 않습니다.",
      "이메일 확인은 신청 주소의 소유 확인만을 위한 절차입니다.",
      "선정 여부와 다음 단계는 신청 검토 후 별도 이메일로 안내드립니다.",
      "",
      "본인이 신청하지 않았다면 링크를 열지 말고 이 메일을 무시해주세요.",
      "현재 공개 사용자 연구 접수는 닫혀 있습니다. 이 메일은 공개 전 내부 검증에서만 발송되어야 합니다.",
      "이 메일을 실제로 받았다면 추가 개인정보를 입력하거나 회신하지 마세요.",
      "신청 정보 보관 상한: 접수일로부터 180일",
    ].join("\n"),
  };
}

export async function sendResearchCohortReceiptEmail(
  email: string,
  applicationId: string,
  cohortCode: string
): Promise<boolean> {
  if (!isResearchCohortApplicationsEnabled() || !process.env.RESEND_API_KEY) return false;
  try {
    const verificationUrl = buildResearchEmailVerificationUrl({ applicationId, cohortCode });
    if (!verificationUrl) return false;
    const { error } = await getResend().emails.send(
      buildResearchCohortReceiptEmail(email, verificationUrl)
    );
    if (error) return false;
    return true;
  } catch {
    return false;
  }
}
