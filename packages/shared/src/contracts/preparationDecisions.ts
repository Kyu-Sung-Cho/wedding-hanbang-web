/**
 * 공동 결정 기록(`decision_nodes`)을 웹 준비 보드와 앱 준비 기록이 **같은 규칙으로** 읽고 보여주는 계약.
 *
 * ## 왜 공용 모듈인가
 *
 * 웹 보드(`AmoraDecisionBoard`)가 먼저 만들어졌고, 행 검사·표시 문장·이전 값 접기·체크 저장 접기가
 * 전부 `apps/web` 안에 있었다. 앱도 같은 기록을 보여줘야 하는데 두 벌로 베끼면 한쪽만 고쳐져
 * 같은 기록이 두 화면에서 다르게 읽힌다(예: 옛 400만원이 한 화면에서만 지금 값처럼 보인다).
 * 그래서 로직과 두 화면이 같이 쓰는 문구를 여기 한 곳에 둔다. 웹은 이 모듈을 다시 내보내거나
 * 얇게 감쌀 뿐이다(`apps/web/src/lib/amora/preparationBoard.ts`, `preparationDecisionCategory.ts`).
 *
 * ## 이 파일이 가져오지 않는 것
 *
 * - `zod`: 웹에만 있는 의존성이다. 검사는 손으로 쓰되 예전 zod 스키마와 **같거나 더 엄격하다**
 *   (`parsePreparationDecisions` 머리말).
 * - 웹 경로(`weddingPath`): 분야 목적지는 경로 없이 종류만 준다. 웹은 `/wedding/...`, 앱은
 *   자기 화면 경로로 바꾼다.
 * - Tailwind 클래스: 상태 점 색은 각 화면이 자기 방식으로 칠한다.
 * - `Intl` 시간대: 한국은 서머타임이 없어 +9시간 고정 오프셋이 언제나 맞다(`utils/kstDay.ts`와 같은
 *   이유). 앱의 Hermes 가 `timeZone: "Asia/Seoul"` 을 어떻게 다루는지에 기대지 않는다.
 */
import { CATEGORY_CHECKLISTS, PLANNING_CATEGORY_LABELS } from "../constants/weddingPlanning";
import { compareChatTimestamps } from "../utils/chatTimestamp";
import { formatWonExact } from "./budgetShare.mjs";

// ── 기본 값 ─────────────────────────────────────────────────────────────

/** 한 번에 보여 주는 결정 수. 읽을 때는 다음 페이지가 있는지 보려고 하나 더(31행) 읽는다. */
export const DECISION_PAGE_SIZE = 30;

/** 결정 기록을 읽을 때 고르는 열. 웹 보드와 앱 준비 기록이 같은 열을 읽는다. */
export const DECISION_SELECT_COLUMNS =
  "id, couple_id, visibility, category, title, reasoning, decision_type, source, created_at, superseded_at, memory_key, metadata, chosen_value";

/** DB `decision_nodes.decision_type` 에 저장되는 여섯 가지. 이 밖의 값은 행 전체를 거부한다. */
export const DECISION_TYPES = ["exploring", "considering", "decided", "scheduled", "booked", "completed"] as const;
export type DecisionType = typeof DECISION_TYPES[number];

/** 화면의 세 갈래. 순서도 화면 순서다. 점 색은 화면이 따로 칠한다. */
export const DECISION_STATUSES = [
  { status: "confirmed", label: "확정", rule: "결정·예약·완료와 일정 변경 이력이에요. 현재 일정 상태는 일정에서 확인해 주세요." },
  { status: "considering", label: "논의 중", rule: "고려 중으로 저장된 기록이에요. 합의나 반영 완료를 뜻하지 않아요." },
  { status: "exploring", label: "미정", rule: "탐색 중으로 저장된 기록이에요. 아직 결정하지 않았어요." },
] as const;
export type DecisionStatus = typeof DECISION_STATUSES[number]["status"];

