import {
  isValidScheduleTime,
  MAX_SCHEDULE_EVENTS,
  sanitizeUserFacingScheduleMemo,
} from "@/utils/scheduleEvents";
import { isValidWeddingWonAmount } from "@/lib/weddingBudget";

const MAX_PROGRESS_KEYS = 100;
const MAX_PROGRESS_ARRAY_ITEMS = 100;
const MAX_PROGRESS_DEPTH = 4;
const MAX_PROGRESS_STRING_CHARS = 1_000;
const MAX_VENUE_CHARS = 200;
const MAX_PREFERENCE_CHARS = 80;
const MAX_PREFERENCE_PRIORITIES = 10;

const BLOCKED_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

type UnknownRecord = Record<string, unknown>;

export interface NormalizedScheduleEvent {
  /**
   * 일정 도구(`update_schedule_event`·`cancel_schedule_event`)는 `event_id` 를
   * 필수로 받는다. 예전에는 이 정규화가 id 를 버려서 아모라가 그 값을 볼 길이
   * 없었고, 라이브에서 **"그 일정의 확인된 ID가 없어서 취소할 수 없다"**고
   * 답했다(2026-08-23). 사용자는 내부 id 를 모른다 — 그러니 우리가 실어야 한다.
   */
  id?: string;
  date: string;
  time?: string;
  title: string;
  memo?: string;
  categoryKey?: string;
}

export interface NormalizedWeddingPreferences {
  weddingStyle?: string | null;
  priorities?: string[];
  budgetAttitude?: string | null;
  guestCount?: string | null;
}

/**
 * 총예산이 덮는 범위. 같은 "3천만원"도 결혼식만인지 신혼집까지인지에 따라 이후 계산과
 * 조언이 완전히 달라진다. 금액 크기로 추정하지 않고 사용자가 확인한 항목만 기록한다.
 */
export const BUDGET_SCOPE_ITEMS = [
  "wedding",
  "studio",
  "rings",
  "honeymoon",
  "appliances",
  "housing",
] as const;

export type BudgetScopeItem = typeof BUDGET_SCOPE_ITEMS[number];

/**
 * 사용자와 모델에게 보여줄 이름. 결혼 준비가 처음인 사람도 바로 알 수 있는 말만 쓴다.
 * `스드메`, `예물` 같은 업계 용어는 쓰지 않는다(`mvpDirection.test.ts`의 쉬운 말 계약).
 * 항목을 늘리면 여기도 함께 늘린다.
 */
export const BUDGET_SCOPE_LABELS: Record<BudgetScopeItem, string> = {
  wedding: "결혼식",
  studio: "사진·드레스·메이크업",
  rings: "결혼반지",
  honeymoon: "신혼여행",
  appliances: "가전·가구",
  housing: "신혼집",
};

export interface NormalizedBudgetScope {
  /** 사용자가 총액에 포함한다고 확인한 항목 */
  included: BudgetScopeItem[];
  /** 사용자가 총액에서 뺀다고 확인한 항목 */
  excluded: BudgetScopeItem[];
  /** 아직 확인하지 않은 항목. 포함으로 추정하지 않는다. */
  unknown: BudgetScopeItem[];
  confirmedAt: string | null;
}

/**
 * `progress.__budgetScope`를 읽어 확인된 것과 확인되지 않은 것을 분리한다.
 * 알 수 없는 항목명과 상태값은 추정하지 않고 버린다. 원문이 아니라 열거값만 다루므로
 * 개인 상담 원문을 보존하지 않는 기존 결정과 충돌하지 않는다.
 */
export function normalizeBudgetScope(progress: unknown): NormalizedBudgetScope {
  const raw = isRecord(progress) ? progress.__budgetScope : undefined;
  const record = isRecord(raw) ? raw : {};
  const included: BudgetScopeItem[] = [];
  const excluded: BudgetScopeItem[] = [];
  const unknown: BudgetScopeItem[] = [];

  for (const item of BUDGET_SCOPE_ITEMS) {
    const state = record[item];
    if (state === "included") included.push(item);
    else if (state === "excluded") excluded.push(item);
    // 확인하지 않은 항목은 포함으로 추정하지 않는다. 알 수 없는 키는 위 루프가
    // 허용 목록만 읽으므로 자동으로 무시된다.
    else unknown.push(item);
  }

  const confirmedAtRaw = boundedString(record.confirmedAt, 10);
  return {
    included,
    excluded,
    unknown,
    confirmedAt: confirmedAtRaw && isValidYmd(confirmedAtRaw) ? confirmedAtRaw : null,
  };
}

