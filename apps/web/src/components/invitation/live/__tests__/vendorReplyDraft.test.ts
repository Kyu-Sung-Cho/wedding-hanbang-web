import { describe, expect, it } from "vitest";
import { readVendorReply } from "@hanbang/shared/invitation";

import {
  chipIsChosen,
  draftWithChip,
  draftWithMeridiem,
  foundAnyValue,
  hasWeekdayMismatch,
  initialPasteDraft,
  isSchedulableChip,
  pasteScheduleBody,
  type PasteDraft,
  type SchedulableChip,
} from "../vendorReplyDraft";
import { HALL_A, HALL_B, REPLY_PASTE } from "./liveFixtures";

/**
 * 받은 답 붙여 넣기(D-83 1단계)의 일정 칸. 칩은 칸에 옮기기만 하고, 짐작한 시간은 오전·오후를 고르기 전에는 보내지
 * 않으며, 요청 본문은 홀·날짜·시간 세 칸뿐인지 잰다. 칩은 실제 읽기(`readVendorReply`)가 만든 것을 쓴다.
 */

const TODAY = "2026-11-18";
const EMPTY: PasteDraft = { hallId: null, date: "", time: "", noTime: false, meridiemPending: false, timeIncomplete: false };

function chipsOf(reply: string): SchedulableChip[] {
  return readVendorReply(reply, { todayYmd: TODAY }).chips.filter(isSchedulableChip);
}

describe("initialPasteDraft", () => {
  it("고를 웨딩홀이 하나면 미리 고르고, 여럿이거나 없으면 고르지 않는다. 날짜·시간은 비워 둔다", () => {
    expect(initialPasteDraft([REPLY_PASTE.halls[0]])).toEqual({ ...EMPTY, hallId: HALL_A });
    expect(initialPasteDraft(REPLY_PASTE.halls)).toEqual(EMPTY);
    expect(initialPasteDraft([])).toEqual(EMPTY);
  });
});

