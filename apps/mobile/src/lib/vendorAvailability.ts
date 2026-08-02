const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_TIME_PATTERN = /^(?:[01]\d|2[0-3]):00$/;

export type PublicBookingAvailabilitySlot = {
  date: string;
  time: string;
  available: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function databaseWeekdayForLocalDate(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export function localDateString(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function parsePublicAvailabilityPayload(
  value: unknown,
  expectedDate: string,
): PublicBookingAvailabilitySlot[] | null {
  if (
    !ISO_DATE_PATTERN.test(expectedDate)
    || !isRecord(value)
    || value.from !== expectedDate
    || value.to !== expectedDate
    || value.timezone !== "Asia/Seoul"
    || !Array.isArray(value.slots)
    || value.slots.length > 24
  ) {
    return null;
  }

  const result: PublicBookingAvailabilitySlot[] = [];
  const keys = new Set<string>();
  for (const raw of value.slots) {
    if (
      !isRecord(raw)
      || raw.date !== expectedDate
      || typeof raw.time !== "string"
      || !HOUR_TIME_PATTERN.test(raw.time)
      || typeof raw.available !== "boolean"
    ) {
      return null;
    }
    const key = `${raw.date}\0${raw.time}`;
    if (keys.has(key)) return null;
    keys.add(key);
    result.push({
      date: raw.date,
      time: raw.time,
      available: raw.available,
    });
  }
  return result;
}

export function availableHoursFromPublicAvailability(
  slots: readonly PublicBookingAvailabilitySlot[],
  date: string,
): number[] | null {
  if (!ISO_DATE_PATTERN.test(date) || slots.length > 24) return null;
  const seenHours = new Set<number>();
  const available: number[] = [];
  for (const slot of slots) {
    if (slot.date !== date || !HOUR_TIME_PATTERN.test(slot.time)) return null;
    const hour = Number(slot.time.slice(0, 2));
    if (seenHours.has(hour)) return null;
    seenHours.add(hour);
    if (slot.available) available.push(hour);
  }
  return available.sort((left, right) => left - right);
}
