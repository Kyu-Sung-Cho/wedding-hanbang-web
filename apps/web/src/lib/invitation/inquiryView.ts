import type { AmoraUpdate, DecisionItem, InvitationActorLine, LetterState } from "@hanbang/shared/invitation";
import type { HallInquiryState } from "./hallCompare";
import type { DispatchRow, InquiryTimeline, LetterVersionRow, ReplyRow } from "./inquiryRepository";
import { dayWeekdayClockLabel, KOREAN_WEEKDAYS, koreanClock, kstParts, monthDayLabel, updateTimeLabel, weekdayClockLabel } from "./kstFormat";
import { LIVE_COPY } from "./liveCopy";

/**
 * 문의 기록에서 화면 문장을 만든다. 실제로 일어난 일(승인, 보냄, 답장)과 그 시각만 쓴다.
 * 아모라가 한 일처럼 지어내지 않는다 — 기록에 없는 비교·확인은 문장에 넣지 않는다.
 * 보내기와 답장 정리는 담당자(사람)가 하므로 그 줄은 담당자의 일로 쓰고 actor 도 operator 로 붙인다.
 */

const byTimeDesc = (left: string, right: string) => Date.parse(right) - Date.parse(left);

/** 홀마다 가장 최근 발송과 그 발송 뒤의 가장 최근 답장. 거둬들인 문의는 문의하지 않은 것과 같다. */
export function hallInquiryStates(timeline: InquiryTimeline): Map<string, HallInquiryState> {
  const states = new Map<string, HallInquiryState>();
  const dispatches = [...timeline.dispatches].sort((a, b) => byTimeDesc(a.queuedAt, b.queuedAt));
  for (const dispatch of dispatches) {
    if (dispatch.status === "withdrawn" || states.has(dispatch.hallId)) continue;
    const reply = timeline.replies
      .filter((row) => row.dispatchId === dispatch.id)
      .sort((a, b) => byTimeDesc(a.recordedAt, b.recordedAt))[0];
    states.set(dispatch.hallId, {
      dispatchStatus: dispatch.status,
      reply: reply ? { outcome: reply.outcome, eventAt: reply.eventAt } : null,
    });
  }
  return states;
}

function dispatchFor(timeline: InquiryTimeline, reply: ReplyRow): DispatchRow | undefined {
  return timeline.dispatches.find((dispatch) => dispatch.id === reply.dispatchId);
}

/**
 * 아직 답하지 않은 제안 시간. 같은 홀에서 뒤에 온 답장이 있으면 그 제안은 지난 것이다.
 * 탈퇴로 지운 문의의 제안은 더 답할 수 없어 뺀다.
 */
export function openProposals(timeline: InquiryTimeline): { reply: ReplyRow; hallName: string }[] {
  const latestByHall = new Map<string, ReplyRow>();
  for (const reply of [...timeline.replies].sort((a, b) => byTimeDesc(a.recordedAt, b.recordedAt))) {
    if (!latestByHall.has(reply.hallId)) latestByHall.set(reply.hallId, reply);
  }
  return [...latestByHall.values()]
    .filter((reply) => reply.outcome === "proposed_time" && reply.eventAt)
    .flatMap((reply) => {
      const dispatch = dispatchFor(timeline, reply);
      return dispatch && !dispatch.redacted ? [{ reply, hallName: dispatch.recipientName }] : [];
    });
}

/** 가장 최근에 확정된 상담(가장 늦게 적힌 확정 답장). */
export function latestConfirmed(timeline: InquiryTimeline): { reply: ReplyRow; dispatch: DispatchRow } | null {
  const confirmed = timeline.replies
    .filter((reply) => reply.outcome === "confirmed_time" && reply.eventAt)
    .sort((a, b) => byTimeDesc(a.recordedAt, b.recordedAt));
  for (const reply of confirmed) {
    const dispatch = dispatchFor(timeline, reply);
    if (dispatch) return { reply, dispatch };
  }
  return null;
}

/** 소식 한 단락과 그 "무엇을 했나요?" 줄. 줄마다 누가 했는지 붙어 있다. */
export type AmoraUpdateDetail = { update: AmoraUpdate; steps: readonly InvitationActorLine[] };

type Draft = Omit<AmoraUpdate, "steps"> & { steps: readonly InvitationActorLine[] };
type Candidate = { at: string; build: () => Draft };