export interface NormalizedAmoraWeddingContext {
  weddingDate: string | null;
  budget: number;
  venue: string | null;
  /** 프롬프트용. 문자열 1,000자·배열 100개·키 100개·깊이 4로 잘라 둔 사본이다. */
  progress: Record<string, unknown>;
  /**
   * 쓰기 도구의 기준값. 인증 사용자는 서버가 읽은 `progress` 를 **자르지 않은** 사본이다.
   *
   * 원자적 쓰기는 이 값을 CAS 기대값(`expected`)으로 보내고, DB 는 자르지 않은 저장
   * 행과 그대로 비교한다. 예전에는 위의 잘린 `progress` 를 보냈다. 그래서 일정 메모가
   * 1,000자를 넘거나 일정이 100개를 넘으면 값이 절대 같을 수 없어, 아무도 바꾸지
   * 않았는데도 일정 추가·변경·취소가 전부 "다른 일정 변경이 먼저 반영되어 이번 요청은
   * 적용하지 않았어요" 로 끝났다(2026-09-15 점검). 체험 세션은 DB 가 없으므로 정규화한
   * 클라이언트 값을 그대로 쓴다.
   */
  storedProgress: Record<string, unknown>;
  scheduleEvents: NormalizedScheduleEvent[];
  /**
   * 저장된 일정 id 전부(취소한 일정 포함). 확인 카드가 가리키는 일정이 실제로 있는지
   * 대조하는 데 쓴다. 프롬프트용 `scheduleEvents` 는 취소 일정을 빼므로 그걸로 대조하면
   * 취소 일정 복원 카드가 늘 "없는 일정" 으로 버려진다.
   */
  storedScheduleEventIds: string[];
  preferences: NormalizedWeddingPreferences | null;
}

interface ResolveAmoraWeddingContextInput {
  canonicalJourney: unknown;
  clientContext: unknown;
  allowClientContext: boolean;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxChars);
}

function isValidYmd(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function normalizeWeddingDate(value: unknown): string | null {
  const date = boundedString(value, 10);
  return date && isValidYmd(date) ? date : null;
}

function normalizeBudget(value: unknown): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)
      ? Number(value)
      : 0;
  const rounded = Math.round(parsed);
  return isValidWeddingWonAmount(rounded) ? rounded : 0;
}

function sanitizeProgressValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.slice(0, MAX_PROGRESS_STRING_CHARS);
  if (depth >= MAX_PROGRESS_DEPTH) return undefined;

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_PROGRESS_ARRAY_ITEMS)
      .map((item) => sanitizeProgressValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!isRecord(value)) return undefined;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_PROGRESS_KEYS)) {
    if (BLOCKED_OBJECT_KEYS.has(key)) continue;
    const sanitized = sanitizeProgressValue(item, depth + 1);
    if (sanitized !== undefined) result[key.slice(0, 120)] = sanitized;
  }
  return result;
}

function normalizeProgress(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const sanitized = sanitizeProgressValue(value, 0);
  return isRecord(sanitized) ? sanitized : {};
}

/**
 * 자르지 않은 저장값의 독립 사본. 도구 실행이 문맥을 고쳐도 라우트가 따로 읽는
 * 정본 `journey.progress` 는 그대로 남게 한다.
 */
function cloneStoredProgress(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const cloned: unknown = structuredClone(value);
  return isRecord(cloned) ? cloned : {};
}

/**
 * 일정 목록은 자르기 **전** 저장값에서 읽는다. 프롬프트용 `progress` 는 배열을 앞 100개로
 * 자르므로, 저장 순서상 101번째 뒤에 있는 다가오는 일정은 아모라에게 보이지도 않고
 * 확인 카드도 만들 수 없었다. 날짜순으로 추리는 것은 프롬프트가 한다(다가오는 10개·
 * 지난 5개). 여기서는 일정 저장 한도(`MAX_SCHEDULE_EVENTS`)만큼만 본다.
 */
