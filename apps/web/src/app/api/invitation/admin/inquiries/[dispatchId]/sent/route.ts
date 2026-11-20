import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAdmin } from "@/lib/utils/adminAuth";
import { apiError, privateJson, readJsonBody } from "@/lib/invitation/http";
import { markDispatchSent } from "@/lib/invitation/inquiryRpc";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { log } from "@/utils/log";

/**
 * 운영자가 업체의 공식 문의 창구로 보낸 뒤 "보냈어요"를 표시한다. 한 번만 바뀌고 두 번 눌러도 같은 결과다.
 * 메모에는 어느 창구로 보냈는지만 적는다(연락처나 커플 정보를 적지 않는다).
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024;
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

type Params = { params: Promise<{ dispatchId: string }> };

export async function POST(request: Request, { params }: Params) {
  if (!isTrustedMutationRequest(request)) return apiError(403, "UNTRUSTED_ORIGIN", "잘못된 요청 출처예요.");
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized || !userId) return apiError(401, "ADMIN_REQUIRED", "관리자만 할 수 있어요.");
  try {
    const { dispatchId } = await params;
    if (!isUuid(dispatchId)) return apiError(400, "DISPATCH_ID_INVALID", "대기열 줄을 다시 골라 주세요.");
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const value = body.value;
    if (!isRecord(value) || Object.keys(value).some((key) => key !== "channelNote")) {
      return apiError(400, "SENT_INVALID", "입력을 다시 확인해 주세요.");
    }
    const note = typeof value.channelNote === "string" ? value.channelNote.trim() : null;
    if (value.channelNote !== undefined && value.channelNote !== null && typeof value.channelNote !== "string") {
      return apiError(400, "SENT_INVALID", "메모를 다시 확인해 주세요.");
    }
    if (note && (Array.from(note).length > 200 || UNSAFE.test(note))) return apiError(400, "SENT_INVALID", "메모는 200자 안으로 적어 주세요.");

    const result = await markDispatchSent(createAdminClient(), {
      dispatchId: dispatchId.toLowerCase(),
      operatorUserId: userId,
      channelNote: note && note.length > 0 ? note : null,
    });
    if (!result.ok) return apiError(result.status, result.code, result.error);
    return privateJson(result.value);
  } catch (error) {
    log.error("[invitation admin sent POST]", error);
    return apiError(500, "SERVER_ERROR", "표시하지 못했어요.");
  }
}
