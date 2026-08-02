import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  aggregateBookingOccupancy,
  AvailabilityInputError,
  bookingCountAt,
  buildKstDateWindow,
  collectBookingOccupancyPages,
  databaseWeekday,
  parseAvailabilityRange,
  toPublicBookingSlots,
} from "../bookingAvailability";

describe("public booking availability dates", () => {
  it("uses the KST calendar date and Monday-zero weekday across KST midnight", () => {
    expect(buildKstDateWindow(new Date("2026-07-18T14:59:59.000Z"), 2)).toEqual([
      { date: "2026-07-18", day: 5 },
      { date: "2026-07-19", day: 6 },
    ]);
    expect(buildKstDateWindow(new Date("2026-07-18T15:00:00.000Z"), 2)).toEqual([
      { date: "2026-07-19", day: 6 },
      { date: "2026-07-20", day: 0 },
    ]);
    expect(databaseWeekday("2026-07-20")).toBe(0);
  });

  it("counts every customer's occupancy but returns no customer or booking identifier", () => {
    const counts = aggregateBookingOccupancy([
      {
        id: "booking-a",
        couple_id: "couple-a",
        booking_date: "2026-07-20",
        booking_time: "10:00:00",
        product_id: "11111111-1111-4111-8111-111111111111",
        staff_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      {
        id: "booking-b",
        couple_id: "couple-b",
        booking_date: "2026-07-20",
        booking_time: "10:00:00",
        product_id: "11111111-1111-4111-8111-111111111111",
        staff_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      {
        id: "booking-c",
        couple_id: "couple-c",
        booking_date: "2026-07-20",
        booking_time: "10:00:00",
        product_id: "22222222-2222-4222-8222-222222222222",
        staff_id: null,
      },
    ]);

    expect(bookingCountAt(counts, {
      date: "2026-07-20",
      hour: 10,
    })).toBe(3);
    expect(bookingCountAt(counts, {
      date: "2026-07-20",
      hour: 10,
      productId: "11111111-1111-4111-8111-111111111111",
    })).toBe(2);
    expect(bookingCountAt(counts, {
      date: "2026-07-20",
      hour: 10,
      staffId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    })).toBe(2);
    expect(counts).toEqual([
      {
        date: "2026-07-20",
        time: "10:00",
        productId: "11111111-1111-4111-8111-111111111111",
        staffId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        bookedCount: 2,
      },
      {
        date: "2026-07-20",
        time: "10:00",
        productId: "22222222-2222-4222-8222-222222222222",
        staffId: null,
        bookedCount: 1,
      },
    ]);
    expect(JSON.stringify(counts)).not.toMatch(/booking-|couple-/);
  });

  it("accepts at most fourteen KST calendar days and rejects a date that became yesterday", () => {
    const kstMidnight = new Date("2026-07-18T15:00:00.000Z");

    expect(parseAvailabilityRange(
      new URLSearchParams("from=2026-07-19&to=2026-08-01"),
      kstMidnight,
    )).toEqual({ from: "2026-07-19", to: "2026-08-01" });
    expect(() => parseAvailabilityRange(
      new URLSearchParams("from=2026-07-19&to=2026-08-02"),
      kstMidnight,
    )).toThrow(AvailabilityInputError);
    expect(() => parseAvailabilityRange(
      new URLSearchParams("from=2026-07-18&to=2026-07-18"),
      kstMidnight,
    )).toThrow(AvailabilityInputError);
  });

  it("paginates the complete bounded booking range instead of accepting a truncated first page", async () => {
    const rows = Array.from({ length: 1_001 }, () => ({
      booking_date: "2026-07-20",
      booking_time: "10:00:00",
      product_id: null,
      staff_id: null,
    }));
    const ranges: Array<[number, number]> = [];

    const result = await collectBookingOccupancyPages(async (from, to) => {
      ranges.push([from, to]);
      return {
        data: rows.slice(from, Math.min(to + 1, from + 300)),
        error: null,
      };
    });

    expect(result).toHaveLength(1_001);
    expect(ranges).toEqual([
      [0, 499],
      [300, 799],
      [600, 1_099],
      [900, 1_399],
      [1_001, 1_500],
    ]);
  });

  it("keeps raw booking reads out of customer-scoped vendor routes", () => {
    const routes = [
      "src/app/api/vendors/[id]/route.ts",
      "src/app/api/vendors/[id]/staff/route.ts",
    ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));

    for (const route of routes) {
      expect(route).not.toContain('.from("vendor_bookings")');
      expect(route).toContain("loadPublicBookingAvailability");
      expect(route).toContain("BOOKING_AVAILABILITY_UNAVAILABLE");
    }
  });

  it("reduces internal capacity and occupancy to a fail-closed availability flag", () => {
    const publicSlots = toPublicBookingSlots([
      { day: 0, hour: 10, available: true, max_bookings: 3, current_bookings: 2 },
      { day: 0, hour: 11, available: true, max_bookings: 1, current_bookings: 1 },
      { day: 0, hour: 12, available: false, max_bookings: 5, current_bookings: 0 },
      { day: 9, hour: 12, available: true, max_bookings: 5, current_bookings: 0 },
    ]);

    expect(publicSlots).toEqual([
      { day: 0, hour: 10, available: true },
      { day: 0, hour: 11, available: false },
      { day: 0, hour: 12, available: false },
    ]);
    expect(JSON.stringify(publicSlots)).not.toMatch(/max_bookings|current_bookings|bookedCount/);
  });
});
