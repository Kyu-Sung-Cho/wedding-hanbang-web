import { STATUS_COPY, type AmoraUpdate, type ConsultationModel } from "@hanbang/shared/invitation";
import type { ScheduleEvent } from "@/types/database.types";
import { getScheduleEventStatus, type ScheduleEventDraft } from "@/utils/scheduleEvents";
import type { HallListing } from "./hallCompare";
import type { InquiryTimeline, ReplyRow, DispatchRow } from "./inquiryRepository";
import { latestConfirmed, openProposals } from "./inquiryView";
import { dayWeekdayClockLabel, dotDateLabel, kstParts, updateTimeLabel, weekdayClockLabel } from "./kstFormat";
import { LIVE_COPY } from "./liveCopy";

/**
 * 답장과 상담 확정(W5). 확정 답장이 있으면 상담 화면 모델을 만든다. 일정에 넣는 것은 커플이 눌렀을 때만이다
 * — 아모라가 조용히 넣지 않는다. 넣을 때는 기존 일정 길(`progress.__events`, 공동 계획 쓰기)을 쓰고,
 * 같은 답장을 두 번 넣지 않도록 `sourceKey` 에 답장 ID 를 적는다.
 */

export const CONSULTATION_SOURCE_PREFIX = "hall-consultation:";

export function consultationSourceKey(replyId: string): string {
  return `${CONSULTATION_SOURCE_PREFIX}${replyId}`;
}

export function isInCalendar(events: readonly ScheduleEvent[], replyId: string): ScheduleEvent | null {
  const key = consultationSourceKey(replyId);
  return events.find((event) => event.sourceKey === key && getScheduleEventStatus(event) !== "cancelled") ?? null;
}

/** 일정 한 줄. 날짜와 시각은 한국 시간이다. */
export function consultationEventDraft(input: { reply: ReplyRow; hallName: string }): ScheduleEventDraft {
  const at = kstParts(new Date(input.reply.eventAt as string));
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: at.ymd,
    time: `${pad(at.hour)}:${pad(at.minute)}`,
    title: LIVE_COPY.consultationTitle(input.hallName),
    ...(input.reply.placeNote ? { memo: input.reply.placeNote } : {}),
    categoryKey: "venue",
    sourceKey: consultationSourceKey(input.reply.id),
    status: "planned",
    assignee: { kind: "couple" },
  };
}

/**
 * 받은 답 붙여 넣기(D-83 1단계)로 넣은 상담 일정의 표시. 답장 기록이 없으니 홀과 사람이 고른 날짜(와 시간)로 적는다.
 * 답장 일정(`hall-consultation:`)으로 읽히지 않도록 그 앞머리로 시작하지 않는다(오늘 한 일이 답장 ID 로 읽는다).
 */
export const PASTED_CONSULTATION_SOURCE_PREFIX = "hall-consultation-pasted:";

export function pastedConsultationSourceKey(hallId: string, date: string, time?: string): string {
  return `${PASTED_CONSULTATION_SOURCE_PREFIX}${hallId}:${date}${time ? `T${time}` : ""}`;
}

/**
 * 붙여 넣은 답에서 사람이 고른 날짜로 만든 일정 한 줄. 메모는 두지 않는다: 붙여 넣은 글은 서버에 오지 않고,
 * 상대에게 가는 변경 알림이 메모까지 옮겨 적기 때문이다.
 */
export function pastedConsultationEventDraft(input: {
  hallId: string;
  hallName: string;
  date: string;
  time?: string | null;
}): ScheduleEventDraft & { sourceKey: string } {
  const time = input.time ?? undefined;
  return {
    date: input.date,
    ...(time ? { time } : {}),
    title: LIVE_COPY.consultationTitle(input.hallName),
    categoryKey: "venue",
    sourceKey: pastedConsultationSourceKey(input.hallId, input.date, time),
    status: "planned",
    assignee: { kind: "couple" },
  };
}

/** 붙여 넣은 답에서 사람이 고른 자리. 홀 ID 는 확인해 소문자로 맞춘 값이다. */
export type PastedConsultationSlot = { hallId: string; date: string; time?: string | null };