export type PreparationDecision = {
  id: string; category: string; title: string; detail: string | null; createdAt: string;
  status: DecisionStatus; stateLabel: string; source: string; displayTitle?: string;
  /** 저장 설명(detail)을 화면 이름표·만원 표기로 다시 적은 것. 원문은 detail에 그대로 있다. */
  displayDetail?: string;
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

// ── 두 화면이 같이 쓰는 문구 ─────────────────────────────────────────────

/** 저장한 화면 이름. 모르는 출처는 {@link DECISION_SOURCE_FALLBACK}. */
export const DECISION_SOURCE_LABELS: Readonly<Record<string, string>> = {
  chat: "대화에서 남긴 기록", budget: "예산에서 남긴 기록", schedule: "일정에서 남긴 기록", manual: "직접 남긴 기록",
};
export const DECISION_SOURCE_FALLBACK = "공동 결정 기록";
export function decisionSourceLabel(source: string): string {
  return Object.hasOwn(DECISION_SOURCE_LABELS, source) ? DECISION_SOURCE_LABELS[source] : DECISION_SOURCE_FALLBACK;
}

/** 첫 페이지를 읽지 못했을 때. 보여 줄 기록이 없으므로 목록을 비우고 이 문구와 다시 불러오기를 준다. */
export const DECISION_INITIAL_ERROR = "결정 기록을 확인하지 못했어요. 커플 연결을 확인한 뒤 다시 불러와 주세요.";
/** 이어서 불러오다 실패했을 때. 이미 보이는 기록은 지우지 않는다. */
export const DECISION_MORE_ERROR = "이전 결정을 더 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";

export const DECISION_PREVIOUS_VALUE_LABEL = "이전 값";
export const DECISION_LATEST_VALUE_LABEL = "마지막 기록";
/** 마지막으로 바꾼 기록이라도 지금 값과 다를 수 있다(아모라 초기화·삭제는 결정 기록을 남기지 않는다). */
export const DECISION_CURRENT_VALUE_NOTE = "지금 값은 예산 화면에서 확인해 주세요.";

/** 결정 기록 머리의 요약 두 줄. */
export const DECISION_SUMMARY_LINES = [
  "함께 준비하며 남긴 기록을, 저장 당시의 구분으로 모았어요.",
  "일정 취소·복원 이력도 포함되며, 두 사람이 모두 확인했다는 뜻은 아니에요.",
] as const;

/**
 * 한 상태 칸이 비었을 때의 문구.
 * 더 불러올 기록이 있으면 "없어요"로 끝내지 않는다 — 실제 결정이 다음 페이지에 있을 수 있다.
 */
export function decisionEmptyText({ filtered, hasMore }: { filtered: boolean; hasMore: boolean }): string {
  if (hasMore) return `불러온 기록에는 ${filtered ? "이 조건에 맞는" : "이 상태로 저장된"} 결정이 없어요. 아래에서 이전 결정을 더 불러올 수 있어요.`;
  return filtered ? "이 조건에 맞는 결정이 없어요." : "이 상태로 저장된 결정이 없어요.";
}

// ── 표시 사실 (저장된 행과 원문 제목은 바꾸지 않는다) ─────────────────────

type DecisionDisplayInput = {
  title: string;
  reasoning?: string | null;
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
  return won(amount) ? formatWonExact(amount) : raw;
}
function categoryLabel(key: string, storedLabel: string) {
  // 고정 분야는 예산·체크리스트 화면과 같은 이름을 쓴다. 직접 만든 항목만 저장된 이름을 쓴다.
  return Object.hasOwn(PLANNING_CATEGORY_LABELS, key) ? PLANNING_CATEGORY_LABELS[key as keyof typeof PLANNING_CATEGORY_LABELS] : storedLabel;
}

export type PreparationDecisionFacts = {
  /** 저장 원문과 다를 때만 채운다. */
  displayTitle: string | null;
  /** 저장된 설명(reasoning)을 화면 이름표·만원 표기로 다시 적은 것. 저장값과 맞을 때만 채운다. */
  displayDetail: string | null;
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
    // 분야 표시 없이 상태만 보낸 저장({hanbok: {status}})도 DB는 키 이름으로 요약한다. 다른 분야 표시가 붙었으면 연결하지 않는다.
    if (!entry || (entry.category !== undefined && entry.category !== name) || Object.hasOwn(entry, "label") || Object.hasOwn(entry, "name")) return null;
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
      // 저장값에서 금액을 뺀 경우 DB 요약은 "미정"이다. 금액이 남아 있으면 그 금액과 맞아야 한다.
      const stored = entry[field === "예산" ? "budget" : "spent"];
      if (after !== (stored === undefined ? "미정" : rawAmount(stored)) || !RAW_AMOUNT.test(before)) return null;
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
    return { displayTitle: `총예산 ${formatWonExact(total.before as number)} → ${formatWonExact(total.after as number)}`,
      displayDetail: null, valueSlots: ["budget:total"], relatedCategories: [], routineChanges: null };
  }
  // "예산"을 끼워 이름과 금액을 가른다. 예비비 이름("예비비·사용처 미정")에 이미 "미정"이 있어 붙이면 "미정 미정"으로 읽힌다.
  const change = (item: { key: string; label: string; beforeBudget: number | null; afterBudget: number }) =>
    `${categoryLabel(item.key, item.label.trim())} 예산 ${item.beforeBudget === null ? "미정" : formatWonExact(item.beforeBudget)} → ${formatWonExact(item.afterBudget)}`;
  if (value.budgetScope === "category") {
    const [item] = items;
    if (items.length !== 1 || total || value.categoryKey !== item.key || value.amount !== item.afterBudget) return null;
    return { displayTitle: `${categoryLabel(item.key, item.label.trim())} 예산 ${item.beforeBudget === null ? "미정" : formatWonExact(item.beforeBudget)} → ${formatWonExact(item.afterBudget)}`,
      displayDetail: null, valueSlots: [`budget:${item.key}`], relatedCategories: related([item.key]), routineChanges: null };
  }
  if (value.budgetScope === "allocation") {
    const match = /^총예산 ((?:0|[1-9][0-9]{0,2}(?:,[0-9]{3})*))원 기준 예산 배분 반영$/u.exec(row.title);
    const amount = match ? Number(match[1].replaceAll(",", "")) : NaN;
    if (!won(amount) || (total && total.after !== amount)) return null;
    // DB 영수증 설명은 "승인한 구성원의 예산 배정 변경. <저장 요약>"이고 요약은 AI 이름표·원 단위다(예단 2,000,000원).
    // 설명이 저장 요약과 정확히 같을 때만 구조화된 전후 금액으로 다시 적는다. 사람이 쓴 설명은 건드리지 않는다.
    const prefix = "승인한 구성원의 예산 배정 변경.";
    const summary = typeof value.value === "string" && value.value.startsWith(`${row.title}: `) ? value.value : null;
    const displayDetail = summary && row.reasoning === `${prefix} ${summary}` && items.length > 0
      ? `${prefix} ${[...(total ? [`총예산 ${formatWonExact(total.before as number)} → ${formatWonExact(total.after as number)}`] : []), ...items.map(change)].join(" · ")}`
      : null;
    // 총예산이 그대로면 DB는 totalBudget을 null로 남긴다. 그때는 총예산 값을 바꾼 기록이 아니므로
    // 앞선 총예산 변경을 이전 값으로 접지 않도록 budget:total을 넣지 않는다.
    return { displayTitle: `총예산 ${formatWonExact(amount)} 기준 예산 배분 반영`, displayDetail,
      valueSlots: [...(total ? ["budget:total"] : []), ...items.map(item => `budget:${item.key}`)], relatedCategories: related(items.map(item => item.key)), routineChanges: null };
  }
  return null;
}

