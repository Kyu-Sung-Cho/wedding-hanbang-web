// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EMPTY_INVITATION_CONDITIONS,
  INVITATION_REGIONS,
  conditionsSummary,
  isInvitationRegion,
  missingConditions,
  normalizeInvitationRegion,
  parseGuestCount,
  parseInvitationConditions,
  type InvitationConditions,
} from "@hanbang/shared/invitation";
import { describe, expect, it } from "vitest";
import { conditionsChangeSummary, mergeConditions, parseConditionsPatch } from "../conditionsInput";
import { journeyPlanSummary, parseJourneyPlanInput } from "../journeyPlanInput";

const TODAY = "2026-11-17";

describe("wedding conditions (W1) boundary", () => {
  it("accepts the artifact's first chat answers and keeps unsent fields", () => {
    const parsed = parseConditionsPatch({ hopedYear: 2027, hopedMonth: 5, region: " 서울 ", guestCount: 200, timeLabel: "토요일 낮", startStage: "start" }, TODAY);
    expect(parsed).toEqual({
      ok: true,
      patch: { hopedYear: 2027, hopedMonth: 5, region: "서울", guestCount: 200, timeLabel: "토요일 낮", startStage: "start" },
    });
    const merged = mergeConditions({ ...EMPTY_INVITATION_CONDITIONS, region: "부산" }, { guestCount: 150 });
    expect(merged).toMatchObject({ region: "부산", guestCount: 150 });
  });

  it.each([
    [{ unknown: 1 }, "body"],
    [{}, "body"],
    [{ hopedYear: 2027 }, "hopedMonth"],
    [{ hopedYear: 2026, hopedMonth: 10 }, "hopedMonth"],
    [{ hopedYear: 2032, hopedMonth: 1 }, "hopedMonth"],
    [{ hopedYear: 2027, hopedMonth: 13 }, "hopedMonth"],
    [{ hopedYear: 2027.5, hopedMonth: 5 }, "hopedMonth"],
    [{ region: "서".repeat(21) }, "region"],
    [{ region: "서울​" }, "region"],
    [{ region: "서울 마포구" }, "region"],
    [{ region: "광주시" }, "region"],
    [{ region: 11 }, "region"],
    [{ guestCount: 0 }, "guestCount"],
    [{ guestCount: 2001 }, "guestCount"],
    [{ guestCount: "150~200명" }, "guestCount"],
    [{ guestCount: "이백 명" }, "guestCount"],
    [{ guestCount: 200.5 }, "guestCount"],
    [{ timeLabel: "" }, "timeLabel"],
    [{ startStage: "doing" }, "startStage"],
  ])("rejects %j at %s", (body, field) => {
    const parsed = parseConditionsPatch(body, TODAY);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.field).toBe(field);
  });

  it("stores only the canonical region name and reads guest counts written as one number", () => {
    expect(parseConditionsPatch({ region: "서울특별시", guestCount: "약 200명" }, TODAY))
      .toEqual({ ok: true, patch: { region: "서울", guestCount: 200 } });
    expect(parseConditionsPatch({ region: "전라북도", guestCount: "1,200명 정도" }, TODAY))
      .toEqual({ ok: true, patch: { region: "전북", guestCount: 1200 } });
  });

  it("lets null clear a field and allows the current month", () => {
    expect(parseConditionsPatch({ hopedYear: null, hopedMonth: null, region: null }, TODAY))
      .toEqual({ ok: true, patch: { hopedYear: null, hopedMonth: null, region: null } });
    expect(parseConditionsPatch({ hopedYear: 2026, hopedMonth: 11 }, TODAY).ok).toBe(true);
  });

  it("summarises only complete conditions and never invents a month", () => {
    const full: InvitationConditions = { ...EMPTY_INVITATION_CONDITIONS, hopedYear: 2027, hopedMonth: 5, region: "서울", guestCount: 200 };
    expect(conditionsSummary(full, null)).toBe("2027년 5월, 서울, 200명");
    expect(conditionsSummary({ ...full, guestCount: null }, null)).toBeNull();
    expect(missingConditions({ ...EMPTY_INVITATION_CONDITIONS, region: "서울" }, null)).toEqual(["month", "guests"]);
    expect(missingConditions({ ...EMPTY_INVITATION_CONDITIONS, region: "서울", guestCount: 80 }, "2027-04-10")).toEqual([]);
    expect(conditionsSummary({ ...full, hopedYear: null, hopedMonth: null }, "2027-04-10")).toBe("2027년 4월, 서울, 200명");
    expect(conditionsChangeSummary(full)).toBe("결혼 조건: 2027년 5월, 서울, 하객 200명");
  });

  it("reads stored conditions leniently and drops half a date", () => {
    expect(parseInvitationConditions({ hopedYear: 2027, region: "서울", guestCount: -3, startStage: "booked" }))
      .toEqual({ ...EMPTY_INVITATION_CONDITIONS, region: "서울", startStage: "booked" });
    expect(parseInvitationConditions({ region: "서울 마포구" }).region).toBeNull();
    expect(parseInvitationConditions({ region: "경기도" }).region).toBe("경기");
    expect(parseInvitationConditions("broken")).toEqual(EMPTY_INVITATION_CONDITIONS);
  });
});

