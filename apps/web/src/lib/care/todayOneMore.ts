import { createHash } from "node:crypto";

import {
  TODAY_ONE_CARE_NEXT_ACTIONS,
  type TodayOneCareChoice,
  type TodayOneCareKind,
} from "@hanbang/shared";
import type { DecisionItem } from "@hanbang/shared/invitation";
import type { AmoraActionItem } from "@/lib/amora/actions";
import type { InquiryTimeline } from "@/lib/invitation/inquiryRepository";
import { ymdInKst } from "@/lib/utils/kstDate";

import type { TodayOneCandidate } from "./todayOne";

/**
 * 오늘의 한 가지가 2026-11-20(25장 2절)부터 더 고르는 셋. 고르는 것은 이 규칙이고 문장은 정해진 틀이다(파운더 승인,
 * 18장 D-12). 모델을 부르지 않고, 저장된 기록(함께 쓰는 할 일, 문의 기록, 홈의 "두 분이 정할 것")만 읽는다.
 *
 *   task_deadline    함께 쓰는 할 일의 마감이 오늘·내일·사흘 뒤
 *   couple_decision  홈의 "두 분이 정할 것" 가운데 문의에서 생긴 줄(업체가 제안한 시간, 편지 확인)
 *   inquiry_waiting  보낸 문의가 48시간 넘게 답이 없음
 *
 * 끝난 맡은 일(갈래 4)은 `TODAY_ONE_EXTRA_SOURCES` 에 그 갈래가 자기 고르기를 더하는 자리만 둔다.
 */

export const INQUIRY_WAITING_HOURS = 48;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_PER_KIND = 6;
const UNSAFE_DISPLAY_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 우선순위. 일정(d1 100·d3 60·지난 날 40)과 예산(200~300) 사이에 둔다. */
export const TODAY_ONE_MORE_PRIORITY = {
  taskDue0: 120,
  taskDue1: 105,
  taskDue3: 65,
  decision: 115,
  inquiryWaiting: 90,
} as const;

export const TODAY_ONE_MORE_COPY = {
  task: {
    whyNow: {
      d0: "오늘까지 해 둘 할 일이 있어요.",
      d1: "내일까지 해 둘 할 일이 있어요.",
      d3: "사흘 뒤까지 해 둘 할 일이 있어요.",
    },
    confirmedTitle: (title: string) => `할 일: ${title}`,
    confirmedDue: (month: number, day: number) => `마감: ${month}월 ${day}일`,
    unknown: "어디까지 했는지는 할 일 기록만으로는 알 수 없어요.",
    impact: "확인만 하며 할 일이나 일정은 바꾸지 않아요.",
  },
  decision: {
    whyNow: "두 분이 정할 것이 하나 있어요.",
    impact: "확인만 하며 문의나 일정은 바꾸지 않아요.",
  },
  inquiry: {
    whyNow: "보낸 문의에 이틀 넘게 답이 없어요.",
    confirmedHall: (hall: string) => `웨딩홀: ${hall}`,
    confirmedSent: (month: number, day: number) => `보낸 날: ${month}월 ${day}일`,
    unknown: "업체가 전화나 문자로 따로 답했는지는 여기 기록만으로 알 수 없어요.",
    impact: "확인만 하며 업체에 다시 연락하지 않아요.",
  },
  choices: {
    snooze: "나중에",
    dismiss: "오늘 닫기",
    mute: "내용이 바뀔 때까지 숨기기",
  },
} as const;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isSafeDisplayText(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxLength
    && !UNSAFE_DISPLAY_RE.test(value);
}

function choicesFor(kind: TodayOneCareKind): TodayOneCareChoice[] {
  return [
    { action: "open_source", label: TODAY_ONE_CARE_NEXT_ACTIONS[kind].label },
    { action: "snooze", label: TODAY_ONE_MORE_COPY.choices.snooze },
    { action: "dismiss", label: TODAY_ONE_MORE_COPY.choices.dismiss },
    { action: "mute_source", label: TODAY_ONE_MORE_COPY.choices.mute },
  ];
}

function nextAction(kind: TodayOneCareKind, href?: string) {
  const allowed = TODAY_ONE_CARE_NEXT_ACTIONS[kind];
  return {
    label: allowed.label,
    href: href && allowed.hrefs.includes(href) ? href : allowed.hrefs[0],
  };
}

