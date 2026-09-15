import { PLANNING_CATEGORY_LABELS } from "@hanbang/shared/constants";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { formatWon } from "@/lib/formatWon";

type DecisionDisplayInput = {
  title: string;
  source: string | null;
  decision_type: string;
  metadata: Record<string, unknown> | null;
  chosen_value?: unknown;
};
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** 저장된 작업 종류와 전후 상태로 당시의 이력만 표시한다. 제목에서 현재 상태를 추정하지 않는다. */
export function preparationScheduleRecordLabel(row: DecisionDisplayInput): string {
  const value = object(row.chosen_value);
  const metadata = row.metadata;
  if (row.source !== "schedule" || !metadata || value?.schemaVersion !== 1) return "일정 기록";
  const kind = metadata.origin === "couple_plan_change_request" ? value.mutationKind
    : metadata.origin === "amora_shared_action" ? value.operation : null;
  if ((kind !== "cancel" && kind !== "restore") || metadata.mutationKind !== kind) return "일정 기록";
  const before = object(value.before); const after = object(value.after);
  if (typeof value.eventId !== "string" || !value.eventId || before?.id !== value.eventId || after?.id !== value.eventId
    || (metadata.eventId !== undefined && metadata.eventId !== value.eventId)) return "일정 기록";
  if (kind === "cancel" && (before.status === "planned" || before.status === "completed") && after.status === "cancelled") return "일정 취소 기록";
  if (kind === "restore" && before.status === "cancelled" && after.status === "planned") return "일정 복원 기록";
  return "일정 기록";
}

const PAYER_LABELS: Readonly<Record<string, string>> = {
  couple: "두 사람", bride_parents: "예비 신부 가족", groom_parents: "예비 신랑 가족",
  both_parents: "두 가족", bride: "예비 신부", groom: "예비 신랑",
};
const FIELD_SLOTS: Readonly<Record<string, string>> = { 예산: "budget", 지출: "spent", 부담: "payer" };
const CHECKLIST_KEYS: ReadonlySet<string> = new Set(CATEGORY_CHECKLISTS.map(item => item.key));
const RAW_AMOUNT = /^(?:미정|(?:0|[1-9][0-9]*)원)$/u;

