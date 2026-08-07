import { isValidScheduleYmd } from "@/utils/scheduleEvents";

import {
  koreanDateInKst,
  kstMidnightFromYmd,
  todayKstMidnight,
} from "@/lib/utils/kstDate";

const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeWeddingDate(value: unknown): string {
  return isValidScheduleYmd(value) ? value : "";
}

export function daysUntilWedding(
  value: unknown,
  today: Date = todayKstMidnight(),
): number | null {
  if (!isValidScheduleYmd(value)) return null;
  return Math.round((kstMidnightFromYmd(value).getTime() - today.getTime()) / DAY_MS);
}

export function formatWeddingDate(value: unknown): string | null {
  if (!isValidScheduleYmd(value)) return null;
  return koreanDateInKst(kstMidnightFromYmd(value));
}
