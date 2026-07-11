function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatLocalDateOnly(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseLocalDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
    ? parsed
    : null;
}

function dateOnlyUtcDayNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, month - 1, day);
  const parsed = new Date(utcMs);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return utcMs / (24 * 60 * 60 * 1000);
}

/** Calendar-day difference without UTC/local-time or daylight-saving drift. */
export function differenceInDateOnlyDays(later: string, earlier: string): number | null {
  const laterDay = dateOnlyUtcDayNumber(later);
  const earlierDay = dateOnlyUtcDayNumber(earlier);
  if (laterDay === null || earlierDay === null) return null;
  return laterDay - earlierDay;
}

/** Database vendor_timeslots contract: Monday=0 ... Sunday=6. */
export function databaseWeekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** Returns the next occurrence after `from` for the DB weekday contract. */
export function nextLocalDateForDatabaseWeekday(
  weekday: number,
  from: Date = new Date()
): Date | null {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || Number.isNaN(from.getTime())) {
    return null;
  }

  const next = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let daysUntil = weekday - databaseWeekdayIndex(next);
  if (daysUntil <= 0) daysUntil += 7;
  next.setDate(next.getDate() + daysUntil);
  return next;
}

/** Compares a YYYY-MM-DD value with the reference's local calendar day. */
export function isLocalDateOnlyBefore(value: string, reference: Date = new Date()): boolean {
  const parsed = parseLocalDateOnly(value);
  if (!parsed || Number.isNaN(reference.getTime())) return false;
  return formatLocalDateOnly(parsed) < formatLocalDateOnly(reference);
}
