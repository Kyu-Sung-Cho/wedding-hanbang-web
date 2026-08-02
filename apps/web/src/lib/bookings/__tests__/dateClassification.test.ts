import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyBookingDate,
  getSeoulDateKey,
  scheduleSeoulDateRollover,
} from "@/lib/bookings/dateClassification";

afterEach(() => {
  vi.useRealTimers();
});

describe("booking date-only classification", () => {
  it("keeps a same-day evening booking upcoming after 09:00 in Korea", () => {
    const now = new Date("2026-08-02T12:00:00+09:00");

    expect(getSeoulDateKey(now)).toBe("2026-08-02");
    expect(classifyBookingDate({
      bookingDate: "2026-08-02",
      status: "confirmed",
      now,
    })).toBe("upcoming");
  });

  it("uses Korea's calendar date even when the server process runs in UTC", () => {
    const now = new Date("2026-08-01T15:30:00.000Z");

    expect(getSeoulDateKey(now)).toBe("2026-08-02");
    expect(classifyBookingDate({
      bookingDate: "2026-08-01",
      status: "pending",
      now,
    })).toBe("past");
  });

  it("keeps terminal status authoritative and fail-opens malformed active dates to visible", () => {
    const now = new Date("2026-08-02T12:00:00+09:00");

    expect(classifyBookingDate({
      bookingDate: "2026-08-10",
      status: "cancelled",
      now,
    })).toBe("past");
    expect(classifyBookingDate({
      bookingDate: "not-a-date",
      status: "pending",
      now,
    })).toBe("upcoming");
  });

  it("reclassifies an open booking view exactly when Seoul reaches the next calendar day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T14:59:59.500Z"));
    let classificationTime = new Date();
    const stop = scheduleSeoulDateRollover((now) => {
      classificationTime = now;
    });

    expect(classifyBookingDate({
      bookingDate: "2026-08-02",
      status: "confirmed",
      now: classificationTime,
    })).toBe("upcoming");

    vi.advanceTimersByTime(499);
    expect(classifyBookingDate({
      bookingDate: "2026-08-02",
      status: "confirmed",
      now: classificationTime,
    })).toBe("upcoming");

    vi.advanceTimersByTime(1);
    expect(classifyBookingDate({
      bookingDate: "2026-08-02",
      status: "confirmed",
      now: classificationTime,
    })).toBe("past");

    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