/**
 * 체크리스트 체크·진행 상태만 저장한 기록인지 본다.
 * 예산·지출·분담·총예산·예식일·예식장·일정이 바뀌면 DB가 "진행 상황: N개 수정" 대신
 * 값을 적은 요약을 만든다. 그래서 이 제목과 progress_patch만 있는 변경일 때만 접는다.
 */
function routineProgressEntries(row: DecisionDisplayInput): Array<[string, Record<string, unknown>]> | null {
  const value = object(row.chosen_value);
  const match = /^진행 상황: ([1-9][0-9]*)개 수정$/u.exec(row.title);
  // DB는 저장한 화면에 따라 준비 계획(manual·decided) 또는 일정(schedule·scheduled)으로 분류한다.
  // 일정이 실제로 바뀐 저장은 이 제목이 아니라 일정 요약 제목을 받고, __events 키는 아래에서 거른다.
  const recordedAs = (row.source === "manual" && row.decision_type === "decided") || (row.source === "schedule" && row.decision_type === "scheduled");
  if (!match || !recordedAs || row.metadata?.origin !== "couple_plan_change_request"
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
  return entries.map(([key, item]) => [key, object(item)!]);
}

/**
 * "안 해요"로 표시한 저장은 체크와 달리 준비 범위를 정한 선택이라 접지 않고 결정으로 보여준다.
 * DB 제목은 "진행 상황: N개 수정"뿐이라 무엇을 뺐는지 저장된 patch에서 이름을 읽어 적는다.
 */
function notApplicableTitle(entries: Array<[string, Record<string, unknown>]>): string | null {
  const skipped = entries.filter(([, entry]) => entry.status === "not_applicable");
  if (!skipped.length) return null;
  const names: string[] = [];
  for (const [key, entry] of skipped) {
    const label = Object.hasOwn(PLANNING_CATEGORY_LABELS, key) ? categoryLabel(key, key)
      : key.startsWith("custom_") && typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : null;
    if (!label) return null;
    names.push(label);
  }
  const rest = entries.length - skipped.length;
  return `${names.join("·")}: '안 해요'로 표시${rest ? ` · 진행 상황 ${rest}개 수정` : ""}`;
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
  const routine = routineProgressEntries(row);
  if (routine !== null) {
    const skipped = notApplicableTitle(routine);
    if (skipped) return { displayTitle: skipped, displayDetail: null, valueSlots: [], relatedCategories: [], routineChanges: null };
    // 이름을 읽지 못한 "안 해요" 저장은 접지 않고 원문 그대로 둔다.
    if (!routine.some(([, entry]) => entry.status === "not_applicable")) {
      return { displayTitle: null, displayDetail: null, valueSlots: [], relatedCategories: [], routineChanges: routine.length };
    }
  }
  const manual = manualBudgetFacts(row);
  const title = manual?.title
    ?? (row.metadata?.origin === "couple_plan_change_request" ? withoutUnchangedScheduleSegments(row.title) : row.title);
  return {
    displayTitle: title !== row.title ? title : null, displayDetail: null,
    valueSlots: manual?.valueSlots ?? [], relatedCategories: manual?.relatedCategories ?? [], routineChanges: null,
  };
}

// ── 행 검사 (zod 없이, 예전 스키마와 같거나 더 엄격하게) ───────────────────

/**
 * RFC 4122 모양의 UUID. 예전 `z.string().uuid()`(zod 4)는 버전 1~8·변형 8/9/a/b 에 더해 전부 0·전부 f
 * 두 값도 받았다. 이 검사는 그 둘을 받지 않는다(DB 가 만드는 id 는 그런 값이 아니다) — 더 엄격하다.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/**
 * 시간대가 붙은 ISO 시각. PostgREST 는 `2026-09-07T00:00:00.123456+00:00` 처럼 마이크로초와 `+00:00` 을 준다.
 * 예전 `z.string().datetime({ offset: true })` 보다 엄격하다: 초를 빼먹은 값(`T00:00Z`)과 10자리 넘는
 * 소수는 받지 않는다.
 */
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_INSTANT.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth && hour <= 23 && minute <= 59 && second <= 59
    && offsetHour <= 23 && offsetMinute <= 59 && Number.isFinite(Date.parse(value));
}
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
const nullableString = (value: unknown): value is string | null => value === null || typeof value === "string";
const isDecisionType = (value: unknown): value is DecisionType => typeof value === "string" && (DECISION_TYPES as readonly string[]).includes(value);

