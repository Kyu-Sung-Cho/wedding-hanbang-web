import type { InvitationActivityResponse } from "@hanbang/shared/invitation";
import { buildActivity } from "@/lib/invitation/activity";
import { apiError, privateJson } from "@/lib/invitation/http";
import { readInquiryTimeline } from "@/lib/invitation/inquiryRepository";
import { openCoupleRequest } from "@/lib/invitation/routeContext";
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
    const response: InvitationActivityResponse = {
      activity: buildActivity({ timeline: timeline.value, events: getEvents(opened.context.journey?.progress ?? {}) }),
    };
    return privateJson(response);
  } catch (error) {
    log.error("[invitation activity GET]", error);
    return apiError(500, "SERVER_ERROR", "오늘 한 일을 불러오지 못했어요.");
  }
}
