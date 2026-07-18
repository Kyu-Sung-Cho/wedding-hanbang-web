import type { SupabaseClient } from "@supabase/supabase-js";

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;
export const MAX_PUBLIC_AVAILABILITY_DAYS = 14;
const BOOKING_PAGE_SIZE = 500;
const MAX_BOOKINGS_PER_PUBLIC_RANGE = 5_000;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BOOKING_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/;

export type BookingOccupancyRow = {
  booking_date: string;
  booking_time: string;
  product_id: string | null;
  staff_id: string | null;
};

export type BookingOccupancyCount = {
  date: string;
  time: string;
  productId: string | null;
  staffId: string | null;
  bookedCount: number;
};

export class AvailabilityInputError extends Error {
  constructor(message = "INVALID_AVAILABILITY_RANGE") {
    super(message);
    this.name = "AvailabilityInputError";
  }
}

export class AvailabilityUnavailableError extends Error {
  constructor(message = "BOOKING_AVAILABILITY_UNAVAILABLE") {
    super(message);
    this.name = "AvailabilityUnavailableError";
  }
}

export class AvailabilityVendorNotFoundError extends Error {
  constructor() {
    super("AVAILABILITY_VENDOR_NOT_FOUND");
    this.name = "AvailabilityVendorNotFoundError";
  }
}

function utcDateString(date: Date): string {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function addCalendarDays(date: string, days: number): string {
  const midnight = new Date(`${date}T00:00:00.000Z`);
  midnight.setUTCDate(midnight.getUTCDate() + days);
  return utcDateString(midnight);
}

export function databaseWeekday(date: string): number {
  if (!ISO_DATE_PATTERN.test(date)) {
    throw new Error("INVALID_AVAILABILITY_DATE");
  }
  const midnight = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(midnight.getTime()) || utcDateString(midnight) !== date) {
    throw new Error("INVALID_AVAILABILITY_DATE");
  }
  return (midnight.getUTCDay() + 6) % 7;
}

export function kstDateAt(instant: Date): string {
  return utcDateString(new Date(instant.getTime() + KST_OFFSET_MS));
}

export function buildKstDateWindow(
  instant: Date,
  length: number,
): Array<{ date: string; day: number }> {
  if (!Number.isSafeInteger(length) || length < 1 || length > MAX_PUBLIC_AVAILABILITY_DAYS) {
    throw new Error("INVALID_AVAILABILITY_RANGE");
  }
  const start = kstDateAt(instant);
  return Array.from({ length }, (_, index) => {
    const date = addCalendarDays(start, index);
    return { date, day: databaseWeekday(date) };
  });
}

function calendarDayNumber(date: string): number {
  databaseWeekday(date);
  return Math.floor(new Date(`${date}T00:00:00.000Z`).getTime() / 86_400_000);
}

export function parseAvailabilityRange(
  searchParams: URLSearchParams,
  now: Date = new Date(),
): { from: string; to: string } {
  const fromValues = searchParams.getAll("from");
  const toValues = searchParams.getAll("to");
  if (fromValues.length !== 1 || toValues.length !== 1) {
    throw new AvailabilityInputError();
  }
  const [from] = fromValues;
  const [to] = toValues;
  let fromDay: number;
  let toDay: number;
  try {
    fromDay = calendarDayNumber(from);
    toDay = calendarDayNumber(to);
  } catch {
    throw new AvailabilityInputError();
  }
  const today = calendarDayNumber(kstDateAt(now));
  const length = toDay - fromDay + 1;
  if (
    fromDay < today
    || length < 1
    || length > MAX_PUBLIC_AVAILABILITY_DAYS
  ) {
    throw new AvailabilityInputError();
  }
  return { from, to };
}

function normalizedBookingHour(value: string): string {
  const match = BOOKING_TIME_PATTERN.exec(value);
  if (!match) throw new Error("INVALID_BOOKING_OCCUPANCY_ROW");
  return `${match[1]}:00`;
}