describe("draftWithChip · chipIsChosen", () => {
  it("날짜와 시간이 함께 적힌 칩은 둘 다 옮기고, 업체가 오후라고 적었으면 묻지 않는다", () => {
    const [chip] = chipsOf("2026년 11월 30일 (월) 오후 2시 상담 가능합니다.");
    const draft = draftWithChip({ ...EMPTY, hallId: HALL_B, noTime: true }, chip);
    expect(draft).toEqual({ hallId: HALL_B, date: "2026-11-30", time: "14:00", noTime: false, meridiemPending: false, timeIncomplete: false });
    expect(chipIsChosen(draft, chip)).toBe(true);
  });

  it("시간이 든 칩은 시간 칸을 끝까지 채우므로 덜 고른 시간을 지운다. 날짜만 든 칩은 시간 칸을 건드리지 않아 그대로 둔다", () => {
    // 칩 모양만 보는 시험이라 읽기(`readVendorReply`)를 거치지 않고 칩을 바로 만든다.
    const date: SchedulableChip = { kind: "date", ymd: "2026-12-05", weekdayMismatch: false, label: "12/5", quote: "12/5" };
    const time: SchedulableChip = { kind: "time", time: "11:30", meridiemGuessed: false, label: "11:30", quote: "11:30" };
    const datetime: SchedulableChip = {
      kind: "datetime",
      ymd: "2026-11-30",
      time: "14:00",
      meridiemGuessed: false,
      weekdayMismatch: false,
      label: "11/30 14:00",
      quote: "11/30 14:00",
    };
    const half = { ...EMPTY, timeIncomplete: true };
    expect(draftWithChip(half, time)).toEqual({ ...EMPTY, time: "11:30" });
    expect(draftWithChip(half, datetime)).toEqual({ ...EMPTY, date: "2026-11-30", time: "14:00" });
    expect(draftWithChip(half, date)).toEqual({ ...half, date: "2026-12-05" });
  });

  it("오전·오후 없이 적은 시간은 옮기되 오전·오후를 묻는다(칩에도 오전·오후를 적지 않는다)", () => {
    const [chip] = chipsOf("2026년 12월 3일 2시 가능해요");
    expect(chip).toMatchObject({ kind: "datetime", meridiemGuessed: true, label: "12월 3일 (목) 2시" });
    expect(draftWithChip(EMPTY, chip)).toMatchObject({ date: "2026-12-03", time: "14:00", meridiemPending: true });
  });

  it("시간만 적은 칩도 업체가 오전·오후를 적지 않았으면 칩에 적지 않고, 옮기면 오전·오후를 묻는다", () => {
    const [chip] = chipsOf("그날은 2시만 비어 있어요");
    expect(chip).toMatchObject({ kind: "time", meridiemGuessed: true, label: "2시" });
    expect(draftWithChip({ ...EMPTY, date: "2026-12-06" }, chip)).toEqual({ ...EMPTY, date: "2026-12-06", time: "14:00", meridiemPending: true });
    const [stated] = chipsOf("그날은 오후 2시만 비어 있어요");
    expect(stated).toMatchObject({ kind: "time", meridiemGuessed: false, label: "오후 2시" });
    expect(draftWithChip(EMPTY, stated).meridiemPending).toBe(false);
  });

  it("날짜 칩은 날짜만, 시간 칩은 시간만 바꾼다", () => {
    const chips = chipsOf("12월 5일 토요일은 마감이에요.\n대신 오전 11시 30분은 남아 있어요.");
    const date = chips.find((chip) => chip.kind === "date");
    const time = chips.find((chip) => chip.kind === "time");
    if (!date || !time) throw new Error(`날짜·시간 칩이 따로 있어야 한다: ${JSON.stringify(chips)}`);
    const withTime = { ...EMPTY, time: "09:00" };
    expect(draftWithChip(withTime, date)).toEqual({ ...withTime, date: "2026-12-05" });
    expect(draftWithChip({ ...EMPTY, date: "2026-12-06" }, time)).toEqual({ ...EMPTY, date: "2026-12-06", time: "11:30" });
  });

  it("시간 없이 넣기를 고르면 시간 칩은 고른 것으로 보이지 않는다", () => {
    const [chip] = chipsOf("2026년 11월 30일 (월) 오후 2시 상담 가능합니다.");
    const draft = { ...draftWithChip(EMPTY, chip), noTime: true };
    expect(chipIsChosen(draft, chip)).toBe(false);
  });
});

describe("draftWithMeridiem", () => {
  it("짐작한 시각의 시만 고른 반나절로 옮기고 묻기를 끝낸다", () => {
    const guessed = { ...EMPTY, time: "14:00", meridiemPending: true };
    expect(draftWithMeridiem(guessed, "am")).toEqual({ ...EMPTY, time: "02:00" });
    expect(draftWithMeridiem(guessed, "pm")).toEqual({ ...EMPTY, time: "14:00" });
    expect(draftWithMeridiem({ ...EMPTY, time: "10:30", meridiemPending: true }, "pm")).toEqual({ ...EMPTY, time: "22:30" });
    expect(draftWithMeridiem({ ...EMPTY, time: "", meridiemPending: true }, "am")).toEqual(EMPTY);
  });
});

