import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import type { AmoraActionItem, AmoraActionSource, AmoraActionStatus } from "./actions";
import { weddingPath } from "@/lib/weddingPaths";
import { compareChatTimestamps } from "@hanbang/shared";
import { z } from "zod";
import { preparationDecisionFacts, preparationScheduleRecordLabel } from "./preparationDecisionDisplay";

export const DECISION_COLUMNS = [
  { status: "confirmed", label: "확정", rule: "결정·예약·완료와 일정 변경 이력이에요. 현재 일정 상태는 일정에서 확인해 주세요.", dot: "bg-[var(--amora-sage)]" },
  { status: "considering", label: "논의 중", rule: "고려 중으로 저장된 기록이에요. 합의나 반영 완료를 뜻하지 않아요.", dot: "bg-[var(--amora-rose)]" },
  { status: "exploring", label: "미정", rule: "탐색 중으로 저장된 기록이에요. 아직 결정하지 않았어요.", dot: "bg-[var(--amora-danger)]" },
] as const;
export type DecisionColumn = typeof DECISION_COLUMNS[number]["status"];
export type PreparationDecision = {
  id: string; category: string; title: string; detail: string | null; createdAt: string;
  status: DecisionColumn; stateLabel: string; source: string; displayTitle?: string;
  /** 같은 값을 바꾼 기록끼리 묶는 열쇠. 표시에서만 쓴다. */
  valueSlots?: string[];
  /** 저장 분류 밖에서도 이 기록을 보여줄 분야(예산 결정의 예산·해당 분야). */
  relatedCategories?: string[];
  /** 체크리스트·진행 상태만 저장한 기록의 바뀐 분야 수. */
  routineChanges?: number;
};
/**
 * 같은 값을 다시 바꾼 기록이 있을 때만 붙는다. previous는 나중 기록이 같은 값을 모두 다시 바꾼 기록이다.
 * latest는 불러온 기록 중 그 값을 마지막으로 바꾼 기록일 뿐 현재 값을 뜻하지 않는다.
 * 분야 삭제나 아모라 초기화·삭제는 값 슬롯이 있는 기록을 남기지 않으므로 지금 값은 예산 화면이 기준이다.
 */
