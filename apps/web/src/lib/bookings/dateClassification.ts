const BOOKING_DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const SEOUL_UTC_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1000;

function normalizeBookingDateKey(value: string): string | null {
  const match = BOOKING_DATE_KEY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return value;
}

export function getSeoulDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function millisecondsUntilNextSeoulDate(now: Date): number {
  const shiftedTime = now.getTime() + SEOUL_UTC_OFFSET_MILLISECONDS;
  const elapsedInSeoulDate = (
    (shiftedTime % MILLISECONDS_PER_DAY) + MILLISECONDS_PER_DAY
  ) % MILLISECONDS_PER_DAY;
  return MILLISECONDS_PER_DAY - elapsedInSeoulDate;
}

export function scheduleSeoulDateRollover(
  onRollover: (now: Date) => void,
): () => void {
  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const scheduleNext = () => {
    timeout = setTimeout(() => {
      if (stopped) return;
      const rolloverTime = new Date();
      try {
        onRollover(rolloverTime);
      } finally {
        if (!stopped) scheduleNext();
      }
    }, millisecondsUntilNextSeoulDate(new Date()));
  };

  scheduleNext();
  return () => {
    stopped = true;
    if (timeout !== undefined) clearTimeout(timeout);
  };
}

export function classifyBookingDate({
  bookingDate,
  status,
  now = new Date(),
}: {
  bookingDate: string;
  status: string;
  now?: Date;
}): "upcoming" | "past" {
  if (TERMINAL_STATUSES.has(status)) return "past";
  const dateKey = normalizeBookingDateKey(bookingDate);
  // Keep malformed active records visible in the action-oriented section so a
  // bad legacy date cannot silently hide a request record.
  if (dateKey === null) return "upcoming";
  return dateKey >= getSeoulDateKey(now) ? "upcoming" : "past";
}

export function formatBookingDate(value: string): string {
  const dateKey = normalizeBookingDateKey(value);
  if (dateKey === null) return "날짜 확인 필요";
  const [year, month, day] = dateKey.split("-").map(Number);
  return `${year}. ${month}. ${day}.`;
}
