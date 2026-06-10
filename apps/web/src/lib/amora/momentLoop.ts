import { MOMENTS, WEDDING_RELATIVE_MOMENTS, type MomentCell, type MomentDefinition, type MomentType } from "@/constants/moments";
import { getEvents } from "@/utils/scheduleEvents";
import { ymdInKst, kstMidnightFromYmd, addDaysUtc } from "@/lib/utils/kstDate";
import type { ScheduleEvent } from "@/types/database.types";

/**
 * 모멘트 루프 엔진 — "전날 밤에 먼저 연락 오는 언니"의 타이밍 계산.
 * 입력: 유저 여정(예식일 + __events) / 출력: 오늘(KST 기준) 발화해야 할 셀 목록.
 *
 * 셀 종류: d3(D-3 챙김) / d1(D-1 출발 전 체크) / dAfter(D+1 안부)
 * 우선순위: d1 > d3 > dAfter, 돈 걸린 모멘트 가중.
 * 모든 날짜 계산은 KST 기준 (서버 UTC 어긋남 방지 — kstDate.ts 참조).
 */

export type MomentCellKind = "d3" | "d1" | "dAfter";

export interface DueMomentCell {
  momentType: MomentType;
  momentLabel: string;
  cellKind: MomentCellKind;
  /** 모멘트 실제 날짜 (YYYY-MM-DD, KST) */
  momentDate: string;
  /** 발화 중복 방지 키: momentType:cellKind:momentDate (같은 타입 복수 이벤트 대응) */
  dedupeKey: string;
  /** 발화 본문 (체크리스트·대본 포함 조립 완료) */
  message: string;
  /** D+1 셀일 때 기억 저장 대상 키 */
  memoryKeys: string[];
  priority: number;
}

const DAY_MS = 1000 * 60 * 60 * 24;

/** "YYYY-MM-DD" 또는 Date → KST 자정 Date. 유효하지 않으면 null */
function toKstMidnight(value: string | Date): Date | null {
  const ymd =
    value instanceof Date
      ? ymdInKst(value)
      : /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? value
        : Number.isNaN(new Date(value).getTime())
          ? null
          : ymdInKst(new Date(value));
  if (!ymd) return null;
  const date = kstMidnightFromYmd(ymd);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 오늘(KST 자정)부터 모멘트 날짜까지 남은 일수 (음수 = 지남) */
function daysUntil(momentKstMidnight: Date, todayKstMidnightDate: Date): number {
  return Math.round((momentKstMidnight.getTime() - todayKstMidnightDate.getTime()) / DAY_MS);
}

function composeMessage(cell: MomentCell): string {
  const parts: string[] = [cell.message];

  if (cell.checklist && cell.checklist.length > 0) {
    parts.push("");
    parts.push(cell.checklist.map((item) => `✓ ${item}`).join("\n"));
  }

  if (cell.script) {
    parts.push("");
    parts.push(`보낼 말이 고민되면 이대로 써도 돼:\n"${cell.script}"`);
  }

  if (cell.question) {
    parts.push("");
    parts.push(cell.question);
  }

  return parts.join("\n");
}

function cellPriority(def: MomentDefinition, cellKind: MomentCellKind): number {
  const base = cellKind === "d1" ? 100 : cellKind === "d3" ? 60 : 40;
  return base + (def.moneyInvolved ? 10 : 0);
}

function buildCell(
  def: MomentDefinition,
  cellKind: MomentCellKind,
  momentDateYmd: string
): DueMomentCell | null {
  const cell = cellKind === "d3" ? def.d3 : cellKind === "d1" ? def.d1 : def.dAfter;
  if (!cell) return null;
  return {
    momentType: def.type,
    momentLabel: def.label,
    cellKind,
    momentDate: momentDateYmd,
    dedupeKey: `${def.type}:${cellKind}:${momentDateYmd}`,
    message: composeMessage(cell),
    memoryKeys: cellKind === "dAfter" ? def.memoryKeys : [],
    priority: cellPriority(def, cellKind),
  };
}

/** 한 모멘트 날짜에 대해 오늘 발화할 셀 결정 (D-3 → d3, D-1 → d1, D+1 → dAfter) */
function dueCellForDate(
  def: MomentDefinition,
  momentDate: Date,
  today: Date
): DueMomentCell | null {
  const days = daysUntil(momentDate, today);
  const ymd = ymdInKst(momentDate);
  if (days === 3) return buildCell(def, "d3", ymd);
  if (days === 1) return buildCell(def, "d1", ymd);
  if (days === -1) return buildCell(def, "dAfter", ymd);
  return null;
}

export interface BuildMomentCellsInput {
  weddingDate?: string | Date | null;
  progress?: Record<string, unknown> | null;
  now?: Date;
}

export function buildDueMomentCells(input: BuildMomentCellsInput): DueMomentCell[] {
  const today = kstMidnightFromYmd(ymdInKst(input.now ?? new Date()));
  const cells: DueMomentCell[] = [];
  const progress = (input.progress ?? {}) as Record<string, unknown>;

  // 1) 유저 일정 입력 기반 모멘트 (momentType 태깅된 이벤트)
  const events: ScheduleEvent[] = getEvents(progress);
  for (const event of events) {
    if (!event.momentType) continue;
    const def = MOMENTS[event.momentType as MomentType];
    if (!def || def.trigger !== "event") continue;
    const momentDate = toKstMidnight(event.date);
    if (!momentDate) continue;
    const due = dueCellForDate(def, momentDate, today);
    if (due) cells.push(due);
  }

  // 2) 예식일 기준 자동 모멘트 (D-30 점검, 본식, 신혼여행, 귀국 인사)
  const weddingDate = input.weddingDate ? toKstMidnight(input.weddingDate) : null;
  if (weddingDate) {
    for (const def of WEDDING_RELATIVE_MOMENTS) {
      const momentDate = addDaysUtc(weddingDate, def.weddingOffsetDays ?? 0);
      const due = dueCellForDate(def, momentDate, today);
      if (due) cells.push(due);
    }
  }

  return cells.sort((a, b) => b.priority - a.priority);
}
