import { VENDOR_REPLY_COPY, type ConsultationScheduleResult } from "@hanbang/shared/invitation";
import { createAdminClient } from "@/lib/supabase/admin";
import { findPastedInCalendar, pastedConsultationEventDraft, type PastedConsultationSlot } from "@/lib/invitation/consultation";
import { apiError, privateJson, readJsonBody } from "@/lib/invitation/http";
import { applyProgressChange, type ProgressPatchPlan } from "@/lib/invitation/planChange";
import { parsePastedScheduleInput, readReplyPasteHalls, type PastedScheduleInputResult } from "@/lib/invitation/replyPaste";
import { openCoupleRequest } from "@/lib/invitation/routeContext";
import { isInquirySelfSendEnabled } from "@/lib/invitation/switches";
import {
  ScheduleEventCapacityError,
  ScheduleEventValidationError,
  addEvent,
  getEvents,
  type ScheduleEventDraft,
} from "@/utils/scheduleEvents";
import { log } from "@/utils/log";

/**
 * 받은 답 붙여 넣기(D-83 1단계): 사람이 고른 웨딩홀·날짜(와 시간)로 상담 일정 하나를 넣는다. 누를 때만 부른다.
 * 받는 것은 `{ hallId, date, time? }` 세 칸뿐이다. 붙여 넣은 글은 이 요청에 없다(기기 안에서만 읽는다).
 * 직접 보내기 스위치가 꺼져 있으면 이 길은 없다: 로그인·요청 제한·DB 보다 먼저 404 다.
 * 홀은 담은 홀이나 열린 편지의 받는 곳이어야 한다. W5 일정 넣기와 같은 길(공동 계획 쓰기로 `progress.__events` 에
 * 한 줄 덧붙이기)을 쓰고, 같은 홀·날짜·시간에는 한 번만 들어간다. 그 자리는 일정의 지금 날짜·시간으로 본다
 * (일정 화면에서 옮긴 상담은 옮긴 자리에 있다).
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 512;

// 화면 문장 묶음(VENDOR_REPLY_COPY)에 없는 서버 상태는 W5 일정 넣기(consultation/schedule)가 쓰는 문장을 그대로 쓴다.
const SERVER_MESSAGES = {
  notAvailable: "일정에 넣지 못했어요.",
  unavailable: "상담 정보를 불러오지 못했어요.",
  full: "일정이 너무 많아 더 넣을 수 없어요.",
  unconfirmed: "일정에 들어갔는지 확인하지 못했어요. 일정 화면을 확인해 주세요.",
} as const;

const INPUT_MESSAGES: Record<Extract<PastedScheduleInputResult, { ok: false }>["field"], string> = {
  body: VENDOR_REPLY_COPY.failed,
  hallId: VENDOR_REPLY_COPY.pickHall,
  date: VENDOR_REPLY_COPY.pickDate,
  dateRange: VENDOR_REPLY_COPY.dateOutOfRange,
  time: VENDOR_REPLY_COPY.failed,
};

/** 그 자리에 그 홀의 상담이 이미 있으면 그대로 두고, 없으면 한 줄 덧붙인다. 바꾸는 칸은 `__events` 하나다. */
function planPastedEvent(
  progress: Record<string, unknown>,
  slot: PastedConsultationSlot,
  draft: ScheduleEventDraft & { sourceKey: string },
): ProgressPatchPlan {
  if (findPastedInCalendar(getEvents(progress), slot)) return { kind: "unchanged" };
  try {
    const { newProgress } = addEvent(progress, draft);
    return { kind: "patch", patch: { __events: newProgress.__events }, summary: `일정: ${draft.title}` };
  } catch (error) {
    if (error instanceof ScheduleEventCapacityError) {
      return { kind: "failed", status: 409, code: "SCHEDULE_FULL", error: SERVER_MESSAGES.full };
    }
    if (error instanceof ScheduleEventValidationError) {
      return { kind: "failed", status: 400, code: "SCHEDULE_INVALID", error: SERVER_MESSAGES.notAvailable };
    }
    throw error;
  }
}

export async function POST(request: Request) {
  if (!isInquirySelfSendEnabled()) return apiError(404, "NOT_FOUND", SERVER_MESSAGES.notAvailable);
  try {
    const opened = await openCoupleRequest(request, { mutation: { key: "consultation-paste-schedule", perMinute: 10 } });
    if (!opened.ok) return opened.response;
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const input = parsePastedScheduleInput(body.value);
    if (!input.ok) return apiError(400, "PASTE_SCHEDULE_INVALID", INPUT_MESSAGES[input.field]);

    const { supabase, context } = opened;
    const halls = await readReplyPasteHalls(supabase, context.coupleId);
    if (!halls.ok) return apiError(503, "CONSULTATION_UNAVAILABLE", SERVER_MESSAGES.unavailable);
    const hall = halls.value.find((item) => item.hallId === input.value.hallId);
    if (!hall) return apiError(404, "HALL_NOT_FOUND", VENDOR_REPLY_COPY.pickHall);

    const slot: PastedConsultationSlot = { hallId: hall.hallId, date: input.value.date, time: input.value.time };
    const draft = pastedConsultationEventDraft({ ...slot, hallName: hall.name });
    const outcome = await applyProgressChange({
      supabase,
      admin: createAdminClient(),
      coupleId: context.coupleId,
      actorUserId: context.userId,
      surface: "/schedule",
      build: (progress) => planPastedEvent(progress, slot, draft),
    });
    if (outcome.kind === "failed") return apiError(outcome.status, outcome.code, outcome.error);

    const event = findPastedInCalendar(getEvents(outcome.progress), slot);
    if (!event) return apiError(503, "SCHEDULE_UNCONFIRMED", SERVER_MESSAGES.unconfirmed);
    const response: ConsultationScheduleResult = {
      added: outcome.kind === "applied",
      alreadyInCalendar: outcome.kind === "unchanged",
      eventId: event.id,
    };
    return privateJson(response);
  } catch (error) {
    log.error("[invitation consultation paste-schedule POST]", error);
    return apiError(500, "SERVER_ERROR", SERVER_MESSAGES.notAvailable);
  }
}
