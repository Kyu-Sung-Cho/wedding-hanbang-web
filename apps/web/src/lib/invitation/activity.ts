import type { InvitationActivityEntry, InvitationActor } from "@hanbang/shared/invitation";
import type { ScheduleEvent } from "@/types/database.types";
import { CONSULTATION_SOURCE_PREFIX, PASTED_CONSULTATION_SOURCE_PREFIX } from "./consultation";
import type { InquiryTimeline } from "./inquiryRepository";
import { hhmm, kstParts } from "./kstFormat";
import { LIVE_COPY } from "./liveCopy";

/**
 * 웹 준비 공간의 오늘 한 일. 오늘(한국 날짜) 기록에 남은 시각만 쓴다:
 * 편지를 보낸 시각, 답장을 정리한 시각, 상담을 일정에 넣은 시각(답장으로 넣은 것과 붙여 넣은 답으로 넣은 것).
 * 기록에 없는 일은 줄로 만들지 않는다.
 *
 * 줄마다 누가 했는지(actor)를 붙인다. 파일럿 동안 보내기와 답장 정리는 담당자(사람)가 하고,
 * 상담을 일정에 넣는 것은 두 분 중 한 사람이 누를 때만 일어난다. 아모라가 하지 않은 일을 아모라의 일로 적지 않는다.
 */

type Line = { at: string; actor: InvitationActor; text: string };

/** 붙여 넣은 답으로 넣은 상담 일정(D-83 1단계)의 웨딩홀 ID. 열쇠는 `hall-consultation-pasted:<홀 ID>:<날짜>[T<시각>]` 이다. */
export function pastedConsultationHallId(sourceKey: string | undefined): string | null {
  if (!sourceKey?.startsWith(PASTED_CONSULTATION_SOURCE_PREFIX)) return null;
  const hallId = sourceKey.slice(PASTED_CONSULTATION_SOURCE_PREFIX.length).split(":")[0];
  return hallId.length > 0 ? hallId : null;
}

/** 오늘(한국 날짜) 붙여 넣은 답으로 넣은 상담의 웨딩홀 ID(겹치지 않게). 활동 경로는 이 홀들의 이름만 읽는다. */
export function pastedHallIdsAddedToday(events: readonly ScheduleEvent[], now: Date = new Date()): string[] {
  const today = kstParts(now).ymd;
  const ids = events.flatMap((event) => {
    const hallId = pastedConsultationHallId(event.sourceKey);
    return hallId && kstParts(new Date(event.createdAt)).ymd === today ? [hallId] : [];
  });
  return [...new Set(ids)];
}

export function buildActivity(input: {
  timeline: InquiryTimeline;
  events: readonly ScheduleEvent[];
  now?: Date;
  /** 붙여 넣은 답으로 넣은 상담의 홀 이름(홀 ID → 이름). 이름이 없는 홀의 줄은 만들지 않는다. */
  pastedHallNames?: ReadonlyMap<string, string>;
}): InvitationActivityEntry[] {
  const today = kstParts(input.now ?? new Date()).ymd;
  const isToday = (iso: string) => kstParts(new Date(iso)).ymd === today;
  const lines: Line[] = [];

  const sentByVersion = new Map<string, string[]>();
  for (const dispatch of input.timeline.dispatches) {
    if (dispatch.status !== "sent" || !dispatch.sentAt || !isToday(dispatch.sentAt)) continue;
    sentByVersion.set(dispatch.versionId, [...(sentByVersion.get(dispatch.versionId) ?? []), dispatch.sentAt]);
  }
  for (const times of sentByVersion.values()) {
    const latest = [...times].sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    lines.push({ at: latest, actor: "operator", text: LIVE_COPY.activity.sent(times.length) });
  }

  const dispatchName = new Map(input.timeline.dispatches.map((dispatch) => [dispatch.id, dispatch.recipientName]));
  const replyHall = new Map<string, string>();
  for (const reply of input.timeline.replies) {
    const hall = dispatchName.get(reply.dispatchId);
    if (!hall) continue;
    replyHall.set(reply.id, hall);
    if (isToday(reply.recordedAt)) lines.push({ at: reply.recordedAt, actor: "operator", text: LIVE_COPY.activity.reply(hall) });
  }

  for (const event of input.events) {
    if (!isToday(event.createdAt)) continue;
    // 붙여 넣은 답으로 넣은 상담도 두 분이 일정에 넣은 일이다(D-83 1단계). 답장 기록이 없으니 홀 이름은 따로 받는다.
    const pastedHall = pastedConsultationHallId(event.sourceKey);
    if (pastedHall) {
      const name = input.pastedHallNames?.get(pastedHall);
      if (name) lines.push({ at: event.createdAt, actor: "couple", text: LIVE_COPY.activity.schedule(name) });
      continue;
    }
    if (!event.sourceKey?.startsWith(CONSULTATION_SOURCE_PREFIX)) continue;
    const hall = replyHall.get(event.sourceKey.slice(CONSULTATION_SOURCE_PREFIX.length));
    if (hall) lines.push({ at: event.createdAt, actor: "couple", text: LIVE_COPY.activity.schedule(hall) });
  }

  return lines
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .map((line) => ({ timeLabel: hhmm(new Date(line.at)), text: line.text, actor: line.actor }));
}
