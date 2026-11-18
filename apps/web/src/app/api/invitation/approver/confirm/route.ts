import { handleApproverResponse } from "@/lib/invitation/approverRespondRoute";

/** 상대가 낸 승인 방식 제안을 확인한다. 본문 `{ proposalId }`. 확인하면 그 방식이 바로 쓰인다. */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleApproverResponse(request, true);
}