export function aggregateBookingOccupancy<T extends BookingOccupancyRow>(
  rows: readonly T[],
): BookingOccupancyCount[] {
  const grouped = new Map<string, BookingOccupancyCount>();
  for (const row of rows) {
    databaseWeekday(row.booking_date);
    if (
      (row.product_id !== null && typeof row.product_id !== "string")
      || (row.staff_id !== null && typeof row.staff_id !== "string")
    ) {
      throw new Error("INVALID_BOOKING_OCCUPANCY_ROW");
    }
    const time = normalizedBookingHour(row.booking_time);
    const key = [row.booking_date, time, row.product_id ?? "", row.staff_id ?? ""].join("\0");
    const existing = grouped.get(key);
    if (existing) {
      existing.bookedCount += 1;
      continue;
    }
    grouped.set(key, {
      date: row.booking_date,
      time,
      productId: row.product_id,
      staffId: row.staff_id,
      bookedCount: 1,
    });
  }
  return [...grouped.values()].sort((left, right) =>
    left.date.localeCompare(right.date)
    || left.time.localeCompare(right.time)
    || (left.productId ?? "").localeCompare(right.productId ?? "")
    || (left.staffId ?? "").localeCompare(right.staffId ?? "")
  );
}

export function bookingCountAt(
  counts: readonly BookingOccupancyCount[],
  input: {
    date: string;
    hour: number;
    productId?: string;
    staffId?: string;
  },
): number {
  const time = `${String(input.hour).padStart(2, "0")}:00`;
  return counts.reduce((total, row) => {
    if (row.date !== input.date || row.time !== time) return total;
    if (input.productId !== undefined && row.productId !== input.productId) return total;
    if (input.staffId !== undefined && row.staffId !== input.staffId) return total;
    return total + row.bookedCount;
  }, 0);
}

type BookingOccupancyPage = {
  data: BookingOccupancyRow[] | null;
  error: unknown;
};

export async function collectBookingOccupancyPages(
  fetchPage: (from: number, to: number) => Promise<BookingOccupancyPage>,
): Promise<BookingOccupancyRow[]> {
  const rows: BookingOccupancyRow[] = [];
  let from = 0;
  while (true) {
    const remaining = MAX_BOOKINGS_PER_PUBLIC_RANGE - rows.length;
    const requested = remaining > 0 ? Math.min(BOOKING_PAGE_SIZE, remaining) : 1;
    const page = await fetchPage(from, from + requested - 1);
    if (page.error || page.data === null) throw new AvailabilityUnavailableError();
    const pageRows = page.data;
    if (remaining === 0) {
      if (pageRows.length > 0) {
        throw new AvailabilityUnavailableError("BOOKING_AVAILABILITY_ROW_LIMIT");
      }
      return rows;
    }
    if (pageRows.length > requested) {
      throw new AvailabilityUnavailableError("BOOKING_AVAILABILITY_ROW_LIMIT");
    }
    if (pageRows.length === 0) return rows;
    rows.push(...pageRows);
    from += pageRows.length;
  }
}

export async function loadPublicBookingAvailability(
  client: SupabaseClient,
  vendorId: string,
  range: { from: string; to: string },
): Promise<BookingOccupancyCount[]> {
  const vendorResult = await client
    .from("vendors")
    .select("id")
    .eq("id", vendorId)
    .eq("status", "approved")
    .maybeSingle();
  if (vendorResult.error) throw new AvailabilityUnavailableError();
  if (!vendorResult.data) throw new AvailabilityVendorNotFoundError();

  const rows = await collectBookingOccupancyPages(async (from, to) => {
    const result = await client
      .from("vendor_bookings")
      .select("id,booking_date,booking_time,product_id,staff_id")
      .eq("vendor_id", vendorId)
      .gte("booking_date", range.from)
      .lte("booking_date", range.to)
      .or("status.is.null,status.neq.cancelled")
      .order("id", { ascending: true })
      .range(from, to);
    return {
      data: (result.data ?? null) as BookingOccupancyRow[] | null,
      error: result.error,
    };
  });

  try {
    return aggregateBookingOccupancy(rows);
  } catch {
    throw new AvailabilityUnavailableError();
  }
}
