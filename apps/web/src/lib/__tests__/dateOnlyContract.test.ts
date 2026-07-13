import { describe, expect, it } from "vitest";
import {
  databaseWeekdayIndex,
  differenceInDateOnlyDays,
  formatLocalDateOnly,
  isLocalDateOnlyBefore,
  nextLocalDateForDatabaseWeekday,
  parseLocalDateOnly,
} from "@hanbang/shared";

describe("local date and vendor weekday contract", () => {
  it("formats local midnight without converting through UTC", () => {
    expect(formatLocalDateOnly(new Date(2026, 6, 11, 0, 30))).toBe("2026-07-11");
  });

  it("parses valid date-only values in local time and rejects rollover dates", () => {
    expect(parseLocalDateOnly("2026-07-11")?.getDate()).toBe(11);
    expect(parseLocalDateOnly("2026-02-30")).toBeNull();
  });

  it("compares calendar days without timezone drift", () => {
    expect(differenceInDateOnlyDays("2026-07-12", "2026-07-11")).toBe(1);
    expect(differenceInDateOnlyDays("2026-07-10", "2026-07-11")).toBe(-1);
    expect(differenceInDateOnlyDays("2026-02-30", "2026-02-01")).toBeNull();
  });

  it("maps JavaScript Sunday-first weekdays to the database Monday-first contract", () => {
    expect(databaseWeekdayIndex(new Date(2026, 6, 6))).toBe(0);
    expect(databaseWeekdayIndex(new Date(2026, 6, 12))).toBe(6);
  });

  it("turns a weekday choice into an explicit strictly-future local date", () => {
    const saturday = new Date(2026, 6, 11, 23, 30);
    expect(formatLocalDateOnly(nextLocalDateForDatabaseWeekday(5, saturday)!)).toBe("2026-07-18");
    expect(formatLocalDateOnly(nextLocalDateForDatabaseWeekday(0, saturday)!)).toBe("2026-07-13");
  });

  it("keeps the whole local day upcoming until the calendar day changes", () => {
    const afternoon = new Date(2026, 6, 11, 18, 0);
    expect(isLocalDateOnlyBefore("2026-07-11", afternoon)).toBe(false);
    expect(isLocalDateOnlyBefore("2026-07-10", afternoon)).toBe(true);
  });
});
