import { describe, expect, it } from "vitest";
import { databaseWeekdayIndex, formatLocalDateOnly, parseLocalDateOnly } from "@hanbang/shared";

describe("local date and vendor weekday contract", () => {
  it("formats local midnight without converting through UTC", () => {
    expect(formatLocalDateOnly(new Date(2026, 6, 11, 0, 30))).toBe("2026-07-11");
  });

  it("parses valid date-only values in local time and rejects rollover dates", () => {
    expect(parseLocalDateOnly("2026-07-11")?.getDate()).toBe(11);
    expect(parseLocalDateOnly("2026-02-30")).toBeNull();
  });

  it("maps JavaScript Sunday-first weekdays to the database Monday-first contract", () => {
    expect(databaseWeekdayIndex(new Date(2026, 6, 6))).toBe(0);
    expect(databaseWeekdayIndex(new Date(2026, 6, 12))).toBe(6);
  });
});
