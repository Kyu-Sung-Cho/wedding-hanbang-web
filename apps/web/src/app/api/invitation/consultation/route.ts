import type { InvitationConsultationResponse } from "@hanbang/shared/invitation";
import { buildConsultation, countPastedInCalendar, isInCalendar } from "@/lib/invitation/consultation";
import { readHallsByIds } from "@/lib/invitation/hallRepository";
import { apiError, privateJson } from "@/lib/invitation/http";
import { readInquiryTimeline } from "@/lib/invitation/inquiryRepository";
import { readReplyPasteHalls } from "@/lib/invitation/replyPaste";
import { openCoupleRequest } from "@/lib/invitation/routeContext";
import { isInquirySelfSendEnabled } from "@/lib/invitation/switches";
import { getEvents } from "@/utils/scheduleEvents";
import { log } from "@/utils/log";

/**
 * 답장과 상담 확정(ConsultationModel). 운영자가 적은 확정 답장이 있을 때만 모델을 준다.
 * 다른 홀이 다른 시간을 제안했으면 그 사실과 그날 일정 수를 함께 말한다. 일정에 넣는 것은 따로 누른다.
 *
 * 커플이 직접 보내기(D-83 1단계)가 켜져 있으면 `replyPaste` 에 받은 답 붙여 넣기에서 고를 웨딩홀(열린 편지의
 * 받는 곳과 담은 홀)을 함께 준다. 꺼져 있으면 그 칸도 그 읽기도 없어 응답이 이 스위치 전과 같다.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const opened = await openCoupleRequest(request);
    if (!opened.ok) return opened.response;
    const { supabase, context } = opened;
    const timeline = await readInquiryTimeline(supabase, context.coupleId);
    if (!timeline.ok) return apiError(503, "CONSULTATION_UNAVAILABLE", "상담 정보를 불러오지 못했어요.");
    const halls = await readHallsByIds(supabase, [...new Set(timeline.value.dispatches.map((dispatch) => dispatch.hallId))]);
    if (!halls.ok) return apiError(503, "CONSULTATION_UNAVAILABLE", "상담 정보를 불러오지 못했어요.");

    const events = getEvents(context.journey?.progress ?? {});
    const view = buildConsultation({
      timeline: timeline.value,
      listings: new Map(halls.value.map((hall) => [hall.id, hall])),
      partnerName: context.partnerJoined ? context.partner?.name ?? null : null,
      events,
    });
    const response: InvitationConsultationResponse = view
      ? {
        consultation: view.model,
        replyId: view.reply.id,
        inCalendar: isInCalendar(events, view.reply.id) !== null,
        startsAt: view.reply.eventAt,
      }
      : { consultation: null, replyId: null, inCalendar: false, startsAt: null };
    if (!isInquirySelfSendEnabled()) return privateJson(response);

    const pasteHalls = await readReplyPasteHalls(supabase, context.coupleId);
    if (!pasteHalls.ok) return apiError(503, "CONSULTATION_UNAVAILABLE", "상담 정보를 불러오지 못했어요.");
    const replyPaste = { halls: pasteHalls.value, addedCount: countPastedInCalendar(events) };
    return privateJson({ ...response, replyPaste } satisfies InvitationConsultationResponse);
  } catch (error) {
    log.error("[invitation consultation GET]", error);
    return apiError(500, "SERVER_ERROR", "상담 정보를 불러오지 못했어요.");
  }
}
