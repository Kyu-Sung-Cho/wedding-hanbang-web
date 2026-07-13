import {
  addDaysUtc,
  dateLikeToYmdInKst,
  kstMidnightFromYmd,
  ymdInKst,
} from "@/lib/utils/kstDate";

export interface DailyResearchApplicationCount {
  date: string;
  count: number;
}

interface ResearchApplicationForStats {
  created_at?: unknown;
  email_verified_at?: unknown;
}

const DAILY_SERIES_LENGTH = 14;
const AVERAGE_WINDOW_DAYS = 7;

function kstCalendarDatesEndingAt(now: Date, days: number): string[] {
  const today = kstMidnightFromYmd(ymdInKst(now));
  return Array.from({ length: days }, (_, index) =>
    ymdInKst(addDaysUtc(today, index - (days - 1)))
  );
}

/**
 * Returns exactly the latest 14 KST calendar dates, including today.
 * Missing dates remain zero and unverified/invalid/out-of-window rows are ignored.
 */
export function buildVerifiedResearchApplicationDailyCounts(
  applications: ResearchApplicationForStats[],
  now: Date = new Date()
): DailyResearchApplicationCount[] {
  const dates = kstCalendarDatesEndingAt(now, DAILY_SERIES_LENGTH);
  const counts = new Map(dates.map((date) => [date, 0]));

  for (const application of applications) {
    if (!application.email_verified_at) continue;
    if (typeof application.created_at !== "string" && !(application.created_at instanceof Date)) {
      continue;
    }

    const date = dateLikeToYmdInKst(application.created_at);
    if (!date || !counts.has(date)) continue;
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }

  return dates.map((date) => ({ date, count: counts.get(date) ?? 0 }));
}

/**
 * Derives UI summary values from explicit KST calendar dates. A sparse or stale
 * response can never turn the last active day into "today", and the average is
 * always divided by seven calendar days (zero-activity days included).
 */
export function summarizeResearchApplicationDailyCounts(
  dailyCounts: DailyResearchApplicationCount[],
  now: Date = new Date()
): { todayCount: number; sevenDayAverage: number } {
  const countsByDate = new Map<string, number>();
  for (const item of dailyCounts) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) continue;
    if (!Number.isSafeInteger(item.count) || item.count < 0) continue;
    countsByDate.set(item.date, item.count);
  }

  const sevenDates = kstCalendarDatesEndingAt(now, AVERAGE_WINDOW_DAYS);
  const today = sevenDates[sevenDates.length - 1];
  const sevenDayTotal = sevenDates.reduce(
    (sum, date) => sum + (countsByDate.get(date) ?? 0),
    0
  );

  return {
    todayCount: today ? (countsByDate.get(today) ?? 0) : 0,
    sevenDayAverage: Math.round(sevenDayTotal / AVERAGE_WINDOW_DAYS),
  };
}
