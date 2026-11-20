import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, privateJson, readJsonBody } from "@/lib/invitation/http";
import { approveLetter } from "@/lib/invitation/inquiryRpc";
import { loadLetterView } from "@/lib/invitation/letterService";
import { openCoupleRequest } from "@/lib/invitation/routeContext";
import { inquiryDailyCap, inquiryGlobalDailyCap, isInquirySendingEnabled } from "@/lib/invitation/switches";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { log } from "@/utils/log";

/**
 * 편지 승인(WS1, WS2, WS5). 화면이 본 판 ID 와 지문을 그대로 받는다. 그 사이 판이 바뀌었으면 409 다.
 * 승인 방식이 끝나면 운영자 대기열에 넣는다. 다만 문의 스위치가 꺼져 있거나 커플·서비스 전체 하루 상한을
 * 넘으면 승인만 남기고 넣지 않으며, 응답의 `notQueuedReason` 이 그 이유를 말한다. 두 번 눌러도 한 번만 들어간다.
 * 승인은 지금 방식에서 승인할 수 있는 사람의 것만 남고, 문의가 켜진 뒤에는 켜진 동안의 승인만 센다.
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024;

export async function POST(request: Request) {
  try {
    const opened = await openCoupleRequest(request, { mutation: { key: "letter-approve", perMinute: 20 } });
    if (!opened.ok) return opened.response;
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const value = body.value;
    if (
      !isRecord(value)
      || Object.keys(value).some((key) => key !== "versionId" && key !== "fingerprint")
      || !isUuid(value.versionId)
      || typeof value.fingerprint !== "string"
      || !/^[0-9a-f]{64}$/.test(value.fingerprint)
    ) {
      return apiError(400, "APPROVAL_INVALID", "확인한 편지를 다시 불러와 주세요.");
    }

    const { supabase, context } = opened;
    const result = await approveLetter(createAdminClient(), {
      coupleId: context.coupleId,
      actorUserId: context.userId,
      versionId: value.versionId.toLowerCase(),
      fingerprint: value.fingerprint,
      sendingEnabled: isInquirySendingEnabled(),
      dailyCap: inquiryDailyCap().value,
      globalDailyCap: inquiryGlobalDailyCap().value,
    });
    if (!result.ok) return apiError(result.status, result.code, result.error);

    const view = await loadLetterView(supabase, context);
    return privateJson({ result: result.value, letter: view?.response ?? null });
  } catch (error) {
    log.error("[invitation letter approve POST]", error);
    return apiError(500, "SERVER_ERROR", "승인을 저장하지 못했어요.");
  }
}
