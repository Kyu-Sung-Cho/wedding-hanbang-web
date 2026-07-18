const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_TIME_PATTERN = /^(?:[01]\d|2[0-3]):00$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PublicBookingOccupancyCount = {
  date: string;
  time: string;
  productId: string | null;
  staffId: string | null;
  bookedCount: number;
};

type SlotCapacity = {
  hour: number;
  maxBookings: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuidOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && UUID_PATTERN.test(value));
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
): PublicBookingOccupancyCount[] | null {
  if (
    !ISO_DATE_PATTERN.test(expectedDate)
    || !isRecord(value)
    || value.from !== expectedDate
    || value.to !== expectedDate
    || value.timezone !== "Asia/Seoul"
    || !Array.isArray(value.counts)
    || value.counts.length > 5_000
  ) {
    return null;
  }

  const result: PublicBookingOccupancyCount[] = [];
  const keys = new Set<string>();
  for (const raw of value.counts) {
    if (
      !isRecord(raw)
      || raw.date !== expectedDate
      || typeof raw.time !== "string"
      || !HOUR_TIME_PATTERN.test(raw.time)
      || !isUuidOrNull(raw.productId)
      || !isUuidOrNull(raw.staffId)
      || !Number.isSafeInteger(raw.bookedCount)
      || (raw.bookedCount as number) < 1
      || (raw.bookedCount as number) > 5_000
    ) {
      return null;
    }
    const key = [raw.date, raw.time, raw.productId ?? "", raw.staffId ?? ""].join("\0");
    if (keys.has(key)) return null;
    keys.add(key);
    result.push({
      date: raw.date,
      time: raw.time,
      productId: raw.productId,
      staffId: raw.staffId,
      bookedCount: raw.bookedCount as number,
    });
  }
  return result;
}

export function availableHoursFromOccupancy(
  slots: readonly SlotCapacity[],
  counts: readonly PublicBookingOccupancyCount[],
  date: string,
  dimension: { productId?: string; staffId?: string } = {},
): number[] | null {
  if (!ISO_DATE_PATTERN.test(date) || slots.length > 24) return null;
  const seenHours = new Set<number>();
  const available: number[] = [];
  for (const slot of slots) {
    if (
      !Number.isSafeInteger(slot.hour)
      || slot.hour < 0
      || slot.hour > 23
      || !Number.isSafeInteger(slot.maxBookings)
      || slot.maxBookings < 1
      || seenHours.has(slot.hour)
    ) {
      return null;
    }
    seenHours.add(slot.hour);
    const time = `${String(slot.hour).padStart(2, "0")}:00`;
    const booked = counts.reduce((total, count) => {
      if (count.date !== date || count.time !== time) return total;
      if (dimension.productId !== undefined && count.productId !== dimension.productId) return total;
      if (dimension.staffId !== undefined && count.staffId !== dimension.staffId) return total;
      return total + count.bookedCount;
    }, 0);
    if (booked < slot.maxBookings) available.push(slot.hour);
  }
  return available.sort((left, right) => left - right);
}
