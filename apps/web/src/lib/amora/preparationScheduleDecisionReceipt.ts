import { readAmoraConfirmedScheduleDecisions } from "@hanbang/shared/amora-preparation-topic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EVENT_ID_RE = /^[0-9A-Za-z_-]{1,200}$/u;
const TOPIC_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/u;
const UNSAFE_TEXT_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

type ScheduleDecisionEntry = {
  decisionId: string;
  eventId: string;
  topicKey: string;
  title: string;
  date: string;
  confirmedAt: string;
  scope: "couple_shared";
  canOpenSchedule: true;
};

type ScheduleDecisionBoundary = {
  confirmedAt: string;
  decisionId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIsoTime(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    && Number.isFinite(Date.parse(value));
}

function normalizeSearch(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("ko-KR");
}

function matchesSearchText(value: string, query: string) {
  const searchable = normalizeSearch(value);
  return normalizeSearch(query)
    .split(" ")
    .filter(Boolean)
    .every((term) => searchable.includes(term));
}

function structuralEventId(value: unknown) {
  if (!isRecord(value) || !isRecord(value.chosen_value)) return null;
  const eventId = value.chosen_value.eventId;
  return typeof eventId === "string" && EVENT_ID_RE.test(eventId) ? eventId : null;
}

function rawDecisionOrder(left: unknown, right: unknown) {
  const leftTime = isRecord(left) && isIsoTime(left.decided_at)
    ? Date.parse(left.decided_at)
    : Number.POSITIVE_INFINITY;
  const rightTime = isRecord(right) && isIsoTime(right.decided_at)
    ? Date.parse(right.decided_at)
    : Number.POSITIVE_INFINITY;
  if (leftTime !== rightTime) return rightTime - leftTime;
  const leftId = isRecord(left) && typeof left.id === "string" ? left.id.toLowerCase() : "";
  const rightId = isRecord(right) && typeof right.id === "string" ? right.id.toLowerCase() : "";
  return rightId.localeCompare(leftId);
}

function isStrictlyOlder(
  entry: ScheduleDecisionEntry,
  boundary: ScheduleDecisionBoundary,
) {
  const entryTime = Date.parse(entry.confirmedAt);
  const boundaryTime = Date.parse(boundary.confirmedAt);
  return entryTime < boundaryTime
    || (entryTime === boundaryTime && entry.decisionId < boundary.decisionId);
}

export function parsePreparationScheduleDecisionReceiptCandidate(input: {
  coupleId: string;
  currentJourneyRevision: number;
  progress: Readonly<Record<string, unknown>>;
  decisionRow: unknown;
  nowMs: number;
}): ScheduleDecisionEntry | null {
  if (
    !UUID_RE.test(input.coupleId)
    || !Number.isSafeInteger(input.currentJourneyRevision)
    || input.currentJourneyRevision < 0
    || !isRecord(input.progress)
    || !Array.isArray(input.progress.__events)
    || !isRecord(input.decisionRow)
    || !Number.isFinite(input.nowMs)
  ) return null;
  const topicKey = input.decisionRow.category;
  const decisionId = input.decisionRow.id;
  if (
    typeof topicKey !== "string"
    || !TOPIC_KEY_RE.test(topicKey)
    || typeof decisionId !== "string"
    || !UUID_RE.test(decisionId)
  ) return null;
  const decisions = readAmoraConfirmedScheduleDecisions(
    topicKey,
    input.coupleId,
    input.currentJourneyRevision,
    input.progress.__events,
    [input.decisionRow],
    new Date(input.nowMs).toISOString(),
  );
  if (decisions.length !== 1 || decisions[0]?.id !== decisionId.toLowerCase()) {
    return null;
  }
  const decision = decisions[0];
  return {
    decisionId: decision.id,
    eventId: decision.eventId,
    topicKey,
    title: decision.title,
    date: decision.date,
    confirmedAt: decision.confirmedAt,
    scope: "couple_shared",
    canOpenSchedule: true,
  };
}

export function buildPreparationScheduleDecisionReceiptPage(input: {
  coupleId: string;
  recipientUserId: string;
  query: string;
  snapshotAt: string;
  currentJourneyRevision: number;
  progress: Readonly<Record<string, unknown>>;
  limit: number;
  scanLimit: number;
  decisionRows: readonly unknown[];
  topicLabels: Readonly<Record<string, string>>;
  nowMs: number;
  cursorBoundary?: ScheduleDecisionBoundary | null;
}): {
  entries: ScheduleDecisionEntry[];
  nextBoundary: ScheduleDecisionBoundary | null;
  partial: boolean;
} | null {
  if (
    !UUID_RE.test(input.coupleId)
    || !UUID_RE.test(input.recipientUserId)
    || !isIsoTime(input.snapshotAt)
    || typeof input.query !== "string"
    || Array.from(input.query).length > 120
    || UNSAFE_TEXT_RE.test(input.query)
    || !Number.isSafeInteger(input.currentJourneyRevision)
    || input.currentJourneyRevision < 0
    || !isRecord(input.progress)
    || !Array.isArray(input.progress.__events)
    || !Number.isSafeInteger(input.limit)
    || input.limit < 1
    || input.limit > 24
    || !Number.isSafeInteger(input.scanLimit)
    || input.scanLimit < input.limit
    || input.scanLimit > 80
    || !Array.isArray(input.decisionRows)
    || input.decisionRows.length > input.scanLimit + 1
    || !isRecord(input.topicLabels)
    || !Number.isFinite(input.nowMs)
    || (input.cursorBoundary !== undefined && input.cursorBoundary !== null && (
      !isIsoTime(input.cursorBoundary.confirmedAt)
      || !UUID_RE.test(input.cursorBoundary.decisionId)
    ))
  ) return null;

  const rows = input.decisionRows.slice(0, input.scanLimit).sort(rawDecisionOrder);
  const rowsByEvent = new Map<string, unknown[]>();
  const seenDecisionIds = new Set<string>();
  let partial = input.decisionRows.length > input.scanLimit;
  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== "string" || !UUID_RE.test(row.id)) {
      partial = true;
      continue;
    }
    const decisionId = row.id.toLowerCase();
    if (seenDecisionIds.has(decisionId)) {
      partial = true;
      continue;
    }
    seenDecisionIds.add(decisionId);
    const eventId = structuralEventId(row);
    if (!eventId) {
      partial = true;
      continue;
    }
    const candidates = rowsByEvent.get(eventId) ?? [];
    candidates.push(row);
    rowsByEvent.set(eventId, candidates);
  }

  const entries: ScheduleDecisionEntry[] = [];
  for (const candidates of rowsByEvent.values()) {
    candidates.sort(rawDecisionOrder);
    const latest = candidates[0];
    const latestTime = isRecord(latest) && isIsoTime(latest.decided_at)
      ? latest.decided_at
      : null;
    const secondTime = candidates.length > 1
      && isRecord(candidates[1])
      && isIsoTime(candidates[1].decided_at)
        ? candidates[1].decided_at
        : null;
    if (latestTime === null || (secondTime !== null && secondTime === latestTime)) {
      partial = true;
      continue;
    }
    const parsed = parsePreparationScheduleDecisionReceiptCandidate({
      coupleId: input.coupleId,
      currentJourneyRevision: input.currentJourneyRevision,
      progress: input.progress,
      decisionRow: latest,
      nowMs: input.nowMs,
    });
    if (!parsed) {
      partial = true;
      continue;
    }
    entries.push(parsed);
  }

  entries.sort((left, right) => (
    Date.parse(right.confirmedAt) - Date.parse(left.confirmedAt)
    || right.decisionId.localeCompare(left.decisionId)
  ));
  const filtered = entries.filter((entry) => {
    if (input.cursorBoundary && !isStrictlyOlder(entry, input.cursorBoundary)) return false;
    const topicLabel = input.topicLabels[entry.topicKey] ?? "";
    return input.query.length === 0
      || matchesSearchText(
        `${entry.title} ${entry.date} ${entry.topicKey} ${topicLabel}`,
        input.query,
      );
  });
  const pageEntries = filtered.slice(0, input.limit);
  const hasMore = filtered.length > pageEntries.length;
  const last = pageEntries.at(-1);
  return {
    entries: pageEntries,
    nextBoundary: hasMore && last
      ? { confirmedAt: last.confirmedAt, decisionId: last.decisionId }
      : null,
    partial,
  };
}
