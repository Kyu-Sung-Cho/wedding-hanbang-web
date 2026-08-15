import { createHash } from "node:crypto";

import type {
  TodayOneCareCard,
  TodayOneCareChoice,
  TodayOneScheduleCarePayload,
} from "@hanbang/shared";
import { buildDueMomentCells } from "@/lib/amora/momentLoop";
import type { ScheduleEvent } from "@/types/database.types";
import { getEvents, getScheduleEventStatus } from "@/utils/scheduleEvents";

export const MAX_TODAY_ONE_CANDIDATES = 20;

const UNSAFE_DISPLAY_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const DEFAULT_CHOICES: TodayOneCareChoice[] = [
  { action: "open_source", label: "일정 열기" },
  { action: "snooze", label: "나중에" },
  { action: "dismiss", label: "오늘 닫기" },
  { action: "mute_source", label: "내용이 바뀔 때까지 숨기기" },
];

export type TodayOnePresentation = Pick<
  TodayOneCareCard,
  | "kind"
  | "sourceRevision"
  | "sourceKey"
  | "whyNow"
  | "confirmed"
  | "unknown"
  | "nextAction"
  | "impact"
  | "choices"
>;

export type TodayOneCandidate = TodayOnePresentation & {
  sourceStateDigest: string;
  priority: number;
  attentionWindow?: "d3" | "d1" | "dAfter";
  care?: TodayOneScheduleCarePayload;
};

export type TodayOneScheduleCandidate = TodayOneCandidate & {
  sourceEventId: string;
};

export interface BuildTodayOneScheduleCandidatesInput {
  weddingDate?: string | Date | null;
  progress?: Record<string, unknown> | null;
  stateRevision: number;
  now?: Date;
}

