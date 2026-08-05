import { sanitizeUserFacingScheduleMemo } from "@/utils/scheduleEvents";
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
  date: string;
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
  progress: Record<string, unknown>;
  scheduleEvents: NormalizedScheduleEvent[];
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

function normalizeScheduleEvents(progress: Record<string, unknown>): NormalizedScheduleEvent[] {
  const rawEvents = progress.__events;
  if (!Array.isArray(rawEvents)) return [];
  const events: NormalizedScheduleEvent[] = [];
  for (const rawEvent of rawEvents.slice(0, MAX_PROGRESS_ARRAY_ITEMS)) {
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
    events.push({
      date,
      title,
      ...(memo ? { memo } : {}),
      ...(categoryKey ? { categoryKey } : {}),
    });
  }
  return events;
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
  return {
    weddingDate: normalizeWeddingDate(
      allowClientContext ? source.weddingDate : source.wedding_date,
    ),
    budget: normalizeBudget(
      allowClientContext ? source.budget : source.total_budget,
    ),
    venue: boundedString(source.venue, MAX_VENUE_CHARS),
    progress,
    scheduleEvents: normalizeScheduleEvents(progress),
    preferences: normalizePreferences(progress),
  };
}