type DecisionRow = {
  id: string; couple_id: string; category: string | null; title: string; reasoning: string | null;
  decision_type: DecisionType; source: string | null; created_at: string; metadata: Record<string, unknown> | null; chosen_value?: unknown;
};

/** 한 행의 모양을 본다. 제목은 앞뒤 공백을 걷어 낸 값을 쓴다(예전 스키마의 `.trim()`과 같다). */
function decisionRow(value: unknown): DecisionRow {
  if (!isPlainObject(value)) throw new Error("DECISION_ROW_INVALID");
  const { id, couple_id, visibility, category, title, reasoning, decision_type, source, created_at, superseded_at, memory_key, metadata, chosen_value } = value;
  if (typeof id !== "string" || !UUID.test(id) || typeof couple_id !== "string" || !UUID.test(couple_id)
    // 개인 상담(bride_private·groom_private)은 두 사람이 같이 보는 기록이 아니다.
    || visibility !== "shared"
    || !nullableString(category) || typeof title !== "string" || !title.trim() || !nullableString(reasoning)
    || !isDecisionType(decision_type) || !nullableString(source) || !isIsoInstant(created_at)
    // 대체된 결정과 자동 기억은 결정 기록이 아니다. 키가 없어도 거부한다.
    || superseded_at !== null || memory_key !== null
    || (metadata !== null && !isPlainObject(metadata))) throw new Error("DECISION_ROW_INVALID");
  return { id, couple_id, category, title: title.trim(), reasoning, decision_type, source, created_at, metadata, chosen_value };
}

