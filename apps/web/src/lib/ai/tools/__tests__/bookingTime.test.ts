import { describe, expect, it } from "vitest";
import {
  bookingSlotCountKey,
  normalizeBookingTimeForSlot,
} from "../bookingTime";

describe("PostgreSQL booking time normalization", () => {
  it("matches DB TIME seconds to the hourly UI/tool key", () => {
    expect(normalizeBookingTimeForSlot("10:00:00")).toBe("10:00");
    expect(normalizeBookingTimeForSlot("10:00:00.000000")).toBe("10:00");
    expect(bookingSlotCountKey("2026-07-13", "10:00:00")).toBe(
      "2026-07-13:10:00"
    );
  });

  it("rejects malformed dates and times rather than counting the wrong slot", () => {
    expect(bookingSlotCountKey("2026-7-13", "10:00:00")).toBeNull();
    expect(bookingSlotCountKey("2026-07-13", "25:00:00")).toBeNull();
    expect(normalizeBookingTimeForSlot(null)).toBeNull();
  });
});