describe("canonical regions and guest counts", () => {
  it("keeps one list of 17 short province names that the database check repeats exactly", () => {
    expect(INVITATION_REGIONS).toHaveLength(17);
    expect(new Set(INVITATION_REGIONS).size).toBe(17);
    const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20261117090000_hall_listings_and_inquiries.sql"), "utf8");
    const check = /CONSTRAINT hall_listings_region_check CHECK \(\s*region IN \(([^)]*)\)\s*\)/.exec(sql)?.[1] ?? "";
    expect([...check.matchAll(/'([^']*)'/g)].map((match) => match[1])).toEqual([...INVITATION_REGIONS]);
  });

  it.each([
    ["서울", "서울"], [" 서울 ", "서울"], ["서울특별시", "서울"], ["서울 특별시", "서울"], ["경기도", "경기"],
    ["강원도", "강원"], ["강원특별자치도", "강원"], ["전북특별자치도", "전북"], ["제주특별자치도", "제주"], ["세종시", "세종"],
    ["광주광역시", "광주"], ["광주시", null], ["마포구", null], ["서울​", null], ["Seoul", null], [null, null],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeInvitationRegion(input)).toBe(expected);
    if (expected) expect(isInvitationRegion(expected)).toBe(true);
  });

  it.each([
    [200, 200], ["200", 200], ["200명", 200], [" 약 200 명 ", 200], ["1,200명", 1200], ["200명 정도", 200],
    ["２００명", 200], ["150명 내외", 150], [2000, 2000],
    [0, null], [2001, null], ["2,001명", null], ["150~200명", null], ["150-200", null], ["1,20명", null],
    ["이백 명", null], ["200명이요", null], [200.5, null], [Number.NaN, null], [null, null], [[200], null],
  ])("reads guest count %j as %j", (input, expected) => {
    expect(parseGuestCount(input)).toBe(expected);
  });
});

describe("journey plan boundary", () => {
  it("accepts optional stages and add-ons, refuses required stages and unknown keys", () => {
    expect(parseJourneyPlanInput({ off: ["honeymoon"], addOns: ["rings"] })).toEqual({ ok: true, plan: { off: ["honeymoon"], addOns: ["rings"] } });
    expect(parseJourneyPlanInput({ off: ["venue"], addOns: [] }).ok).toBe(false);
    expect(parseJourneyPlanInput({ off: [], addOns: ["car"] }).ok).toBe(false);
    expect(parseJourneyPlanInput({ off: [], addOns: [], extra: true }).ok).toBe(false);
    expect(journeyPlanSummary({ off: ["families", "honeymoon"], addOns: ["home"] })).toBe("준비 순서: 첫인사와 상견례, 신혼여행 뺌, 신혼집 준비 넣음");
    expect(journeyPlanSummary({ off: [], addOns: [] })).toBe("준비 순서: 기본 순서로 되돌림");
  });
});