function won(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
/** DB가 요약에 적은 원문 금액. 검증에만 쓰고 화면에는 {@link displayAmount}로 바꿔 보여준다. */
function rawAmount(value: unknown): string | null {
  return value === null ? "미정" : won(value) ? `${value}원` : null;
}
/** 원문 "500000원"을 예산 화면과 같은 "50만원"으로 적는다. 검증된 원문만 받는다. */
function displayAmount(raw: string): string {
  if (raw === "미정") return raw;
  const amount = Number(raw.slice(0, -1));
  return won(amount) ? formatWon(amount) : raw;
}
function categoryLabel(key: string, storedLabel: string) {
  // 고정 분야는 예산·체크리스트 화면과 같은 이름을 쓴다. 직접 만든 항목만 저장된 이름을 쓴다.
  return Object.hasOwn(PLANNING_CATEGORY_LABELS, key) ? PLANNING_CATEGORY_LABELS[key as keyof typeof PLANNING_CATEGORY_LABELS] : storedLabel;
}

export type PreparationDecisionFacts = {
  /** 저장 원문과 다를 때만 채운다. */
  displayTitle: string | null;
  /** 같은 값을 바꾼 기록끼리 묶는 열쇠. 예: budget:total, budget:dress, spent:venue */
  valueSlots: string[];
  /** 저장 분류 말고도 이 기록을 보여줄 분야. 예산 결정이면 예산과 해당 체크리스트 분야. */
  relatedCategories: string[];
  /** 체크리스트·진행 상태만 저장한 기록이면 바뀐 분야 수. 결정이 아니므로 목록에서 접는다. */
  routineChanges: number | null;
};

type ManualFacts = { title: string; valueSlots: string[]; relatedCategories: string[] };

function patchEntry(patch: Record<string, unknown>, name: string) {
  if (Object.hasOwn(PLANNING_CATEGORY_LABELS, name)) {
    const entry = object(patch[name]);
    if (!entry || entry.category !== name || Object.hasOwn(entry, "label") || Object.hasOwn(entry, "name")) return null;
    return { key: name, entry, label: categoryLabel(name, name) };
  }
  // 이름이 붙은 항목은 DB가 저장된 이름으로 요약한다. 같은 이름이 하나뿐일 때만 연결한다.
  const matches = Object.entries(patch).filter(([key, value]) => {
    const entry = object(value);
    return !key.startsWith("__") && !!entry && entry.label === name && (entry.category === undefined || entry.category === key);
  });
  if (matches.length !== 1) return null;
  const [key, value] = matches[0];
  return { key, entry: object(value)!, label: categoryLabel(key, name) };
}

/** 생성된 예산 요약 전체와 구조화된 후값이 맞을 때만 이름과 금액을 읽기 쉽게 바꾼다. 원문은 변경하지 않는다. */
function manualBudgetFacts(row: DecisionDisplayInput): ManualFacts | null {
  const value = object(row.chosen_value);
  if (row.source !== "manual" || row.decision_type !== "decided" || row.metadata?.origin !== "couple_plan_change_request"
    || value?.schemaVersion !== 1) return null;
  const changes = object(value.changes);
  const patch = object(changes?.progress_patch);
  if (!changes || (!patch && !Object.hasOwn(changes, "total_budget"))) return null;
  const parts: string[] = [];
  const slots = new Set<string>();
  const related = new Set<string>();
  for (const segment of row.title.split(" · ")) {
    const total = /^총예산: (.+) → (.+)$/u.exec(segment);
    if (total) {
      if (!Object.hasOwn(changes, "total_budget") || total[2] !== rawAmount(changes.total_budget) || !RAW_AMOUNT.test(total[1])) return null;
      parts.push(`총예산: ${displayAmount(total[1])} → ${displayAmount(total[2])}`);
      slots.add("budget:total"); related.add("budget");
      continue;
    }
    const match = /^(.+) (예산|지출|부담): (.+) → (.+)$/u.exec(segment);
    if (!match || !patch) return null;
    const [, name, field, before, after] = match;
    const target = patchEntry(patch, name);
    if (!target) return null;
    const { key, entry, label } = target;
    if (field === "부담") {
      const expected = entry.payer === null ? "미정" : typeof entry.payer === "string" && Object.hasOwn(PAYER_LABELS, entry.payer) ? PAYER_LABELS[entry.payer] : null;
      if (!expected || after !== expected || (before !== "미정" && !Object.values(PAYER_LABELS).includes(before))) return null;
      parts.push(`${label} ${field}: ${before} → ${after}`);
    } else {
      if (after !== rawAmount(entry[field === "예산" ? "budget" : "spent"]) || !RAW_AMOUNT.test(before)) return null;
      parts.push(`${label} ${field}: ${displayAmount(before)} → ${displayAmount(after)}`);
    }
    slots.add(`${FIELD_SLOTS[field]}:${key}`); related.add("budget");
    if (CHECKLIST_KEYS.has(key)) related.add(key);
  }
  return { title: parts.join(" · "), valueSlots: [...slots], relatedCategories: [...related] };
}

/** 기존 호출부 호환용. 검증된 수동 예산 요약의 표시 제목만 돌려준다. */
export function preparationLegacyBudgetTitle(row: DecisionDisplayInput): string | null {
  return manualBudgetFacts(row)?.title ?? null;
}

/** 아모라 확인 카드로 반영한 예산 기록. 저장된 전후 금액이 제목·후값과 맞을 때만 전후를 보여준다. */
function amoraBudgetFacts(row: DecisionDisplayInput): PreparationDecisionFacts | null {
  const value = object(row.chosen_value);
  const delta = object(value?.budgetDelta);
  if (row.source !== "budget" || row.decision_type !== "decided" || row.metadata?.origin !== "amora_shared_budget_action"
    || value?.schemaVersion !== 1 || !delta || !Array.isArray(delta.categories)) return null;
  const categories = delta.categories.map(object);
  const valid = categories.every(item => !!item && typeof item.key === "string" && item.key.length > 0 && typeof item.label === "string"
    && item.label.trim().length > 0 && won(item.afterBudget) && (item.beforeBudget === null || won(item.beforeBudget)));
  const total = object(delta.totalBudget);
  if (!valid || (delta.totalBudget !== null && (!total || !won(total.before) || !won(total.after)))) return null;
  const items = categories as Array<{ key: string; label: string; beforeBudget: number | null; afterBudget: number }>;
  const related = (keys: string[]) => keys.filter(key => CHECKLIST_KEYS.has(key));
  if (value.budgetScope === "total") {
    if (!total || items.length || value.amount !== total.after) return null;
    return { displayTitle: `총예산 ${formatWon(total.before as number)} → ${formatWon(total.after as number)}`,
      valueSlots: ["budget:total"], relatedCategories: [], routineChanges: null };
  }
  if (value.budgetScope === "category") {
    const [item] = items;
    if (items.length !== 1 || total || value.categoryKey !== item.key || value.amount !== item.afterBudget) return null;
    return { displayTitle: `${categoryLabel(item.key, item.label.trim())} 예산 ${item.beforeBudget === null ? "미정" : formatWon(item.beforeBudget)} → ${formatWon(item.afterBudget)}`,
      valueSlots: [`budget:${item.key}`], relatedCategories: related([item.key]), routineChanges: null };
  }
  if (value.budgetScope === "allocation") {
    const match = /^총예산 ((?:0|[1-9][0-9]{0,2}(?:,[0-9]{3})*))원 기준 예산 배분 반영$/u.exec(row.title);
    const amount = match ? Number(match[1].replaceAll(",", "")) : NaN;
    if (!won(amount) || (total && total.after !== amount)) return null;
    // 총예산이 그대로면 DB는 totalBudget을 null로 남긴다. 그때는 총예산 값을 바꾼 기록이 아니므로
    // 앞선 총예산 변경을 이전 값으로 접지 않도록 budget:total을 넣지 않는다.
    return { displayTitle: `총예산 ${formatWon(amount)} 기준 예산 배분 반영`,
      valueSlots: [...(total ? ["budget:total"] : []), ...items.map(item => `budget:${item.key}`)], relatedCategories: related(items.map(item => item.key)), routineChanges: null };
  }
  return null;
}

/**
 * 체크리스트 체크·진행 상태만 저장한 기록인지 본다.
 * 예산·지출·분담·총예산·예식일·예식장·일정이 바뀌면 DB가 "진행 상황: N개 수정" 대신
 * 값을 적은 요약을 만든다. 그래서 이 제목과 progress_patch만 있는 변경일 때만 접는다.
 */
function routineProgressChanges(row: DecisionDisplayInput): number | null {
  const value = object(row.chosen_value);
  const match = /^진행 상황: ([1-9][0-9]*)개 수정$/u.exec(row.title);
  if (!match || row.source !== "manual" || row.decision_type !== "decided" || row.metadata?.origin !== "couple_plan_change_request"
    || value?.schemaVersion !== 1) return null;
  const changes = object(value.changes);
  const patch = object(changes?.progress_patch);
  const removed = changes?.progress_remove_keys;
  if (!changes || !patch || Object.keys(changes).some(key => key !== "progress_patch" && key !== "progress_remove_keys")
    || (removed !== undefined && (!Array.isArray(removed) || removed.length > 0))) return null;
  const entries = Object.entries(patch);
  if (entries.length !== Number(match[1]) || entries.some(([key, item]) => {
    const entry = object(item);
    return key.startsWith("__") || !entry || (!Array.isArray(entry.checklist) && typeof entry.status !== "string");
  })) return null;
  return entries.length;
}

const SCHEDULE_FIELD_LABELS = new Set(["제목", "날짜", "시간", "메모", "분류", "출처 키", "모먼트", "상태", "완료 기준", "담당", "취소 사유"]);
/** 일정 요약의 "시간: 없음 → 없음"처럼 바뀌지 않은 조각을 뺀다. 같은 값이 남아 있으면 "날짜: 2027-05-01"로 줄인다. */
function withoutUnchangedScheduleSegments(title: string) {
  const segments = title.split(" · ");
  if (!/^일정 (?:추가|수정|취소|복원): /u.test(segments[0])) return title;
  const kept = segments.flatMap((segment, index) => {
    const match = index === 0 ? null : /^([^:]+): (.+) → (.+)$/u.exec(segment);
    if (!match || !SCHEDULE_FIELD_LABELS.has(match[1]) || match[2] !== match[3]) return [segment];
    return match[2] === "없음" || match[2] === "미정" ? [] : [`${match[1]}: ${match[2]}`];
  });
  return kept.join(" · ");
}

/** 표시용 사실만 만든다. 저장된 행과 원문 제목은 바꾸지 않는다. */
export function preparationDecisionFacts(row: DecisionDisplayInput): PreparationDecisionFacts {
  const amora = amoraBudgetFacts(row);
  if (amora) return amora;
  const routine = routineProgressChanges(row);
  if (routine !== null) return { displayTitle: null, valueSlots: [], relatedCategories: [], routineChanges: routine };
  const manual = manualBudgetFacts(row);
  const title = manual?.title
    ?? (row.metadata?.origin === "couple_plan_change_request" ? withoutUnchangedScheduleSegments(row.title) : row.title);
  return {
    displayTitle: title !== row.title ? title : null,
    valueSlots: manual?.valueSlots ?? [], relatedCategories: manual?.relatedCategories ?? [], routineChanges: null,
  };
}