const DECISION_STATE_LABELS: Readonly<Record<Exclude<DecisionType, "scheduled">, string>> = {
  exploring: "탐색 중", considering: "고려 중", decided: "결정 기록", booked: "예약 기록", completed: "완료 기록",
};

/**
 * 공유 제품 결정만 보여준다. 추출 기억은 명시적 결정으로 승격하지 않는다.
 *
 * 거부하면 **페이지 전체를** 던진다(한 행만 빼고 보여 주지 않는다). 다른 커플 행·개인 상담·자동 추출
 * 기억·대체된 결정이 섞였다는 것은 조회 조건이나 RLS 가 어긋났다는 뜻이라, 나머지도 믿을 수 없다.
 * 커서가 있으면 모든 행이 그 커서보다 앞(더 오래된 쪽)이어야 한다 — 같은 페이지를 다시 받거나
 * 순서가 뒤집힌 응답을 이어 붙이지 않는다.
 */
export function parsePreparationDecisions(value: unknown, coupleId: string, cursor: DecisionCursor | null = null) {
  if (!Array.isArray(value) || value.length > DECISION_PAGE_SIZE + 1) throw new Error("DECISION_ROW_INVALID");
  const rows = value.map(decisionRow);
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
  const last = visible[visible.length - 1];
  return {
    records: visible.map((row): PreparationDecision => {
      const facts = preparationDecisionFacts(row);
      return {
        id: row.id, category: row.category ?? "", title: row.title, detail: row.reasoning || null,
        createdAt: row.created_at, source: row.source ?? "",
        status: row.decision_type === "exploring" ? "exploring" : row.decision_type === "considering" ? "considering" : "confirmed",
        stateLabel: row.decision_type === "scheduled" ? preparationScheduleRecordLabel(row) : DECISION_STATE_LABELS[row.decision_type],
        ...(facts.displayTitle ? { displayTitle: facts.displayTitle } : {}),
        ...(facts.displayDetail && facts.displayDetail !== row.reasoning ? { displayDetail: facts.displayDetail } : {}),
        ...(facts.valueSlots.length ? { valueSlots: facts.valueSlots } : {}),
        ...(facts.relatedCategories.length ? { relatedCategories: facts.relatedCategories } : {}),
        ...(facts.routineChanges !== null ? { routineChanges: facts.routineChanges } : {}),
      };
    }),
    nextCursor: rows.length > DECISION_PAGE_SIZE && last ? { id: last.id, createdAt: last.created_at } : null,
  };
}

/**
 * 다음 페이지 조건(PostgREST `or`). 커서 값이 조건 문법으로 새지 않도록 UUID·ISO 시각 모양만 받는다
 * (둘 다 쉼표·괄호가 들어갈 수 없다).
 */
export function decisionCursorFilter(cursor: DecisionCursor): string {
  if (!cursor || typeof cursor.id !== "string" || !UUID.test(cursor.id) || !isIsoInstant(cursor.createdAt)) {
    throw new Error("DECISION_CURSOR_INVALID");
  }
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}

// ── 한국 날짜 ────────────────────────────────────────────────────────────

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
function kstDate(value: string): Date | null {
  const time = Date.parse(value);
  // +9시간을 더한 뒤 UTC 필드로 읽으면 한국 달력 날짜다. 로컬 필드로 읽으면 기기 시간대가 섞인다.
  return Number.isFinite(time) ? new Date(time + KST_OFFSET_MS) : null;
}