function normalizeScheduleEvents(progress: Record<string, unknown>): NormalizedScheduleEvent[] {
  const rawEvents = progress.__events;
  if (!Array.isArray(rawEvents)) return [];
  const events: NormalizedScheduleEvent[] = [];
  for (const rawEvent of rawEvents.slice(0, MAX_SCHEDULE_EVENTS)) {
    if (!isRecord(rawEvent)) continue;
    if (
      rawEvent.status === "cancelled"
      || (rawEvent.status !== undefined
        && rawEvent.status !== "planned"
        && rawEvent.status !== "completed")
      || rawEvent.cancellation !== undefined
    ) {
      continue;
    }
    const date = normalizeWeddingDate(rawEvent.date);
    const title = boundedString(rawEvent.title, 300);
    if (!date || !title) continue;
    const memo = sanitizeUserFacingScheduleMemo(boundedString(rawEvent.memo, 500));
    const categoryKey = boundedString(rawEvent.categoryKey, 80);
    const id = boundedString(rawEvent.id, 200);
    events.push({
      ...(id ? { id } : {}),
      date,
      title,
      ...(isValidScheduleTime(rawEvent.time) ? { time: rawEvent.time } : {}),
      ...(memo ? { memo } : {}),
      ...(categoryKey ? { categoryKey } : {}),
    });
  }
  return events;
}

function collectScheduleEventIds(progress: Record<string, unknown>): string[] {
  const rawEvents = progress.__events;
  if (!Array.isArray(rawEvents)) return [];
  const ids = new Set<string>();
  for (const rawEvent of rawEvents.slice(0, MAX_SCHEDULE_EVENTS)) {
    // 실행기는 저장된 id 와 정확히 같은지 본다. 여기서 trim 하면 둘이 어긋난다.
    if (isRecord(rawEvent) && typeof rawEvent.id === "string" && rawEvent.id.length > 0) {
      ids.add(rawEvent.id);
    }
  }
  return [...ids];
}

function normalizePreferences(progress: Record<string, unknown>): NormalizedWeddingPreferences | null {
  const raw = progress.__preferences;
  if (!isRecord(raw)) return null;
  const weddingStyle = boundedString(raw.weddingStyle, MAX_PREFERENCE_CHARS);
  const budgetAttitude = boundedString(
    raw.budgetAttitude ?? raw.budgetTendency,
    MAX_PREFERENCE_CHARS,
  );
  const guestCount = boundedString(raw.guestCount, MAX_PREFERENCE_CHARS);
  const priorities = Array.isArray(raw.priorities)
    ? raw.priorities
        .map((value) => boundedString(value, MAX_PREFERENCE_CHARS))
        .filter((value): value is string => value !== null)
        .slice(0, MAX_PREFERENCE_PRIORITIES)
    : [];
  if (!weddingStyle && !budgetAttitude && !guestCount && priorities.length === 0) return null;
  return {
    ...(weddingStyle ? { weddingStyle } : {}),
    ...(priorities.length > 0 ? { priorities } : {}),
    ...(budgetAttitude ? { budgetAttitude } : {}),
    ...(guestCount ? { guestCount } : {}),
  };
}

/**
 * Resolves the only wedding context allowed to reach Amora prompts and tools.
 * Authenticated turns use the server-read journey exclusively. The signed demo
 * may use client context, but only after bounded structural normalization.
 */
export function resolveAmoraWeddingContext({
  canonicalJourney,
  clientContext,
  allowClientContext,
}: ResolveAmoraWeddingContextInput): NormalizedAmoraWeddingContext {
  const source = isRecord(allowClientContext ? clientContext : canonicalJourney)
    ? (allowClientContext ? clientContext : canonicalJourney) as UnknownRecord
    : {};
  const progress = normalizeProgress(source.progress);
  // 체험 세션의 클라이언트 값은 믿을 수 없는 입력이라 정규화한 사본만 쓴다.
  const storedProgress = allowClientContext ? progress : cloneStoredProgress(source.progress);
  return {
    weddingDate: normalizeWeddingDate(
      allowClientContext ? source.weddingDate : source.wedding_date,
    ),
    budget: normalizeBudget(
      allowClientContext ? source.budget : source.total_budget,
    ),
    venue: boundedString(source.venue, MAX_VENUE_CHARS),
    progress,
    storedProgress,
    scheduleEvents: normalizeScheduleEvents(storedProgress),
    storedScheduleEventIds: collectScheduleEventIds(storedProgress),
    preferences: normalizePreferences(progress),
  };
}
