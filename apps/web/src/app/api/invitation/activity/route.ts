import type { InvitationActivityResponse } from "@hanbang/shared/invitation";
import { buildActivity, pastedHallIdsAddedToday } from "@/lib/invitation/activity";
import { MAX_COMPARE_HALLS, readHallsByIds } from "@/lib/invitation/hallRepository";
import { apiError, privateJson } from "@/lib/invitation/http";
import { readInquiryTimeline } from "@/lib/invitation/inquiryRepository";
import { openCoupleRequest } from "@/lib/invitation/routeContext";
import { isInquirySelfSendEnabled } from "@/lib/invitation/switches";
import { getEvents } from "@/utils/scheduleEvents";
import { log } from "@/utils/log";

/** 오늘(한국 날짜) 문의·답장·일정 기록에 남은 일만 시각과 함께 준다. */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const opened = await openCoupleRequest(request);
    if (!opened.ok) return opened.response;
    const timeline = await readInquiryTimeline(opened.supabase, opened.context.coupleId);
    if (!timeline.ok) return apiError(503, "ACTIVITY_UNAVAILABLE", "오늘 한 일을 불러오지 못했어요.");
    const events = getEvents(opened.context.journey?.progress ?? {});
    // 오늘 붙여 넣은 답으로 넣은 상담(D-83 1단계)은 직접 보내기가 켜져 있을 때만 줄로 만들고, 그 상담의 홀 이름만 읽는다.
    // 스위치가 꺼져 있거나 그런 상담이 없으면 목록이 비어 DB 를 읽지 않으므로 이 경로는 스위치 전과 같다(readHallsByIds 는
    // 빈 목록이면 바로 돌아온다). 상담 화면(consultation GET)도 같은 스위치를 따른다. 한 번에 읽는 홀은 MAX_COMPARE_HALLS 곳까지다.
    const pastedHallIds = isInquirySelfSendEnabled() ? pastedHallIdsAddedToday(events).slice(0, MAX_COMPARE_HALLS) : [];
    const halls = await readHallsByIds(opened.supabase, pastedHallIds);
    if (!halls.ok) return apiError(503, "ACTIVITY_UNAVAILABLE", "오늘 한 일을 불러오지 못했어요.");
    const pastedHallNames: ReadonlyMap<string, string> = new Map(halls.value.map((hall) => [hall.id, hall.name]));
    const response: InvitationActivityResponse = {
      activity: buildActivity({ timeline: timeline.value, events, pastedHallNames }),
    };
    return privateJson(response);
  } catch (error) {
    log.error("[invitation activity GET]", error);
    return apiError(500, "SERVER_ERROR", "오늘 한 일을 불러오지 못했어요.");
  }
}