/** 한국 날짜 열쇠 `YYYY-MM-DD`. 읽지 못하면 빈 문자열. */
export function preparationDayKey(value: string): string {
  const date = kstDate(value);
  return date ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}` : "";
}

/** 화면 날짜 `M. D.` — 웹이 쓰던 `Intl ko-KR {month, day}` 출력과 바이트까지 같다(예: `9. 11.`). */
export function preparationDate(value: string): string | null {
  const date = kstDate(value);
  return date ? `${date.getUTCMonth() + 1}. ${date.getUTCDate()}.` : null;
}

/**
 * 불러온 기록을 화면용으로 정리한다. DB 행은 바꾸지 않는다.
 * - 같은 값(예: 드레스·예식 정장 예산)을 나중 기록이 모두 다시 바꿨으면 앞 기록을 이전 값으로 표시한다.
 *   기록은 최신순으로 불러오므로, 더 최근 기록은 항상 먼저 불러온 상태다.
 * - 체크리스트·진행 상태만 저장한 기록은 결정 목록에서 빼고 한국 날짜별 개수로 접는다.
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
    const key = preparationDayKey(row.createdAt);
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

// ── 분야 ─────────────────────────────────────────────────────────────────

/** 경로 없는 목적지. 웹은 `/wedding/...` 주소로, 앱은 자기 화면으로 바꾼다. 예약·업체 목적지는 없다. */
export type PreparationDecisionDestination =
  | { kind: "checklist"; category: string; label: string }
  | { kind: "budget"; label: string }
  | { kind: "schedule"; label: string };
export type PreparationDecisionCategory = { key: string; label: string; destination: PreparationDecisionDestination | null };

/** 결정의 저장 분류만 해석한다. 출처나 제목으로 체크리스트 분야를 추측하지 않는다. */
export const PREPARATION_DECISION_CATEGORIES: ReadonlyArray<PreparationDecisionCategory> = [
  ...CATEGORY_CHECKLISTS.map(({ key, label }): PreparationDecisionCategory => ({
    key, label, destination: { kind: "checklist", category: key, label: "분야 체크리스트 보기" },
  })),
  { key: "budget", label: "예산", destination: { kind: "budget", label: "예산 보기" } },
  { key: "schedule", label: "일정", destination: { kind: "schedule", label: "일정 보기" } },
  // 포괄적인 준비 기록에는 저장 분류만으로 특정 화면을 연결하지 않는다.
  { key: "plan", label: "준비 계획", destination: null },
  { key: "general", label: "일반 준비", destination: null },
];

export function preparationDecisionCategory(key: string | null | undefined): PreparationDecisionCategory | undefined {
  return PREPARATION_DECISION_CATEGORIES.find(category => category.key === key);
}

/** 저장 분류와, 예산 결정이면 예산·해당 분야에도 속한다. 한 기록은 전체 개수에 한 번만 센다. */
export function decisionBelongsTo(row: Pick<PreparationDecision, "category" | "relatedCategories">, key: string): boolean {
  return row.category === key || !!row.relatedCategories?.includes(key);
}

/**
 * 분야 칩(`all`·`unsorted`·분야 키)과 검색어로 거른다. 검색은 불러온 기록의 원문·다시 적은 문장·분야 이름에서 찾는다.
 * `unsorted`는 저장 분류가 알려진 분야가 아닌 기록이다.
 */
export function filterPreparationDecisions<T extends PreparationDecision>(rows: readonly T[], category: string, query: string): T[] {
  const needle = query.trim().toLocaleLowerCase("ko");
  return rows.filter(row => {
    const field = preparationDecisionCategory(row.category);
    if (category === "unsorted" ? !!field : category !== "all" && !decisionBelongsTo(row, category)) return false;
    const labels = (row.relatedCategories ?? []).map(key => preparationDecisionCategory(key)?.label);
    return !needle || [row.title, row.displayTitle, row.detail, row.displayDetail, field?.label, ...labels].some(value => value?.toLocaleLowerCase("ko").includes(needle));
  });
}

/** 긴 글을 `limit` 자에서 자르고 `…`를 붙인다. 이모지처럼 두 칸짜리 글자를 반으로 가르지 않는다. */
export function decisionPreview(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit).replace(/[\uD800-\uDBFF]$/u, "")}…` : text;
}
