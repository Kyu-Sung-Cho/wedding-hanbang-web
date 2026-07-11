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

/** Database vendor_timeslots contract: Monday=0 ... Sunday=6. */
export function databaseWeekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}
