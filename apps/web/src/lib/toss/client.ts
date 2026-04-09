// 토스페이먼츠 서버 API 클라이언트
// 환경변수: TOSS_SECRET_KEY

const TOSS_API_BASE = "https://api.tosspayments.com/v1";

function getAuthHeader(): string {
  const secret = process.env.TOSS_SECRET_KEY;
  if (!secret) {
    throw new Error("TOSS_SECRET_KEY 환경변수가 설정되지 않았습니다.");
  }
  return `Basic ${Buffer.from(`${secret}:`).toString("base64")}`;
}

async function tossRequest(path: string, options: RequestInit = {}) {
  const res = await fetch(`${TOSS_API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: getAuthHeader(),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Toss API Error (${res.status}): ${errorBody}`);
  }

  return res.json();
}

// 결제 승인 (필수: 클라이언트 결제 후 서버에서 최종 승인)
export async function confirmPayment(
  paymentKey: string,
  orderId: string,
  amount: number
) {
  return tossRequest("/payments/confirm", {
    method: "POST",
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });
}

// 결제 정보 조회
export async function getPayment(paymentKey: string) {
  return tossRequest(`/payments/${paymentKey}`);
}

// 결제 취소 (환불)
export async function cancelPayment(
  paymentKey: string,
  cancelReason: string,
  cancelAmount?: number
) {
  const body: Record<string, unknown> = { cancelReason };
  if (cancelAmount) body.cancelAmount = cancelAmount;

  return tossRequest(`/payments/${paymentKey}/cancel`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
