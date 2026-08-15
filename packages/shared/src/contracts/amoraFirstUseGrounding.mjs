export const AMORA_FIRST_USE_GROUNDING_VERSION = 1;

const GROUNDING_KEYS = new Set([
  "wedding_date",
  "current_progress",
  "next_schedule",
  "total_budget",
  "venue",
]);
const EXTENDED_PICTOGRAPHIC_PATTERN = /^\p{Extended_Pictographic}$/u;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidYmd(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function isEmojiAdornment(character) {
  const codePoint = character?.codePointAt(0);
  return character === "\ufe0e"
    || character === "\ufe0f"
    || (codePoint != null && codePoint >= 0x1f3fb && codePoint <= 0x1f3ff);
}

function hasUnsafeFormatting(value) {
  const characters = Array.from(value);
  return characters.some((character, index) => {
    if (character === "\u200d") {
      let previousIndex = index - 1;
      while (previousIndex >= 0 && isEmojiAdornment(characters[previousIndex])) {
        previousIndex -= 1;
      }
      let nextIndex = index + 1;
      while (nextIndex < characters.length && isEmojiAdornment(characters[nextIndex])) {
        nextIndex += 1;
      }
      return previousIndex < 0
        || nextIndex >= characters.length
        || !EXTENDED_PICTOGRAPHIC_PATTERN.test(characters[previousIndex])
        || !EXTENDED_PICTOGRAPHIC_PATTERN.test(characters[nextIndex]);
    }
    return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(character);
  });
}

function normalizeVisibleText(value, maxLength) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (
    !normalized
    || Array.from(normalized).length > maxLength
    || hasUnsafeFormatting(normalized)
  ) return null;
  return normalized;
}

function formatWon(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

function findNextSchedule(scheduleEvents, todayYmd) {
  if (!Array.isArray(scheduleEvents)) return null;
  return scheduleEvents
    .flatMap((value) => {
      if (!isRecord(value) || !isValidYmd(value.date) || value.date < todayYmd) return [];
      const title = normalizeVisibleText(value.title, 100);
      return title ? [{ date: value.date, title }] : [];
    })
    .sort((left, right) => left.date.localeCompare(right.date))[0] ?? null;
}

function summarizeSavedChecklist(progress) {
  if (!isRecord(progress)) return null;
  let done = 0;
  let total = 0;
  let nextIncomplete = null;
  for (const [categoryKey, value] of Object.entries(progress)) {
    if (categoryKey.startsWith("__") || !isRecord(value)) continue;
    if (value.status === "not_applicable" || !Array.isArray(value.checklist)) continue;
    const seenIds = new Set();
    for (const item of value.checklist.slice(0, 100)) {
      if (!isRecord(item)) continue;
      const id = normalizeVisibleText(item.id, 120);
      const label = normalizeVisibleText(item.label, 180);
      if (!id || !label || seenIds.has(id) || typeof item.done !== "boolean") continue;
      seenIds.add(id);
      total += 1;
      if (item.done) {
        done += 1;
      } else if (nextIncomplete === null) {
        nextIncomplete = label;
      }
    }
  }
  return total > 0 ? { done, total, nextIncomplete } : null;
}

function formatChecklistProgress(checklist) {
  const countLabel = `저장한 체크리스트: ${checklist.done}/${checklist.total} 완료`;
  if (!checklist.nextIncomplete) return countLabel;
  return normalizeVisibleText(
    `${countLabel} · 남아 있는 항목: ${checklist.nextIncomplete}`,
    180,
  ) ?? countLabel;
}

function groundingItem(key, label) {
  return Object.freeze({ key, label });
}

function parseGroundingItems(value, seenKeys) {
  if (!Array.isArray(value) || value.length > 3) return null;
  const items = [];
  for (const item of value) {
    if (
      !isRecord(item)
      || Object.keys(item).sort().join(",") !== "key,label"
      || !GROUNDING_KEYS.has(item.key)
      || seenKeys.has(item.key)
    ) return null;
    const label = normalizeVisibleText(item.label, 180);
    if (!label || label !== item.label) return null;
    seenKeys.add(item.key);
    items.push(groundingItem(item.key, label));
  }
  return Object.freeze(items);
}

export function parseAmoraFirstUseGrounding(value, expectedSourceRevision) {
  if (
    !isRecord(value)
    || Object.keys(value).sort().join(",")
      !== "confirmed,sourceRevision,unknowns,version"
    || value.version !== AMORA_FIRST_USE_GROUNDING_VERSION
    || !Number.isSafeInteger(expectedSourceRevision)
    || expectedSourceRevision < 0
    || value.sourceRevision !== expectedSourceRevision
  ) return null;
  const seenKeys = new Set();
  const confirmed = parseGroundingItems(value.confirmed, seenKeys);
  const unknowns = parseGroundingItems(value.unknowns, seenKeys);
  if (!confirmed || !unknowns) return null;
  return Object.freeze({
    version: AMORA_FIRST_USE_GROUNDING_VERSION,
    sourceRevision: expectedSourceRevision,
    confirmed,
    unknowns,
  });
}

export function buildAmoraFirstUseGrounding({
  sourceRevision,
  todayYmd,
  weddingDate,
  budget,
  venue,
  progress,
  scheduleEvents,
}) {
  if (
    !Number.isSafeInteger(sourceRevision)
    || sourceRevision < 0
    || !isValidYmd(todayYmd)
  ) return null;

  const validWeddingDate = isValidYmd(weddingDate) ? weddingDate : null;
  const nextSchedule = findNextSchedule(scheduleEvents, todayYmd);
  const checklist = summarizeSavedChecklist(progress);
  const hasBudget = Number.isSafeInteger(budget) && budget > 0;
  const normalizedVenue = normalizeVisibleText(venue, 80);
  const confirmed = [
    ...(validWeddingDate
      ? [groundingItem("wedding_date", `결혼식 날짜: ${validWeddingDate}`)]
      : []),
    ...(nextSchedule
      ? [groundingItem(
          "next_schedule",
          `다음 일정: ${nextSchedule.date} · ${nextSchedule.title}`,
        )]
      : []),
    ...(checklist
      ? [groundingItem(
          "current_progress",
          formatChecklistProgress(checklist),
        )]
      : []),
    ...(hasBudget
      ? [groundingItem("total_budget", `전체 예산: ${formatWon(budget)}원`)]
      : []),
    ...(normalizedVenue
      ? [groundingItem("venue", `결혼식장: ${normalizedVenue}`)]
      : []),
  ].slice(0, 3);
  const unknowns = [
    ...(!checklist
      ? [groundingItem("current_progress", "이미 마친 준비와 아직 남은 준비")]
      : []),
    ...(!validWeddingDate ? [groundingItem("wedding_date", "결혼식 날짜")] : []),
    ...(!nextSchedule
      ? [groundingItem("next_schedule", "가장 가까운 중요한 일정")]
      : []),
    ...(!hasBudget ? [groundingItem("total_budget", "전체 예산 범위")] : []),
    ...(!normalizedVenue ? [groundingItem("venue", "결혼식장 결정 여부")] : []),
  ].slice(0, 3);

  return Object.freeze({
    version: AMORA_FIRST_USE_GROUNDING_VERSION,
    sourceRevision,
    confirmed: Object.freeze(confirmed),
    unknowns: Object.freeze(unknowns),
  });
}
