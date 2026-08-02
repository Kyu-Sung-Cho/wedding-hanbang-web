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
