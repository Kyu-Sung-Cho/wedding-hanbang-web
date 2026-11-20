import { createAdminClient } from "@/lib/supabase/admin";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { log } from "@/utils/log";
import { approverResponse } from "./approverView";
import { apiError, privateJson, readJsonBody } from "./http";
import { respondApprover } from "./inquiryRpc";
import { openCoupleRequest } from "./routeContext";

/**
 * 승인 방식 제안에 답하기(확인·거절). 두 경로가 같은 본문 `{ proposalId }` 를 쓴다.
 * 제안한 사람이 아닌 다른 회원만 답할 수 있고, 화면이 본 제안과 지금 제안이 다르면 409 다. DB 가 다시 판정한다.
 */

const MAX_BODY_BYTES = 512;

export async function handleApproverResponse(request: Request, accept: boolean): Promise<Response> {
  const scope = accept ? "confirm" : "decline";
  try {
    const opened = await openCoupleRequest(request, { mutation: { key: "approver", perMinute: 10 }, journey: false });
    if (!opened.ok) return opened.response;
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const value = body.value;
    if (!isRecord(value) || Object.keys(value).some((key) => key !== "proposalId") || !isUuid(value.proposalId)) {
      return apiError(400, "APPROVER_PROPOSAL_INVALID", "확인할 제안을 다시 불러와 주세요.");
    }
    const result = await respondApprover(createAdminClient(), {
      coupleId: opened.context.coupleId,
      actorUserId: opened.context.userId,
      proposalId: value.proposalId.toLowerCase(),
      accept,
    });
    if (!result.ok) return apiError(result.status, result.code, result.error);
    return privateJson(approverResponse(opened.context, result.value.setting, result.value.proposal, result.value.outcome));
  } catch (error) {
    log.error(`[invitation approver ${scope} POST]`, error);
    return apiError(500, "SERVER_ERROR", "승인 방식 제안에 답하지 못했어요.");
  }
}
