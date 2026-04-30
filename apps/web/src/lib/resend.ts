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
            <img src="https://hanbang.ai/images/logo-512-transparent.png" alt="웨딩한방" width="64" height="64" style="width: 64px; height: 64px; object-fit: contain;" />
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

export async function sendVendorApprovalEmail(email: string, vendorName: string) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    await getResend().emails.send({
      from: "Hanbang <noreply@hanbang.ai>",
      to: email,
      subject: `[웨딩한방] ${vendorName} 업체 등록이 승인되었습니다!`,
      html: `
        <div style="font-family: 'Noto Sans KR', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FDFCFA;">
          <div style="text-align: center; margin-bottom: 32px;">
            <img src="https://hanbang.ai/images/logo-512-transparent.png" alt="웨딩한방" width="64" height="64" style="width: 64px; height: 64px; object-fit: contain;" />
          </div>
          <h1 style="font-size: 24px; font-weight: 300; color: #1A1A1F; text-align: center; margin-bottom: 16px;">
            업체 등록이 승인되었습니다!
          </h1>
          <p style="font-size: 15px; color: #4A4A52; line-height: 1.7; text-align: center; margin-bottom: 32px;">
            <strong>${vendorName}</strong>의 파트너 등록이 승인 완료되었습니다.<br>
            이제 업체 포털에서 상품과 타임슬롯을 설정하고<br>
            고객에게 노출을 시작할 수 있습니다.
          </p>
          <div style="text-align: center; margin-bottom: 32px;">
            <a href="https://hanbang.ai/vendor/login" style="display: inline-block; padding: 14px 32px; background: #1A1A1F; color: white; border-radius: 24px; text-decoration: none; font-size: 14px; font-weight: 500;">
              업체 포털로 이동
            </a>
          </div>
          <div style="text-align: center; padding: 24px; background: #FAF7F2; border-radius: 16px; margin-bottom: 32px;">
            <p style="font-size: 13px; color: #928980; margin: 0 0 8px;">다음 단계</p>
            <p style="font-size: 14px; color: #1A1A1F; margin: 0; line-height: 1.8;">
              1. 상품/패키지 등록<br>
              2. 예약 가능 시간 설정<br>
              3. 고객 노출 시작!
            </p>
          </div>
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

// 예약 확인 메일 (고객용)
export async function sendBookingConfirmedEmail(params: {
  to: string;
  customerName: string;
  vendorName: string;
  productName: string;
  bookingDate: string;  // YYYY-MM-DD
  bookingTime: string;  // HH:MM
  amount?: number;
}) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    await getResend().emails.send({
      from: "Hanbang <noreply@hanbang.ai>",
      to: params.to,
      subject: `[웨딩한방] ${params.vendorName} 예약이 확정되었어요`,
      html: `
        <div style="font-family: 'Noto Sans KR', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FCF9F8;">
          <div style="text-align: center; margin-bottom: 32px;">
            <img src="https://hanbang.ai/images/logo-512-transparent.png" alt="웨딩한방" width="64" height="64" style="width: 64px; height: 64px; object-fit: contain;" />
          </div>
          <h1 style="font-size: 22px; font-weight: 300; color: #1C1917; text-align: center; margin-bottom: 8px;">
            예약이 확정됐어요
          </h1>
          <p style="font-size: 14px; color: #504444; text-align: center; margin-bottom: 32px;">
            ${params.customerName}님, 좋은 하루 보내세요.
          </p>
          <div style="padding: 24px; background: white; border-radius: 16px; margin-bottom: 24px;">
            <p style="font-size: 13px; color: #928980; margin: 0 0 4px;">예약 업체</p>
            <p style="font-size: 17px; color: #1C1917; font-weight: 500; margin: 0 0 16px;">${params.vendorName}</p>
            <p style="font-size: 13px; color: #928980; margin: 0 0 4px;">상품</p>
            <p style="font-size: 15px; color: #1C1917; margin: 0 0 16px;">${params.productName}</p>
            <p style="font-size: 13px; color: #928980; margin: 0 0 4px;">방문 일시</p>
            <p style="font-size: 15px; color: #1C1917; margin: 0 0 16px;">${params.bookingDate} ${params.bookingTime}</p>
            ${params.amount ? `<p style="font-size: 13px; color: #928980; margin: 0 0 4px;">결제 금액</p>
            <p style="font-size: 15px; color: #1C1917; margin: 0;">${params.amount.toLocaleString()}원</p>` : ""}
          </div>
          <div style="text-align: center; margin-bottom: 32px;">
            <a href="https://hanbang.ai/bookings" style="display: inline-block; padding: 14px 32px; background: #795252; color: white; border-radius: 24px; text-decoration: none; font-size: 14px; font-weight: 500;">
              예약 상세 보기
            </a>
          </div>
          <p style="font-size: 12px; color: #B5ADA3; text-align: center; line-height: 1.6;">
            예약 변경·취소는 마이페이지에서 가능합니다.<br>
            문의 <a href="mailto:support@hanbang.ai" style="color: #795252;">support@hanbang.ai</a>
          </p>
          <p style="font-size: 11px; color: #B5ADA3; text-align: center; margin-top: 24px;">
            © 2026 웨딩한방. 통신판매중개자
          </p>
        </div>
      `,
    });
  } catch (error) {
    console.error("예약 확인 이메일 발송 실패:", error);
  }
}

// 계약서 발송 메일 (업체 → 고객)
export async function sendContractSentEmail(params: {
  to: string;
  customerName: string;
  vendorName: string;
  contractTitle: string;
  signUrl: string;
}) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    await getResend().emails.send({
      from: "Hanbang <noreply@hanbang.ai>",
      to: params.to,
      subject: `[웨딩한방] ${params.vendorName} 계약서 검토 요청`,
      html: `
        <div style="font-family: 'Noto Sans KR', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FCF9F8;">
          <div style="text-align: center; margin-bottom: 32px;">
            <img src="https://hanbang.ai/images/logo-512-transparent.png" alt="웨딩한방" width="64" height="64" style="width: 64px; height: 64px; object-fit: contain;" />
          </div>
          <h1 style="font-size: 22px; font-weight: 300; color: #1C1917; text-align: center; margin-bottom: 8px;">
            계약서를 보내드렸어요
          </h1>
          <p style="font-size: 14px; color: #504444; text-align: center; margin-bottom: 32px;">
            ${params.customerName}님, 계약 진행을 위해 검토를 부탁드려요.
          </p>
          <div style="padding: 24px; background: white; border-radius: 16px; margin-bottom: 24px;">
            <p style="font-size: 13px; color: #928980; margin: 0 0 4px;">발신 업체</p>
            <p style="font-size: 17px; color: #1C1917; font-weight: 500; margin: 0 0 16px;">${params.vendorName}</p>
            <p style="font-size: 13px; color: #928980; margin: 0 0 4px;">계약서 제목</p>
            <p style="font-size: 15px; color: #1C1917; margin: 0;">${params.contractTitle}</p>
          </div>
          <div style="padding: 16px; background: #f5f0ee; border-radius: 12px; margin-bottom: 24px;">
            <p style="font-size: 13px; color: #504444; margin: 0; line-height: 1.6;">
              계약서를 충분히 확인하신 후 전자서명을 진행해주세요.
              궁금한 점은 업체에 직접 문의하거나 아모라에게 검토를 요청하실 수 있어요.
            </p>
          </div>
          <div style="text-align: center; margin-bottom: 32px;">
            <a href="${params.signUrl}" style="display: inline-block; padding: 14px 32px; background: #795252; color: white; border-radius: 24px; text-decoration: none; font-size: 14px; font-weight: 500;">
              계약서 검토하기
            </a>
          </div>
          <p style="font-size: 12px; color: #B5ADA3; text-align: center; line-height: 1.6;">
            본 메일은 발신 전용입니다.<br>
            문의 <a href="mailto:support@hanbang.ai" style="color: #795252;">support@hanbang.ai</a>
          </p>
          <p style="font-size: 11px; color: #B5ADA3; text-align: center; margin-top: 24px;">
            © 2026 웨딩한방. 통신판매중개자
          </p>
        </div>
      `,
    });
  } catch (error) {
    console.error("계약서 이메일 발송 실패:", error);
  }
}

// 결제 완료 메일
export async function sendPaymentCompletedEmail(params: {
  to: string;
  customerName: string;
  vendorName: string;
  amount: number;
  paymentMethod: string;
  receiptUrl?: string;
}) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const paymentMethodLabel: Record<string, string> = {
      card: "카드",
      vbank: "가상계좌",
      transfer: "계좌이체",
      easypay: "간편결제",
      phone: "휴대폰",
    };
    await getResend().emails.send({
      from: "Hanbang <noreply@hanbang.ai>",
      to: params.to,
      subject: `[웨딩한방] ${params.vendorName} 결제가 완료됐어요`,
      html: `
        <div style="font-family: 'Noto Sans KR', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FCF9F8;">
          <div style="text-align: center; margin-bottom: 32px;">
            <img src="https://hanbang.ai/images/logo-512-transparent.png" alt="웨딩한방" width="64" height="64" style="width: 64px; height: 64px; object-fit: contain;" />
          </div>
          <h1 style="font-size: 22px; font-weight: 300; color: #1C1917; text-align: center; margin-bottom: 8px;">
            결제가 완료됐어요
          </h1>
          <p style="font-size: 14px; color: #504444; text-align: center; margin-bottom: 32px;">
            ${params.customerName}님, 안전하게 처리되었습니다.
          </p>
          <div style="padding: 24px; background: white; border-radius: 16px; margin-bottom: 24px;">
            <p style="font-size: 13px; color: #928980; margin: 0 0 4px;">업체</p>
            <p style="font-size: 17px; color: #1C1917; font-weight: 500; margin: 0 0 16px;">${params.vendorName}</p>
            <p style="font-size: 13px; color: #928980; margin: 0 0 4px;">결제 금액</p>
            <p style="font-size: 22px; color: #1C1917; font-weight: 600; margin: 0 0 4px;">${params.amount.toLocaleString()}원</p>
            <p style="font-size: 13px; color: #928980; margin: 0 0 4px;">결제 수단</p>
            <p style="font-size: 14px; color: #1C1917; margin: 0;">${paymentMethodLabel[params.paymentMethod] ?? params.paymentMethod}</p>
          </div>
          ${params.receiptUrl ? `<div style="text-align: center; margin-bottom: 24px;">
            <a href="${params.receiptUrl}" style="display: inline-block; padding: 12px 24px; background: white; color: #795252; border: 1px solid #795252; border-radius: 24px; text-decoration: none; font-size: 13px;">영수증 보기</a>
          </div>` : ""}
          <div style="text-align: center; margin-bottom: 32px;">
            <a href="https://hanbang.ai/bookings" style="display: inline-block; padding: 14px 32px; background: #795252; color: white; border-radius: 24px; text-decoration: none; font-size: 14px; font-weight: 500;">
              예약 보기
            </a>
          </div>
          <p style="font-size: 12px; color: #B5ADA3; text-align: center; line-height: 1.6;">
            결제 내역은 「전자상거래 등에서의 소비자보호에 관한 법률」에 따라 5년간 보관됩니다.<br>
            문의 <a href="mailto:support@hanbang.ai" style="color: #795252;">support@hanbang.ai</a>
          </p>
          <p style="font-size: 11px; color: #B5ADA3; text-align: center; margin-top: 24px;">
            © 2026 웨딩한방. 통신판매중개자
          </p>
        </div>
      `,
    });
  } catch (error) {
    console.error("결제 완료 이메일 발송 실패:", error);
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
        <div style="font-family: 'Noto Sans KR', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FDFCFA;">
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
            프로필 정보를 수정하신 후 다시 심사를 요청하실 수 있습니다.<br>
            문의사항은 partner@hanbang.ai로 연락해주세요.
          </p>
          <div style="text-align: center; margin-bottom: 32px;">
            <a href="https://hanbang.ai/vendor/login" style="display: inline-block; padding: 14px 32px; background: #1A1A1F; color: white; border-radius: 24px; text-decoration: none; font-size: 14px; font-weight: 500;">
              프로필 수정하기
            </a>
          </div>
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
