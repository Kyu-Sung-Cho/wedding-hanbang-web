import type { InvitationConsultationResponse } from "@hanbang/shared/invitation";
import { buildConsultation, isInCalendar } from "@/lib/invitation/consultation";
import { readHallsByIds } from "@/lib/invitation/hallRepository";
import { apiError, privateJson } from "@/lib/invitation/http";
import { readInquiryTimeline } from "@/lib/invitation/inquiryRepository";
import { openCoupleRequest } from "@/lib/invitation/routeContext";
import { getEvents } from "@/utils/scheduleEvents";
import { log } from "@/utils/log";

/**
 * 답장과 상담 확정(ConsultationModel). 운영자가 적은 확정 답장이 있을 때만 모델을 준다.
 * 다른 홀이 다른 시간을 제안했으면 그 사실과 그날 일정 수를 함께 말한다. 일정에 넣는 것은 따로 누른다.
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
    return privateJson(response);
  } catch (error) {
    log.error("[invitation consultation GET]", error);
    return apiError(500, "SERVER_ERROR", "상담 정보를 불러오지 못했어요.");
  }
}
