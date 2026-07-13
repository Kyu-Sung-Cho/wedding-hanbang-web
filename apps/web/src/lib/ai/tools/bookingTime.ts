/** Normalize PostgreSQL TIME text (HH:mm:ss[.fraction]) to the hourly slot key. */
export function normalizeBookingTimeForSlot(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d{1,6})?)?$/.exec(value.trim());
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
}

export function bookingSlotCountKey(date: unknown, time: unknown): string | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const normalizedTime = normalizeBookingTimeForSlot(time);
  return normalizedTime ? `${date}:${normalizedTime}` : null;
}