describe("pasteScheduleBody", () => {
  const ready: PasteDraft = { hallId: HALL_A, date: "2026-11-30", time: "14:00", noTime: false, meridiemPending: false, timeIncomplete: false };

  it("홀이 없으면 hall, 날짜가 없거나 꼴이 틀리면 date 를 고르라고 한다", () => {
    expect(pasteScheduleBody({ ...ready, hallId: null })).toEqual({ ok: false, problem: "hall" });
    expect(pasteScheduleBody({ ...ready, date: "" })).toEqual({ ok: false, problem: "date" });
    expect(pasteScheduleBody({ ...ready, date: "11/30" })).toEqual({ ok: false, problem: "date" });
  });

  it("홀·날짜·시간 세 칸만 담는다", () => {
    expect(pasteScheduleBody(ready)).toEqual({ ok: true, body: { hallId: HALL_A, date: "2026-11-30", time: "14:00" } });
  });

  it("시간이 비었거나 시간 없이 넣기면 시간을 빼고 보낸다(짐작한 시간이어도 시간 없이 넣기는 된다)", () => {
    const dateOnly = { ok: true, body: { hallId: HALL_A, date: "2026-11-30" } };
    expect(pasteScheduleBody({ ...ready, time: "" })).toEqual(dateOnly);
    expect(pasteScheduleBody({ ...ready, noTime: true })).toEqual(dateOnly);
    expect(pasteScheduleBody({ ...ready, noTime: true, meridiemPending: true })).toEqual(dateOnly);
  });

  it("시간 칸에 덜 고른 시간이 남아 있으면(값은 빈 글) 날짜만 넣지 않고 끝까지 고르라고 한다. 시간 없이 넣기를 골랐으면 날짜만 넣는다", () => {
    const half = { ...ready, time: "", timeIncomplete: true };
    expect(pasteScheduleBody(half)).toEqual({ ok: false, problem: "timeIncomplete" });
    expect(pasteScheduleBody({ ...half, noTime: true })).toEqual({ ok: true, body: { hallId: HALL_A, date: "2026-11-30" } });
    // 홀과 날짜를 먼저 묻는다.
    expect(pasteScheduleBody({ ...half, hallId: null })).toEqual({ ok: false, problem: "hall" });
    expect(pasteScheduleBody({ ...half, date: "" })).toEqual({ ok: false, problem: "date" });
  });

  it("짐작한 시간에 오전·오후를 아직 고르지 않았으면 보내지 않는다", () => {
    expect(pasteScheduleBody({ ...ready, meridiemPending: true })).toEqual({ ok: false, problem: "meridiem" });
  });
});

describe("foundAnyValue", () => {
  it("업체가 쓴 말만 있으면 찾은 값이 없다", () => {
    expect(foundAnyValue(readVendorReply("네 확인했습니다 감사합니다", { todayYmd: TODAY }).chips)).toBe(false);
    expect(foundAnyValue(readVendorReply("그날은 예약이 불가능합니다.", { todayYmd: TODAY }).chips)).toBe(false);
    expect(foundAnyValue(readVendorReply("보증인원 200명, 식대 6.8만원입니다.", { todayYmd: TODAY }).chips)).toBe(true);
  });
});

describe("hasWeekdayMismatch", () => {
  const chips = (reply: string) => readVendorReply(reply, { todayYmd: TODAY }).chips;

  it("업체가 적은 요일이 달력의 요일과 다른 날짜가 있으면 참이다(시간과 함께 적은 날짜, 날짜만 적은 칩, 해를 적은 날짜 모두)", () => {
    // 2026-11-30 은 월요일, 2026-12-05 는 토요일이다.
    expect(hasWeekdayMismatch(chips("11월 30일 (토) 오후 2시 가능해요"))).toBe(true);
    expect(hasWeekdayMismatch(chips("12월 5일 (금)은 마감이에요"))).toBe(true);
    expect(hasWeekdayMismatch(chips("2026년 11월 30일 (토) 상담 가능해요"))).toBe(true);
  });

  it("요일이 맞거나, 요일을 적지 않았거나, 날짜가 없으면 거짓이다", () => {
    expect(hasWeekdayMismatch(chips("11월 30일 (월) 오후 2시 가능해요"))).toBe(false);
    expect(hasWeekdayMismatch(chips("12월 5일 (토)은 마감이에요"))).toBe(false);
    expect(hasWeekdayMismatch(chips("11월 30일 오후 2시 가능해요"))).toBe(false);
    expect(hasWeekdayMismatch(chips("오후 2시 가능해요. 보증인원 200명이에요."))).toBe(false);
    expect(hasWeekdayMismatch([])).toBe(false);
  });
});
