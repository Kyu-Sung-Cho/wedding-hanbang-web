import { describe, expect, it } from "vitest";
import {
  addEvent,
  getEvents,
  isValidScheduleYmd,
  MAX_SCHEDULE_EVENTS,
  ScheduleEventCapacityError,
  ScheduleEventValidationError,
  sanitizeUserFacingScheduleMemo,
  upsertMomentEvent,
} from "../scheduleEvents";

function validEvent(index: number) {
  return {
    id: `event-${index}`,
    date: "2026-07-17",
    title: `일정 ${index}`,
    momentType: "dress",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("getEvents", () => {
  it("accepts only real Gregorian YYYY-MM-DD dates", () => {
    expect(isValidScheduleYmd("2028-02-29")).toBe(true);
    expect(isValidScheduleYmd("2000-02-29")).toBe(true);
    expect(isValidScheduleYmd("1900-02-29")).toBe(false);
    expect(isValidScheduleYmd("2027-02-29")).toBe(false);
    expect(isValidScheduleYmd("2027-02-31")).toBe(false);
    expect(isValidScheduleYmd("2027-04-31")).toBe(false);
    expect(isValidScheduleYmd("0000-01-01")).toBe(false);
    expect(isValidScheduleYmd("2027-2-01")).toBe(false);
  });

  it("fails closed when the reserved event slot is not an array", () => {
    expect(getEvents({ __events: { poisoned: true } })).toEqual([]);
    expect(getEvents({ __events: "poisoned" })).toEqual([]);
  });

  it("filters non-records and malformed date or momentType fields", () => {
    const valid = validEvent(1);
    expect(getEvents({
      __events: [
        null,
        "not-an-event",
        { ...valid, date: "2026-02-31" },
        { ...valid, momentType: 123 },
        valid,
      ],
    })).toEqual([valid]);
  });

  it("requires every durable field and bounds optional fields", () => {
    const valid = validEvent(2);
    expect(getEvents({
      __events: [
        { ...valid, id: "" },
        { ...valid, title: "   " },
        { ...valid, createdAt: undefined },
        { ...valid, updatedAt: "not-a-timestamp" },
        { ...valid, memo: "m".repeat(2_001) },
        { ...valid, categoryKey: null },
        { ...valid, sourceKey: "s".repeat(201) },
        valid,
      ],
    })).toEqual([valid]);
  });

  it("bounds attacker-controlled event arrays", () => {
    const events = Array.from(
      { length: MAX_SCHEDULE_EVENTS + 20 },
      (_, index) => validEvent(index),
    );
    expect(getEvents({ __events: events })).toHaveLength(MAX_SCHEDULE_EVENTS);
  });

  it("refuses a new event at the durable 500-event boundary", () => {
    const events = Array.from(
      { length: MAX_SCHEDULE_EVENTS },
      (_, index) => validEvent(index),
    );

    expect(() => addEvent(
      { __events: events },
      { date: "2026-07-18", title: "One too many" },
    )).toThrow(ScheduleEventCapacityError);
    expect(events).toHaveLength(MAX_SCHEDULE_EVENTS);
  });

  it("refuses to mutate an already over-cap array instead of truncating unseen events", () => {
    const events = Array.from(
      { length: MAX_SCHEDULE_EVENTS + 1 },
      (_, index) => ({
        ...validEvent(index),
        ...(index === 0 ? { momentType: "dress_tour", date: "2027-05-01" } : {}),
      }),
    );

    expect(() => upsertMomentEvent(
      { __events: events },
      { momentType: "dress_tour", date: "2027-05-01", title: "Updated" },
    )).toThrow(ScheduleEventCapacityError);
  });

  it.each([
    [{ date: "2027-02-29", title: "Invalid date" }, "date"],
    [{ date: "2027-05-01", title: "   " }, "title"],
    [{ date: "2027-05-01", title: "Valid", memo: "m".repeat(2_001) }, "memo"],
    [{ date: "2027-05-01", title: "Valid", categoryKey: "c".repeat(101) }, "categoryKey"],
  ] as const)("refuses an invalid event draft field: %s", (draft, field) => {
    expect(() => addEvent({}, draft)).toThrow(
      expect.objectContaining<Partial<ScheduleEventValidationError>>({ field }),
    );
  });
});

describe("sanitizeUserFacingScheduleMemo", () => {
  it("removes a legacy booking id while preserving the useful amount", () => {
    expect(sanitizeUserFacingScheduleMemo(
      "예약 자동 등록 · booking 018f4dc8 · 15,000원",
    )).toBe("예약 자동 등록 · 15,000원");
  });

  it("removes a full legacy UUID when there is no suffix", () => {
    expect(sanitizeUserFacingScheduleMemo(
      "예약 자동 등록 · booking 018f4dc8-0ac2-7df5-9f5d-2e8fd1c43b21",
    )).toBe("예약 자동 등록");
  });

  it.each([
    undefined,
    "예약 자동 등록 · 담당자에게 확인",
    "booking 018f4dc8 관련 메모",
    "예약 자동 등록 · booking reference 확인",
  ])("does not rewrite unrelated memo text: %s", (memo) => {
    expect(sanitizeUserFacingScheduleMemo(memo)).toBe(memo);
  });
});
