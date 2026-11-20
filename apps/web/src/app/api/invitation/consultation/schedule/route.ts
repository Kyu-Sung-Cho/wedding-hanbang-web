import type { ConsultationScheduleResult } from "@hanbang/shared/invitation";
import { createAdminClient } from "@/lib/supabase/admin";
import { consultationEventDraft, isInCalendar } from "@/lib/invitation/consultation";
import { apiError, privateJson, readJsonBody } from "@/lib/invitation/http";
import { readInquiryTimeline } from "@/lib/invitation/inquiryRepository";
import { applyProgressChange } from "@/lib/invitation/planChange";
import { openCoupleRequest } from "@/lib/invitation/routeContext";
import {
  ScheduleEventCapacityError,
  ScheduleEventValidationError,
  addEvent,
  getEvents,
} from "@/utils/scheduleEvents";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { log } from "@/utils/log";

/**
 * 확정된 상담을 일정에 넣는다(W5). 커플이 누를 때만 부른다. 기존 일정 길(공동 계획 쓰기로
 * `progress.__events` 에 한 줄 덧붙이기)을 그대로 쓰므로 확정 기록과 상대 알림도 그 길이 맡는다.
 * 같은 답장은 한 번만 들어간다(`sourceKey` = 답장 ID).
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 512;

export async function POST(request: Request) {
  try {
    const opened = await openCoupleRequest(request, { mutation: { key: "consultation-schedule", perMinute: 10 } });
    if (!opened.ok) return opened.response;
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    if (!isRecord(body.value) || Object.keys(body.value).some((key) => key !== "replyId") || !isUuid(body.value.replyId)) {
      return apiError(400, "REPLY_ID_INVALID", "상담 답장을 다시 불러와 주세요.");
    }
    const replyId = body.value.replyId.toLowerCase();

    const { supabase, context } = opened;
    const timeline = await readInquiryTimeline(supabase, context.coupleId);
    if (!timeline.ok) return apiError(503, "CONSULTATION_UNAVAILABLE", "상담 정보를 불러오지 못했어요.");
    const reply = timeline.value.replies.find((row) => row.id === replyId);
    const dispatch = reply ? timeline.value.dispatches.find((row) => row.id === reply.dispatchId) : undefined;
    if (!reply || !dispatch) return apiError(404, "REPLY_NOT_FOUND", "상담 답장을 찾지 못했어요.");
    if (reply.outcome !== "confirmed_time" || !reply.eventAt) {
      return apiError(409, "REPLY_NOT_CONFIRMED", "확정된 상담 시간만 일정에 넣을 수 있어요.");
    }

    const draft = consultationEventDraft({ reply, hallName: dispatch.recipientName });
    const outcome = await applyProgressChange({
      supabase,
      admin: createAdminClient(),
      coupleId: context.coupleId,
      actorUserId: context.userId,
      surface: "/schedule",
      build: (progress) => {
        if (isInCalendar(getEvents(progress), replyId)) return { kind: "unchanged" };
        try {
          const { newProgress } = addEvent(progress, draft);
          return { kind: "patch", patch: { __events: newProgress.__events }, summary: `일정: ${draft.title}` };
        } catch (error) {
          if (error instanceof ScheduleEventCapacityError) {
            return { kind: "failed", status: 409, code: "SCHEDULE_FULL", error: "일정이 너무 많아 더 넣을 수 없어요." };
          }
          if (error instanceof ScheduleEventValidationError) {
            return { kind: "failed", status: 400, code: "SCHEDULE_INVALID", error: "일정을 만들 수 없는 답장이에요." };
          }
          throw error;
        }
      },
    });
    if (outcome.kind === "failed") return apiError(outcome.status, outcome.code, outcome.error);

    const event = isInCalendar(getEvents(outcome.progress), replyId);
    if (!event) return apiError(503, "SCHEDULE_UNCONFIRMED", "일정에 들어갔는지 확인하지 못했어요. 일정 화면을 확인해 주세요.");
    const response: ConsultationScheduleResult = {
      added: outcome.kind === "applied",
      alreadyInCalendar: outcome.kind === "unchanged",
      eventId: event.id,
    };
    return privateJson(response);
  } catch (error) {
    log.error("[invitation consultation schedule POST]", error);
    return apiError(500, "SERVER_ERROR", "일정에 넣지 못했어요.");
  }
}