/**
 * 그 홀의 붙여 넣은 상담이 그 날짜·시간에 이미 있으면 그 일정. 일정의 지금 날짜·시간으로 본다: 일정 화면에서 옮긴
 * 상담은 옮긴 자리에 있고, 열쇠에 남은 처음 자리는 비어 있다(처음 자리를 다시 고르면 새로 넣는다). 날짜만 고르면
 * 그날 그 홀의 상담이 시각과 상관없이 있으면 있는 것으로 본다(일정 화면에서 시각을 채운 상담을 두 번 넣지 않게).
 * 취소한 일정은 없는 것으로 본다.
 */
export function findPastedInCalendar(events: readonly ScheduleEvent[], slot: PastedConsultationSlot): ScheduleEvent | null {
  const hallKey = `${PASTED_CONSULTATION_SOURCE_PREFIX}${slot.hallId}:`;
  const time = slot.time || null;
  return events.find((event) => typeof event.sourceKey === "string"
    && event.sourceKey.startsWith(hallKey)
    && event.date === slot.date
    && (time === null || (event.time || null) === time)
    && getScheduleEventStatus(event) !== "cancelled") ?? null;
}

/** 붙여 넣은 답으로 넣은 상담 일정의 수. 취소한 일정은 세지 않는다. 상담 화면이 "아직 잡힌 상담이 없어요"를 고를 때 쓴다. */
export function countPastedInCalendar(events: readonly ScheduleEvent[]): number {
  return events.filter((event) => typeof event.sourceKey === "string"
    && event.sourceKey.startsWith(PASTED_CONSULTATION_SOURCE_PREFIX)
    && getScheduleEventStatus(event) !== "cancelled").length;
}

function proposalUpdate(
  proposal: { reply: ReplyRow; hallName: string },
  events: readonly ScheduleEvent[],
  now: Date,
): AmoraUpdate {
  const eventAt = new Date(proposal.reply.eventAt as string);
  const day = kstParts(eventAt).ymd;
  const sameDay = events.filter((event) => event.date === day && getScheduleEventStatus(event) !== "cancelled").length;
  return {
    timeLabel: updateTimeLabel(new Date(proposal.reply.recordedAt), now),
    mood: "happy",
    text: `${LIVE_COPY.update.proposed(proposal.hallName, dayWeekdayClockLabel(eventAt))} ${
      sameDay === 0 ? LIVE_COPY.update.noOtherEvents : LIVE_COPY.update.otherEvents(sameDay)
    }`,
    steps: [],
    primary: null,
  };
}

export type ConsultationView = {
  model: ConsultationModel;
  reply: ReplyRow;
  dispatch: DispatchRow;
};

export function buildConsultation(input: {
  timeline: InquiryTimeline;
  listings: ReadonlyMap<string, HallListing>;
  partnerName: string | null;
  events: readonly ScheduleEvent[];
  now?: Date;
}): ConsultationView | null {
  const confirmed = latestConfirmed(input.timeline);
  if (!confirmed) return null;
  const now = input.now ?? new Date();
  const at = new Date(confirmed.reply.eventAt as string);
  const listing = input.listings.get(confirmed.dispatch.hallId) ?? null;
  const proposal = openProposals(input.timeline).find((item) => item.reply.hallId !== confirmed.dispatch.hallId) ?? null;
  return {
    reply: confirmed.reply,
    dispatch: confirmed.dispatch,
    model: {
      dateLabel: dotDateLabel(at),
      timeLabel: weekdayClockLabel(at),
      venue: confirmed.dispatch.recipientName,
      place: confirmed.reply.placeNote ?? listing?.areaLabel ?? "",
      partnerName: input.partnerName,
      photo: listing?.photoUrl ?? null,
      update: proposal ? proposalUpdate(proposal, input.events, now) : null,
      updateActions: proposal
        ? [
          { label: STATUS_COPY.requestThisTime, tone: "ink" },
          { label: STATUS_COPY.askOtherTime, tone: "outline" },
        ]
        : [],
      questions: LIVE_COPY.consultationQuestions(listing?.minimumGuarantee ?? null),
    },
  };
}
