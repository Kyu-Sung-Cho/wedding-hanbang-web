import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, privateJson, readJsonBody } from "@/lib/invitation/http";
import { readOpenLetter } from "@/lib/invitation/inquiryRepository";
import { saveLetterVersion } from "@/lib/invitation/inquiryRpc";
import { letterSignature } from "@/lib/invitation/letter";
import { parseLetterInput, resolveShares } from "@/lib/invitation/letterInput";
import { loadLetterView } from "@/lib/invitation/letterService";
import { openCoupleRequest } from "@/lib/invitation/routeContext";
import { isInquirySelfSendEnabled } from "@/lib/invitation/switches";
import { log } from "@/utils/log";

/**
 * 상담 문의 편지(W3, WS1).
 *   GET  열린 편지의 마지막 판, 없으면 조건과 담은 홀로 만든 초안(LetterModel)과 승인 상태.
 *   PUT  받는 곳·글·알려줄 정보를 판으로 저장한다. 하나라도 바뀌면 새 판이 생기고 앞 판의 승인은 이어지지 않는다.
 * 저장만 하고 아무 데도 보내지 않는다. 보내기는 승인 경로(`/letter/approve`)와 운영자 대기열이 맡는다.
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;

export async function GET(request: Request) {
  try {
    const opened = await openCoupleRequest(request);
    if (!opened.ok) return opened.response;
    const view = await loadLetterView(opened.supabase, opened.context);
    if (!view) return apiError(503, "LETTER_UNAVAILABLE", "편지를 불러오지 못했어요.");
    return privateJson(view.response);
  } catch (error) {
    log.error("[invitation letter GET]", error);
    return apiError(500, "SERVER_ERROR", "편지를 불러오지 못했어요.");
  }
}

export async function PUT(request: Request) {
  try {
    const opened = await openCoupleRequest(request, { mutation: { key: "letter", perMinute: 30 } });
    if (!opened.ok) return opened.response;
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const parsed = parseLetterInput(body.value);
    if (!parsed.ok) return apiError(400, "LETTER_INVALID", parsed.error);

    const { supabase, context } = opened;
    const open = await readOpenLetter(supabase, context.coupleId);
    if (!open.ok) return apiError(503, "LETTER_UNAVAILABLE", "편지를 불러오지 못했어요.");
    if (parsed.value.letterId && open.value?.letterId !== parsed.value.letterId) {
      return apiError(409, "LETTER_LOCKED", "이미 보낼 준비를 마친 편지예요. 새 편지로 써 주세요.");
    }
    // 직접 보내기(D-83 1단계)의 글에는 휴대폰 번호가 들어가지 않으므로 번호를 받지 않는다(옛 앱이 켜서 보내도 끈다).
    const shareInput = isInquirySelfSendEnabled()
      ? { ...parsed.value.shares, phone: { on: false, value: null } }
      : parsed.value.shares;
    const shares = resolveShares(shareInput, open.value?.version.shares ?? null, context.journey?.totalBudget ?? null);
    if (!shares.ok) return apiError(400, "LETTER_SHARES_INVALID", shares.error);

    const saved = await saveLetterVersion(createAdminClient(), {
      coupleId: context.coupleId,
      actorUserId: context.userId,
      letterId: parsed.value.letterId,
      recipientHallIds: parsed.value.recipientHallIds,
      body: parsed.value.body,
      signature: letterSignature(shares.shares.name.on, context.members),
      shares: shares.shares,
    });
    if (!saved.ok) return apiError(saved.status, saved.code, saved.error);

    const view = await loadLetterView(supabase, context);
    if (!view) return apiError(503, "LETTER_UNAVAILABLE", "저장했지만 편지를 다시 불러오지 못했어요.");
    return privateJson({ ...view.response, saved: saved.value });
  } catch (error) {
    log.error("[invitation letter PUT]", error);
    return apiError(500, "SERVER_ERROR", "편지를 저장하지 못했어요.");
  }
}
