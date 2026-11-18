import { handleApproverResponse } from "@/lib/invitation/approverRespondRoute";

/** 상대가 낸 승인 방식 제안을 받아들이지 않는다. 본문 `{ proposalId }`. 지금 방식이 그대로 쓰인다. */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleApproverResponse(request, false);
}