function versionSteps(version: LetterVersionRow | undefined, timeline: InquiryTimeline): InvitationActorLine[] {
  if (!version) return [];
  const steps: InvitationActorLine[] = [];
  if (version.approvalCompletedAt) {
    steps.push({ actor: "couple", text: LIVE_COPY.steps.approved(version.recipientNames.join(", ")) });
  }
  const sent = timeline.dispatches.filter((dispatch) => dispatch.versionId === version.id && dispatch.status === "sent");
  if (sent.length > 0) steps.push({ actor: "operator", text: LIVE_COPY.steps.sent(sent.length) });
  const sentIds = new Set(sent.map((dispatch) => dispatch.id));
  for (const reply of [...timeline.replies].filter((row) => sentIds.has(row.dispatchId)).sort((a, b) => byTimeDesc(b.recordedAt, a.recordedAt))) {
    const hall = dispatchFor(timeline, reply)?.recipientName;
    if (hall) steps.push({ actor: "operator", text: LIVE_COPY.steps.reply(hall) });
  }
  return steps.slice(0, 4);
}

export type AmoraUpdateInput = {
  timeline: InquiryTimeline;
  openLetter: { version: LetterVersionRow; state: LetterState } | null;
  now?: Date;
  /**
   * 커플이 직접 보내기(D-83 1단계). 승인을 쓰지 않으므로 "편지가 승인됐어요… 아직 보내지 않았어요" 소식을
   * 만들지 않는다. 기본은 false 이고 그때는 이 칸이 생기기 전과 같다.
   */
  selfSendMode?: boolean;
};

/**
 * 홈의 아모라 소식 한 단락. 가장 최근에 실제로 일어난 일 하나를 말한다. 없으면 null 이고 화면은 그 칸을 그리지 않는다.
 */
export function buildAmoraUpdate(input: AmoraUpdateInput): AmoraUpdate | null {
  return buildAmoraUpdateDetail(input)?.update ?? null;
}

/** 소식과 함께 "무엇을 했나요?" 줄의 actor 를 준다. `update.steps` 는 그 줄의 글만 같은 순서로 담는다. */
export function buildAmoraUpdateDetail(input: AmoraUpdateInput): AmoraUpdateDetail | null {
  const { timeline } = input;
  const now = input.now ?? new Date();
  const versionOf = (dispatch: DispatchRow | undefined) =>
    dispatch ? timeline.versions.find((version) => version.id === dispatch.versionId) : undefined;
  const candidates: Candidate[] = [];

  for (const reply of timeline.replies) {
    const dispatch = dispatchFor(timeline, reply);
    if (!dispatch) continue;
    const hall = dispatch.recipientName;
    candidates.push({
      at: reply.recordedAt,
      build: () => {
        const steps = versionSteps(versionOf(dispatch), timeline);
        if (reply.outcome === "confirmed_time" && reply.eventAt) {
          const at = new Date(reply.eventAt);
          return {
            timeLabel: updateTimeLabel(new Date(reply.recordedAt), now),
            mood: "happy",
            text: LIVE_COPY.update.confirmed(hall, `${monthDayLabel(at)} ${weekdayClockLabel(at)}`),
            steps,
            primary: { label: LIVE_COPY.update.viewConsultation, target: "status" },
          };
        }
        if (reply.outcome === "proposed_time" && reply.eventAt) {
          return {
            timeLabel: updateTimeLabel(new Date(reply.recordedAt), now),
            mood: "happy",
            text: LIVE_COPY.update.proposed(hall, dayWeekdayClockLabel(new Date(reply.eventAt))),
            steps,
            primary: { label: LIVE_COPY.update.viewReply, target: "status" },
          };
        }
        if (reply.outcome === "declined") {
          return {
            timeLabel: updateTimeLabel(new Date(reply.recordedAt), now),
            mood: "calm",
            text: LIVE_COPY.update.declined(hall),
            steps,
            primary: { label: LIVE_COPY.update.viewHalls, target: "compare" },
          };
        }
        return {
          timeLabel: updateTimeLabel(new Date(reply.recordedAt), now),
          mood: "calm",
          text: reply.rawText ? LIVE_COPY.update.replied(hall) : LIVE_COPY.update.repliedWithoutText(hall),
          steps,
          primary: { label: LIVE_COPY.update.viewReply, target: "status" },
        };
      },
    });
  }

  const byVersion = new Map<string, DispatchRow[]>();
  for (const dispatch of timeline.dispatches) byVersion.set(dispatch.versionId, [...(byVersion.get(dispatch.versionId) ?? []), dispatch]);
  for (const dispatches of byVersion.values()) {
    const sent = dispatches.filter((dispatch) => dispatch.status === "sent" && dispatch.sentAt);
    const queued = dispatches.filter((dispatch) => dispatch.status === "queued");
    if (sent.length > 0) {
      const at = sent.map((dispatch) => dispatch.sentAt as string).sort(byTimeDesc)[0];
      candidates.push({
        at,
        build: () => ({
          timeLabel: updateTimeLabel(new Date(at), now),
          mood: "working",
          text: LIVE_COPY.update.sent(sent.length),
          steps: versionSteps(versionOf(sent[0]), timeline),
          primary: null,
        }),
      });
    } else if (queued.length > 0) {
      const at = queued.map((dispatch) => dispatch.queuedAt).sort(byTimeDesc)[0];
      candidates.push({
        at,
        build: () => ({
          timeLabel: updateTimeLabel(new Date(at), now),
          mood: "working",
          text: LIVE_COPY.update.queued(queued.length),
          steps: versionSteps(versionOf(queued[0]), timeline),
          primary: null,
        }),
      });
    }
  }

  // 직접 보내기에서는 승인한 편지가 대기열을 기다리지 않는다. 그 소식(멈춤·상한)을 후보에 넣지 않는다.
  const open = input.selfSendMode ? null : input.openLetter;
  const capped = open?.state.notQueuedReason === "daily_cap" || open?.state.notQueuedReason === "global_daily_cap";
  if (open && open.state.status === "approved_not_queued" && open.version.approvalCompletedAt
    && (open.state.notQueuedReason === "sending_disabled" || capped)) {
    const at = open.version.approvalCompletedAt;
    candidates.push({
      at,
      build: () => ({
        timeLabel: updateTimeLabel(new Date(at), now),
        mood: "calm",
        text: capped ? LIVE_COPY.update.capped : LIVE_COPY.update.paused,
        steps: [],
        primary: { label: LIVE_COPY.update.viewLetter, target: "letter" },
      }),
    });
  }

  const latest = candidates.sort((a, b) => byTimeDesc(a.at, b.at))[0];
  if (!latest) return null;
  const draft = latest.build();
  return { update: { ...draft, steps: draft.steps.map((step) => step.text) }, steps: draft.steps };
}

