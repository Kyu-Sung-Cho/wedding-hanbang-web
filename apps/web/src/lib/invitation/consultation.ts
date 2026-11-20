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