function ymdParts(ymd: string): { month: number; day: number } | null {
  const match = YMD_RE.exec(ymd);
  return match ? { month: Number(match[2]), day: Number(match[3]) } : null;
}

/** 두 KST 날짜(YYYY-MM-DD) 사이의 날 수. 같은 날이면 0. */
function daysBetweenYmd(from: string, to: string): number | null {
  if (!YMD_RE.test(from) || !YMD_RE.test(to)) return null;
  const start = Date.parse(`${from}T00:00:00+09:00`);
  const end = Date.parse(`${to}T00:00:00+09:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / DAY_MS);
}

type DueWindow = "d0" | "d1" | "d3";

function dueWindow(days: number | null): DueWindow | null {
  if (days === 0) return "d0";
  if (days === 1) return "d1";
  if (days === 3) return "d3";
  return null;
}

const DUE_PRIORITY: Record<DueWindow, number> = {
  d0: TODAY_ONE_MORE_PRIORITY.taskDue0,
  d1: TODAY_ONE_MORE_PRIORITY.taskDue1,
  d3: TODAY_ONE_MORE_PRIORITY.taskDue3,
};

/** 함께 쓰는 할 일 가운데 열려 있고 마감이 오늘·내일·사흘 뒤인 것. */
export function buildTodayOneTaskDeadlineCandidates(input: {
  actions: readonly AmoraActionItem[];
  stateRevision: number;
  now?: Date;
}): TodayOneCandidate[] {
  if (!Number.isSafeInteger(input.stateRevision) || input.stateRevision < 0) return [];
  const today = ymdInKst(input.now ?? new Date());
  const candidates: TodayOneCandidate[] = [];
  for (const action of input.actions) {
    if (action.status !== "open" || !action.dueDate || !isSafeDisplayText(action.title, 120)) continue;
    const window = dueWindow(daysBetweenYmd(today, action.dueDate));
    const due = ymdParts(action.dueDate);
    if (!window || !due) continue;
    candidates.push({
      kind: "task_deadline",
      sourceKey: `task:${sha256(action.id).slice(0, 24)}:${window}`,
      sourceStateDigest: sha256(JSON.stringify({
        version: 1,
        window,
        id: action.id,
        title: action.title,
        dueDate: action.dueDate,
        status: action.status,
      })),
      sourceRevision: input.stateRevision,
      whyNow: TODAY_ONE_MORE_COPY.task.whyNow[window],
      confirmed: [
        TODAY_ONE_MORE_COPY.task.confirmedTitle(action.title),
        TODAY_ONE_MORE_COPY.task.confirmedDue(due.month, due.day),
      ],
      unknown: [TODAY_ONE_MORE_COPY.task.unknown],
      nextAction: nextAction("task_deadline"),
      impact: TODAY_ONE_MORE_COPY.task.impact,
      choices: choicesFor("task_deadline"),
      priority: DUE_PRIORITY[window],
    });
    if (candidates.length >= MAX_PER_KIND) break;
  }
  return candidates;
}

/**
 * 홈의 "두 분이 정할 것" 가운데 문의에서 생긴 줄(`inquiryDecisions`). 홈과 같은 줄을 같은 글로 보인다.
 * 할 일 줄은 마감이 있을 때만 `task_deadline` 이 따로 고른다.
 */
export function buildTodayOneDecisionCandidates(input: {
  decisions: readonly DecisionItem[];
  stateRevision: number;
}): TodayOneCandidate[] {
  if (!Number.isSafeInteger(input.stateRevision) || input.stateRevision < 0) return [];
  const candidates: TodayOneCandidate[] = [];
  for (const decision of input.decisions) {
    if (!isSafeDisplayText(decision.id, 200) || !isSafeDisplayText(decision.title, 180)) continue;
    const href = decision.target === "letter" ? "/halls/letter" : decision.target === "status" ? "/halls/consultation" : null;
    if (!href) continue;
    const confirmed = [decision.title];
    if (isSafeDisplayText(decision.sub, 180)) confirmed.push(decision.sub);
    candidates.push({
      kind: "couple_decision",
      sourceKey: `decision:${sha256(decision.id).slice(0, 24)}`,
      sourceStateDigest: sha256(JSON.stringify({
        version: 1,
        id: decision.id,
        title: decision.title,
        sub: decision.sub ?? null,
        target: decision.target,
      })),
      sourceRevision: input.stateRevision,
      whyNow: TODAY_ONE_MORE_COPY.decision.whyNow,
      confirmed,
      unknown: [],
      nextAction: nextAction("couple_decision", href),
      impact: TODAY_ONE_MORE_COPY.decision.impact,
      choices: choicesFor("couple_decision"),
      priority: TODAY_ONE_MORE_PRIORITY.decision,
    });
    if (candidates.length >= MAX_PER_KIND) break;
  }
  return candidates;
}

/**
 * 홀마다 가장 최근 문의만 본다. 보낸 지 48시간이 넘었고 그 문의에 적힌 답이 없으면 고른다.
 * 거둬들인 문의(탈퇴)와 지운 문의는 다룰 수 없어 뺀다.
 */
export function buildTodayOneInquiryWaitingCandidates(input: {
  timeline: InquiryTimeline;
  stateRevision: number;
  now?: Date;
}): TodayOneCandidate[] {
  if (!Number.isSafeInteger(input.stateRevision) || input.stateRevision < 0) return [];
  const nowMs = (input.now ?? new Date()).getTime();
  const latestByHall = new Map<string, InquiryTimeline["dispatches"][number]>();
  for (const dispatch of [...input.timeline.dispatches].sort((a, b) => Date.parse(b.queuedAt) - Date.parse(a.queuedAt))) {
    if (dispatch.status === "withdrawn" || latestByHall.has(dispatch.hallId)) continue;
    latestByHall.set(dispatch.hallId, dispatch);
  }
  const candidates: TodayOneCandidate[] = [];
  for (const dispatch of latestByHall.values()) {
    if (dispatch.status !== "sent" || dispatch.redacted || !dispatch.sentAt) continue;
    const sentMs = Date.parse(dispatch.sentAt);
    if (!Number.isFinite(sentMs) || nowMs - sentMs < INQUIRY_WAITING_HOURS * HOUR_MS) continue;
    if (input.timeline.replies.some((reply) => reply.dispatchId === dispatch.id)) continue;
    if (!isSafeDisplayText(dispatch.recipientName, 120)) continue;
    const sent = ymdParts(ymdInKst(new Date(sentMs)));
    if (!sent) continue;
    candidates.push({
      kind: "inquiry_waiting",
      sourceKey: `inquiry:${sha256(dispatch.id).slice(0, 24)}`,
      sourceStateDigest: sha256(JSON.stringify({
        version: 1,
        id: dispatch.id,
        hallId: dispatch.hallId,
        sentAt: dispatch.sentAt,
        recipientName: dispatch.recipientName,
      })),
      sourceRevision: input.stateRevision,
      whyNow: TODAY_ONE_MORE_COPY.inquiry.whyNow,
      confirmed: [
        TODAY_ONE_MORE_COPY.inquiry.confirmedHall(dispatch.recipientName),
        TODAY_ONE_MORE_COPY.inquiry.confirmedSent(sent.month, sent.day),
      ],
      unknown: [TODAY_ONE_MORE_COPY.inquiry.unknown],
      nextAction: nextAction("inquiry_waiting"),
      impact: TODAY_ONE_MORE_COPY.inquiry.impact,
      choices: choicesFor("inquiry_waiting"),
      priority: TODAY_ONE_MORE_PRIORITY.inquiryWaiting,
    });
    if (candidates.length >= MAX_PER_KIND) break;
  }
  return candidates;
}

/**
 * 다른 갈래가 자기 고르기를 더하는 자리(25장 6절). 갈래 4(맡은 일)가 "끝난 맡은 일"을 여기에 더한다.
 * 그 갈래는 공용 계약(`TODAY_ONE_CARE_KINDS`·`TODAY_ONE_CARE_NEXT_ACTIONS`)과 DB 검사
 * (`amora_today_one_presentation_is_valid`, `amora_today_one_signals_kind_check`)에 자기 종류를 같이 더해야 한다.
 */
export type TodayOneExtraSource = {
  name: string;
  build: (input: { coupleId: string; userId: string; stateRevision: number; now: Date }) =>
    Promise<TodayOneCandidate[]>;
};

export const TODAY_ONE_EXTRA_SOURCES: readonly TodayOneExtraSource[] = [];
