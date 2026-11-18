import type { InvitationActivityEntry, InvitationActor } from "@hanbang/shared/invitation";
import type { ScheduleEvent } from "@/types/database.types";
import { CONSULTATION_SOURCE_PREFIX } from "./consultation";
import type { InquiryTimeline } from "./inquiryRepository";
import { hhmm, kstParts } from "./kstFormat";
import { LIVE_COPY } from "./liveCopy";

/**
 * 웹 준비 공간의 오늘 한 일. 오늘(한국 날짜) 기록에 남은 시각만 쓴다:
 * 편지를 보낸 시각, 답장을 정리한 시각, 상담을 일정에 넣은 시각. 기록에 없는 일은 줄로 만들지 않는다.
 *
 * 줄마다 누가 했는지(actor)를 붙인다. 파일럿 동안 보내기와 답장 정리는 담당자(사람)가 하고,
 * 상담을 일정에 넣는 것은 두 분 중 한 사람이 누를 때만 일어난다. 아모라가 하지 않은 일을 아모라의 일로 적지 않는다.
 */

type Line = { at: string; actor: InvitationActor; text: string };

export function buildActivity(input: {
  timeline: InquiryTimeline;
  events: readonly ScheduleEvent[];
  now?: Date;
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
    if (!event.sourceKey?.startsWith(CONSULTATION_SOURCE_PREFIX) || !isToday(event.createdAt)) continue;
    const hall = replyHall.get(event.sourceKey.slice(CONSULTATION_SOURCE_PREFIX.length));
    if (hall) lines.push({ at: event.createdAt, actor: "couple", text: LIVE_COPY.activity.schedule(hall) });
  }

  return lines
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .map((line) => ({ timeLabel: hhmm(new Date(line.at)), text: line.text, actor: line.actor }));
}
