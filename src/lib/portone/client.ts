// 포트원 서버 API 클라이언트
// 환경변수: PORTONE_API_SECRET, NEXT_PUBLIC_PORTONE_STORE_ID

const PORTONE_API_BASE = "https://api.portone.io";

async function portoneRequest(path: string, options: RequestInit = {}) {
  const secret = process.env.PORTONE_API_SECRET;
  if (!secret) {
    throw new Error("PORTONE_API_SECRET 환경변수가 설정되지 않았습니다.");
  }

  const res = await fetch(`${PORTONE_API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `PortOne ${secret}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`PortOne API Error (${res.status}): ${errorBody}`);
  }

  return res.json();
}

// 결제 정보 조회
export async function getPayment(paymentId: string) {
  return portoneRequest(`/payments/${paymentId}`);
}

// 결제 사전등록 (금액 검증용)
export async function preRegisterPayment(paymentId: string, totalAmount: number) {
  return portoneRequest(`/payments/${paymentId}/pre-register`, {
    method: "POST",
    body: JSON.stringify({
      totalAmount,
    }),
  });
}

// 결제 취소 (환불)
export async function cancelPayment(
  paymentId: string,
  reason: string,
  amount?: number
) {
  const body: Record<string, unknown> = { reason };
  if (amount) body.amount = amount;

  return portoneRequest(`/payments/${paymentId}/cancel`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
