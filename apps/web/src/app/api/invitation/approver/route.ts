import { SELF_SEND_COPY } from "@hanbang/shared/invitation";
import { createAdminClient } from "@/lib/supabase/admin";
import { approverResponse } from "@/lib/invitation/approverView";
import { apiError, privateJson, readJsonBody } from "@/lib/invitation/http";
import { readApproverState } from "@/lib/invitation/inquiryRepository";
import { setApprover } from "@/lib/invitation/inquiryRpc";
import { openCoupleRequest } from "@/lib/invitation/routeContext";
import { isInquirySelfSendEnabled } from "@/lib/invitation/switches";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { log } from "@/utils/log";

/**
 * 상담 문의 승인 방식(D-76, 2026-11-16 파운더 "커플이 정하게").
 *   unset      아직 고르지 않음. 두 사람 중 누구든 승인하면 되고 두 사람 모두 알림을 받는다.
 *   designated 정한 한 사람의 승인만 보내기를 끝낸다.
 *   both       두 사람이 같은 판을 모두 승인해야 한다.
 * 상대의 승인 권한을 줄이는 변경(both → 다른 것, 상대를 정한 방식 → 다른 것, unset → 나만 승인)은 상대가
 * 확인할 때까지 `pending` 에만 남고 `setting` 은 그대로다. 상대에게 더 권한을 주거나 내 권한만 줄이는 변경,
 * 혼자인 커플의 변경은 바로 쓰인다. 바뀌면 판 번호가 오르고 앞 방식에서 받은 승인은 다시 받아야 한다.
 * 확인·거절은 `/api/invitation/approver/confirm`, `/decline` 이다.
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024;

export async function GET(request: Request) {
  try {
    const opened = await openCoupleRequest(request, { journey: false });
    if (!opened.ok) return opened.response;
    const state = await readApproverState(opened.supabase, opened.context.coupleId);
    if (!state.ok) return apiError(503, "APPROVER_UNAVAILABLE", "승인 방식을 불러오지 못했어요.");
    return privateJson(approverResponse(opened.context, state.value.setting, state.value.proposal));
  } catch (error) {
    log.error("[invitation approver GET]", error);
    return apiError(500, "SERVER_ERROR", "승인 방식을 불러오지 못했어요.");
  }
}

export async function PUT(request: Request) {
  // 커플이 직접 보내기(D-83 1단계)에서는 승인을 쓰지 않으므로 승인 방식도 바꾸지 않는다. 새 화면은 고르는 칸을 숨기고,
  // 옛 앱이 바꾸려 해도 상대에게 확인 요청이 가지 않게 로그인·DB 보다 먼저 멈춘다. 확인·거절은 이미 온 요청이라 둔다.
  if (isInquirySelfSendEnabled()) return apiError(409, "SELF_SEND_MODE", SELF_SEND_COPY.approveRefused);
  try {
    const opened = await openCoupleRequest(request, { mutation: { key: "approver", perMinute: 10 }, journey: false });
    if (!opened.ok) return opened.response;
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const value = body.value;
    if (
      !isRecord(value)
      || Object.keys(value).some((key) => key !== "mode" && key !== "designatedUserId")
      || (value.mode !== "unset" && value.mode !== "designated" && value.mode !== "both")
      || (value.mode === "designated" ? !isUuid(value.designatedUserId) : value.designatedUserId !== undefined && value.designatedUserId !== null)
    ) {
      return apiError(400, "APPROVER_INVALID", "승인 방식을 다시 골라 주세요.");
    }
    const designatedUserId = value.mode === "designated" ? (value.designatedUserId as string).toLowerCase() : null;
    if (designatedUserId && !opened.context.members.some((member) => member.id === designatedUserId)) {
      return apiError(400, "APPROVER_NOT_MEMBER", "승인할 사람을 다시 골라 주세요.");
    }

    const result = await setApprover(createAdminClient(), {
      coupleId: opened.context.coupleId,
      actorUserId: opened.context.userId,
      mode: value.mode,
      designatedUserId,
    });
    if (!result.ok) return apiError(result.status, result.code, result.error);
    return privateJson(approverResponse(opened.context, result.value.setting, result.value.proposal, result.value.outcome));
  } catch (error) {
    log.error("[invitation approver PUT]", error);
    return apiError(500, "SERVER_ERROR", "승인 방식을 저장하지 못했어요.");
  }
}
