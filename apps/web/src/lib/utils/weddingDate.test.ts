// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  daysUntilWedding,
  formatWeddingDate,
  normalizeWeddingDate,
} from "./weddingDate";

describe("weddingDate", () => {
  const today = new Date("2027-05-01T00:00:00+09:00");

  it("calculates D-day from KST midnights", () => {
    expect(daysUntilWedding("2027-05-15", today)).toBe(14);
    expect(daysUntilWedding("2027-05-01", today)).toBe(0);
  });

  it("rejects invalid and rollover dates", () => {
    expect(daysUntilWedding("2027-02-29", today)).toBeNull();
    expect(normalizeWeddingDate("2027-13-01")).toBe("");
    expect(normalizeWeddingDate(["2027-05-15"])).toBe("");
  });

  it("formats a valid wedding date in Korean", () => {
    expect(formatWeddingDate("2027-05-15")).toBe("2027년 5월 15일 토요일");
  });
});

import {formatCalendarDate} from "./weddingDate";
it.each(["2027-02-20","2028-02-29","0099-02-20"])("calendar display preserves valid stored date %s",value=>{const parts=value.split("-").map(Number);expect(formatCalendarDate(value,{year:"numeric",month:"numeric",day:"numeric"})).toBe(parts[0]+". "+parts[1]+". "+parts[2]+".");});
it.each([null,undefined,"2027-02-29","2027-02-20T00:00:00Z","not-a-date"])("calendar display refuses noncanonical date %s",value=>{expect(formatCalendarDate(value,{month:"long",day:"numeric"})).toBeNull();});