export type ArrangedPreparationDecision = PreparationDecision & { valueState?: "latest" | "previous" };
export type RoutineProgressDay = { key: string; label: string; records: number; changes: number };
export type DecisionCursor = { id: string; createdAt: string };
export const DECISION_PAGE_SIZE = 30;
const dateSchema = z.string().datetime({ offset: true });
const decisionSchema = z.object({
  id: z.string().uuid(), couple_id: z.string().uuid(), visibility: z.literal("shared"),
  category: z.string().nullable(), title: z.string().trim().min(1), reasoning: z.string().nullable(),
  decision_type: z.enum(["exploring", "considering", "decided", "scheduled", "booked", "completed"]),
  source: z.string().nullable(), created_at: dateSchema, superseded_at: z.null(), memory_key: z.null(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  chosen_value: z.unknown().optional(),
});
const DECISION_STATE_LABELS = { exploring: "탐색 중", considering: "고려 중", decided: "결정 기록", booked: "예약 기록", completed: "완료 기록" };

/** 공유 제품 결정만 보여준다. 추출 기억은 명시적 결정으로 승격하지 않는다. */
export function parsePreparationDecisions(value: unknown, coupleId: string, cursor: DecisionCursor | null = null) {
  const rows = z.array(decisionSchema).max(DECISION_PAGE_SIZE + 1).parse(value);
  const ids = new Set<string>();
  let previous = cursor;
  for (const row of rows) {
    if (row.couple_id !== coupleId || row.metadata?.extracted_by != null || ids.has(row.id)) throw new Error("DECISION_SCOPE_MISMATCH");
    if (previous) {
      const order = compareChatTimestamps(row.created_at, previous.createdAt);
      if (order === null || order > 0 || (order === 0 && row.id >= previous.id)) throw new Error("DECISION_PAGE_ORDER");
    }
    ids.add(row.id);
    previous = { id: row.id, createdAt: row.created_at };
  }
  const visible = rows.slice(0, DECISION_PAGE_SIZE);
  return {
    records: visible.map((row): PreparationDecision => {
      const facts = preparationDecisionFacts(row);
      return {
        id: row.id, category: row.category ?? "", title: row.title, detail: row.reasoning || null,
        createdAt: row.created_at, source: row.source ?? "",
        status: row.decision_type === "exploring" ? "exploring" : row.decision_type === "considering" ? "considering" : "confirmed",
        stateLabel: row.decision_type === "scheduled" ? preparationScheduleRecordLabel(row) : DECISION_STATE_LABELS[row.decision_type],
        ...(facts.displayTitle ? { displayTitle: facts.displayTitle } : {}),
        ...(facts.valueSlots.length ? { valueSlots: facts.valueSlots } : {}),
        ...(facts.relatedCategories.length ? { relatedCategories: facts.relatedCategories } : {}),
        ...(facts.routineChanges !== null ? { routineChanges: facts.routineChanges } : {}),
      };
    }),
    nextCursor: rows.length > DECISION_PAGE_SIZE ? { id: visible.at(-1)!.id, createdAt: visible.at(-1)!.created_at } : null,
  };
}

const seoulDay = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" });

/**
 * 불러온 기록을 화면용으로 정리한다. DB 행은 바꾸지 않는다.
 * - 같은 값(예: 드레스·예식 정장 예산)을 나중 기록이 모두 다시 바꿨으면 앞 기록을 이전 값으로 표시한다.
 *   기록은 최신순으로 불러오므로, 더 최근 기록은 항상 먼저 불러온 상태다.
 * - 체크리스트·진행 상태만 저장한 기록은 결정 목록에서 빼고 날짜별 개수로 접는다.
 */
export function arrangePreparationDecisions(records: PreparationDecision[]) {
  const newestFirst = [...records].sort((left, right) =>
    (compareChatTimestamps(right.createdAt, left.createdAt) ?? 0) || (left.id < right.id ? 1 : left.id > right.id ? -1 : 0));
  const newestBySlot = new Map<string, string>();
  const previous = new Set<string>();
  const latest = new Set<string>();
  for (const row of newestFirst) {
    const slots = row.routineChanges === undefined && row.status === "confirmed" ? row.valueSlots ?? [] : [];
    if (!slots.length) continue;
    if (slots.every(slot => newestBySlot.has(slot))) {
      previous.add(row.id);
      for (const slot of slots) latest.add(newestBySlot.get(slot)!);
    } else for (const slot of slots) if (!newestBySlot.has(slot)) newestBySlot.set(slot, row.id);
  }
  const days = new Map<string, RoutineProgressDay>();
  for (const row of records) {
    if (row.routineChanges === undefined) continue;
    const date = new Date(row.createdAt);
    const key = Number.isNaN(date.getTime()) ? "" : seoulDay.format(date);
    const day = days.get(key) ?? { key, label: preparationDate(row.createdAt) ?? "날짜 확인 필요", records: 0, changes: 0 };
    day.records += 1; day.changes += row.routineChanges;
    days.set(key, day);
  }
  return {
    decisions: records.filter(row => row.routineChanges === undefined).map((row): ArrangedPreparationDecision =>
      previous.has(row.id) ? { ...row, valueState: "previous" } : latest.has(row.id) ? { ...row, valueState: "latest" } : row),
    routineDays: [...days.values()],
    routineCount: records.length - records.filter(row => row.routineChanges === undefined).length,
  };
}

export function decisionCursorFilter(cursor: DecisionCursor) {
  z.string().uuid().parse(cursor.id); dateSchema.parse(cursor.createdAt);
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}

export const PREPARATION_COLUMNS: ReadonlyArray<{ status: AmoraActionStatus; label: string; rule: string; dot: string }> = [
  { status: "done", label: "완료", rule: "완료로 표시한 할 일이에요.", dot: "bg-[var(--amora-sage)]" },
  { status: "open", label: "진행 중", rule: "아직 완료하지 않은 할 일이에요. 준비가 끝나면 완료로 표시해 주세요.", dot: "bg-[var(--amora-rose)]" },
  { status: "dismissed", label: "보류·숨김", rule: "숨겨 둔 할 일이에요. 필요할 때 다시 진행 중으로 옮길 수 있어요.", dot: "bg-[var(--amora-danger)]" },
];

export const PREPARATION_SOURCES: Record<AmoraActionSource, string> = {
  chat: "대화에서 추가된 할 일", quote: "견적 확인에서 추가된 할 일", schedule: "일정에서 추가된 할 일",
  budget: "예산에서 추가된 할 일", guardrail: "준비 점검에서 추가된 할 일", manual: "직접 추가한 할 일",
};

/** 명시적인 체험 모드에서만 사용한다. API 실패의 대체 데이터가 아니다. */
export const DEMO_PREPARATION_ACTIONS: AmoraActionItem[] = ([
  { id: "demo-board-budget", title: "예식장 예산 상한을 정리하기", description: "식대와 대관료를 예산표에 나눠 적었어요.", status: "done", categoryKey: "venue", source: "budget", href: "/budget" },
  { id: "demo-board-meeting", title: "양쪽 부모님 첫 식사 장소 확인하기", description: "참석 인원과 이동 거리를 확인하고 장소를 정리했어요.", status: "done", categoryKey: "meeting", source: "manual", href: "/checklist?category=meeting" },
  { id: "demo-board-makeup", title: "이른 시간·출장 추가 비용 확인하기", description: "업체에 서면으로 물어보고, 답변이 오면 다시 살펴보기로 했어요.", status: "open", categoryKey: "makeup", source: "chat", href: "/chat" },
  { id: "demo-board-unsorted", title: "친구에게 사회를 부탁할지 이야기하기", description: "부탁할 사람과 진행 방식을 먼저 맞춰 보려고 해요.", status: "open", source: "chat", href: "/chat" },
  { id: "demo-board-honeymoon", title: "신혼여행 후보와 예산 범위 정리하기", description: "예식장 일정이 정해진 뒤 다시 이야기하기로 했어요.", status: "dismissed", categoryKey: "honeymoon", source: "manual", href: "/checklist?category=honeymoon" },
  { id: "demo-board-invitation", title: "종이 초대장을 보낼 분들 정리하기", description: "하객 명단이 정리되면 다시 꺼내 볼 할 일이에요.", status: "dismissed", categoryKey: "invitation", source: "manual", href: "/checklist?category=invitation" },
] satisfies Array<Omit<AmoraActionItem, "priority" | "createdAt" | "updatedAt">>)
  .map((action) => ({ ...action, priority: "medium", createdAt: "2026-08-29T00:00:00Z", updatedAt: "2026-08-29T00:00:00Z" }));

export function preparationCategory(key: string | undefined) {
  return CATEGORY_CHECKLISTS.find((category) => category.key === key);
}

export function filterPreparationActions(actions: AmoraActionItem[], category: string, query: string) {
  const needle = query.trim().toLocaleLowerCase("ko");
  return actions.filter((action) => {
    const template = preparationCategory(action.categoryKey);
    if (category === "unsorted" ? !!template : category !== "all" && template?.key !== category) return false;
    return !needle || [action.title, action.description, template?.label].some((text) => text?.toLocaleLowerCase("ko").includes(needle));
  });
}

export function preparationActionHref(href: string | undefined): string | null {
  // 레거시 기록도 렌더링하므로 API의 저장 시 검증만 믿지 않는다.
  if (!href || !href.startsWith("/") || href.startsWith("//") || /[\\\u0000-\u0020]/u.test(href)) return null;
  return weddingPath(href);
}

export function preparationDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }).format(date);
}