export type TodayOneExposure = {
  sourceKey: string;
  sourceStateDigest: string;
  claimedForDate: string;
  claimedToday?: boolean;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compareAscii(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function mergeTodayOneCandidates(
  ...groups: ReadonlyArray<ReadonlyArray<TodayOneCandidate>>
): TodayOneCandidate[] {
  return mergeTodayOneCandidatesWithHistory([], ...groups);
}

type ExposureSummary = {
  count: number;
  lastClaimedForDate: string;
  claimedToday: boolean;
};

function exposureKey(sourceKey: string, sourceStateDigest: string): string {
  return `${sourceKey}\u0000${sourceStateDigest}`;
}

function summarizeExposures(
  history: ReadonlyArray<TodayOneExposure>,
): Map<string, ExposureSummary> {
  const summaries = new Map<string, ExposureSummary>();
  for (const exposure of history) {
    const key = exposureKey(exposure.sourceKey, exposure.sourceStateDigest);
    const current = summaries.get(key);
    summaries.set(key, {
      count: (current?.count ?? 0) + 1,
      lastClaimedForDate: !current
        || compareAscii(current.lastClaimedForDate, exposure.claimedForDate) < 0
        ? exposure.claimedForDate
        : current.lastClaimedForDate,
      claimedToday: (current?.claimedToday ?? false) || exposure.claimedToday === true,
    });
  }
  return summaries;
}

/**
 * Keeps the one-card-per-day choice deterministic while preventing a budget
 * incident that was already shown from consuming a newly due D-1 moment.
 * Within the budget domain, unseen episodes come first and repeated episodes
 * rotate from least recently shown to most recently shown.
 */
export function mergeTodayOneCandidatesWithHistory(
  history: ReadonlyArray<TodayOneExposure>,
  ...groups: ReadonlyArray<ReadonlyArray<TodayOneCandidate>>
): TodayOneCandidate[] {
  const exposureSummaries = summarizeExposures(history);
  const sourcesClaimedToday = new Set(
    history
      .filter(({ claimedToday }) => claimedToday === true)
      .map(({ sourceKey }) => sourceKey),
  );
  const hasPriorBudgetExposure = history.some(({ sourceKey }) => (
    sourceKey.startsWith("budget:")
  ));
  const summaryFor = (candidate: TodayOneCandidate) => exposureSummaries.get(
    exposureKey(candidate.sourceKey, candidate.sourceStateDigest),
  );
  const isUnseenD1 = (candidate: TodayOneCandidate) => (
    candidate.kind === "schedule_moment"
    && candidate.attentionWindow === "d1"
    && summaryFor(candidate) === undefined
  );

  return groups
    .flatMap((group) => group)
    .sort((left, right) => {
      const leftSummary = summaryFor(left);
      const rightSummary = summaryFor(right);
      // A same-day source may acquire a new semantic digest after the user
      // edits its underlying schedule/budget record. Keep that source first so
      // the database can update the already-claimed card instead of trying an
      // unrelated signal and returning the daily-limit state.
      const leftSourceClaimedToday = sourcesClaimedToday.has(left.sourceKey);
      const rightSourceClaimedToday = sourcesClaimedToday.has(right.sourceKey);
      if (leftSourceClaimedToday !== rightSourceClaimedToday) {
        return leftSourceClaimedToday ? -1 : 1;
      }
      const leftD1Relief = hasPriorBudgetExposure && isUnseenD1(left);
      const rightD1Relief = hasPriorBudgetExposure && isUnseenD1(right);
      if (leftD1Relief !== rightD1Relief) return leftD1Relief ? -1 : 1;

      if (left.kind === "budget_guardrail" && right.kind === "budget_guardrail") {
        if ((leftSummary === undefined) !== (rightSummary === undefined)) {
          return leftSummary === undefined ? -1 : 1;
        }
        if (leftSummary && rightSummary) {
          const oldestFirst = compareAscii(
            leftSummary.lastClaimedForDate,
            rightSummary.lastClaimedForDate,
          );
          if (oldestFirst !== 0) return oldestFirst;
          if (leftSummary.count !== rightSummary.count) {
            return leftSummary.count - rightSummary.count;
          }
        }
      }

      return right.priority - left.priority
        || compareAscii(left.sourceKey, right.sourceKey)
        || compareAscii(left.sourceStateDigest, right.sourceStateDigest);
    })
    .slice(0, MAX_TODAY_ONE_CANDIDATES);
}

function isSafeDisplayText(value: string, maxLength: number): boolean {
  return value.trim().length > 0
    && value.length <= maxLength
    && !UNSAFE_DISPLAY_RE.test(value);
}

function semanticEventSnapshot(event: ScheduleEvent): Record<string, unknown> {
  return {
    id: event.id,
    date: event.date,
    time: event.time ?? null,
    title: event.title,
    memo: event.memo ?? null,
    categoryKey: event.categoryKey ?? null,
    sourceKey: event.sourceKey ?? null,
    momentType: event.momentType ?? null,
    status: event.status ?? "planned",
    completionCriteria: event.completionCriteria ?? null,
    assignee: event.assignee ?? null,
  };
}

function whyNow(cellKind: "d3" | "d1" | "dAfter", title: string): string {
  if (cellKind === "d3") return `3일 뒤 ${title} 일정이 있어요.`;
  if (cellKind === "d1") return `내일 ${title} 일정이 있어요.`;
  return `어제 ${title} 일정이 있었어요. 필요한 기록만 확인해 보세요.`;
}

function eventDateLine(event: ScheduleEvent): string {
  return `날짜: ${event.date}${event.time ? ` ${event.time}` : ""}`;
}

function sourceWindowKey(cellKind: "d3" | "d1" | "dAfter"): string {
  return cellKind === "dAfter" ? "d_after" : cellKind;
}

/**
 * Compile only confirmed schedule facts into in-app candidates. This function
 * intentionally does not read budget/spend fields, call AI, or perform I/O.
 */
export function buildTodayOneScheduleCandidates({
  weddingDate,
  progress = {},
  stateRevision,
  now,
}: BuildTodayOneScheduleCandidatesInput): TodayOneScheduleCandidate[] {
  if (!Number.isSafeInteger(stateRevision) || stateRevision < 0) return [];

  const safeProgress = progress ?? {};
  const events = getEvents(safeProgress);
  const eventsById = new Map<string, ScheduleEvent>();
  const eventIdCounts = new Map<string, number>();
  for (const event of events) {
    eventIdCounts.set(event.id, (eventIdCounts.get(event.id) ?? 0) + 1);
    eventsById.set(event.id, event);
  }

  const dueCells = buildDueMomentCells({ weddingDate, progress: safeProgress, now });
  const candidates: TodayOneScheduleCandidate[] = [];
  for (const cell of dueCells) {
    if (!cell.sourceEventId || eventIdCounts.get(cell.sourceEventId) !== 1) continue;
    const event = eventsById.get(cell.sourceEventId);
    const eventStatus = event ? getScheduleEventStatus(event) : null;
    if (
      !event
      || (
        eventStatus !== "planned"
        && !(eventStatus === "completed" && cell.cellKind === "dAfter")
      )
      || !isSafeDisplayText(event.title, 120)
    ) continue;

    const sourceKey = `schedule:${sha256(event.id).slice(0, 24)}:${sourceWindowKey(cell.cellKind)}`;
    const sourceStateDigest = sha256(JSON.stringify({
      version: 1,
      cellKind: cell.cellKind,
      momentDate: cell.momentDate,
      event: semanticEventSnapshot(event),
      ...(cell.care ? { care: cell.care } : {}),
    }));

    candidates.push({
      sourceEventId: event.id,
      sourceKey,
      sourceStateDigest,
      sourceRevision: stateRevision,
      kind: "schedule_moment",
      whyNow: whyNow(cell.cellKind, event.title),
      confirmed: [`일정: ${event.title}`, eventDateLine(event)],
      unknown: ["업체·가족의 최신 변경 여부는 현재 일정 기록만으로 확인되지 않았어요."],
      nextAction: { label: "일정 열기", href: "/schedule" },
      impact: "확인만 하며 실제 일정이나 외부 서비스는 바꾸지 않아요.",
      choices: DEFAULT_CHOICES.map((choice) => ({ ...choice })),
      priority: cell.priority,
      attentionWindow: cell.cellKind,
      ...(cell.care ? { care: cell.care } : {}),
    });
    if (candidates.length >= MAX_TODAY_ONE_CANDIDATES) break;
  }

  return candidates;
}