/** 제안 시간의 짧은 꼴("토요일 오후 4시"). */
export function proposalShortLabel(eventAt: string): string {
  const parts = kstParts(new Date(eventAt));
  return `${KOREAN_WEEKDAYS[parts.weekday]} ${koreanClock(parts.hour, parts.minute)}`;
}

/** 두 분이 정할 것 가운데 문의에서 생긴 줄(대체 시간, 편지 승인). */
export function inquiryDecisions(input: {
  timeline: InquiryTimeline;
  openLetter: { version: LetterVersionRow; state: LetterState } | null;
  viewerId: string;
  nameOf: (userId: string) => string | null;
  /** 커플이 직접 보내기(D-83 1단계)에서는 승인을 쓰지 않으므로 편지 승인 줄을 만들지 않는다. 기본 false. */
  selfSendMode?: boolean;
}): DecisionItem[] {
  const items: DecisionItem[] = openProposals(input.timeline).map(({ reply, hallName }) => ({
    id: `proposal-${reply.id}`,
    title: LIVE_COPY.decisions.alternativeTime(hallName),
    sub: LIVE_COPY.decisions.proposedSub(proposalShortLabel(reply.eventAt as string)),
    owner: { kind: "together" },
    target: "status",
  }));

  const open = input.selfSendMode ? null : input.openLetter;
  const pending = open && (open.state.status === "awaiting_approval" || open.state.status === "draft");
  if (open && pending && open.state.waitingFor.length > 0) {
    const waiting = open.state.waitingFor;
    const single = waiting.length === 1;
    const name = single ? input.nameOf(waiting[0]) : null;
    items.push({
      id: `letter-${open.version.id}`,
      title: LIVE_COPY.decisions.letterApproval,
      sub: open.state.approver.mode === "unset"
        ? LIVE_COPY.decisions.letterEitherOne
        : waiting.includes(input.viewerId)
          ? LIVE_COPY.decisions.letterYourTurn
          : LIVE_COPY.decisions.letterWaitingFor(name ?? LIVE_COPY.partnerFallback),
      owner: single && name ? { kind: "person", name } : { kind: "together" },
      target: "letter",
    });
  }
  return items;
}
