import { describe, expect, it } from "vitest";
import type { ScheduleEvent } from "@/types/database.types";
import { buildActivity } from "../activity";
import { buildConsultation, consultationEventDraft, consultationSourceKey, isInCalendar } from "../consultation";
import type { HallListing } from "../hallCompare";
import { parseDispatchRow, parseReplyRow, type DispatchRow, type InquiryTimeline, type LetterVersionRow, type ReplyRow } from "../inquiryRepository";
import { LIVE_COPY } from "../liveCopy";
import { buildAmoraUpdate, buildAmoraUpdateDetail, hallInquiryStates, inquiryDecisions, openProposals } from "../inquiryView";

const NOW = new Date("2026-11-17T05:00:00Z"); // 한국 시간 11월 17일 14:00
const VERSION = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const HALL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HALL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const dispatch = (id: string, hallId: string, name: string, overrides: Partial<DispatchRow> = {}): DispatchRow => ({
  id, letterId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", versionId: VERSION, hallId, recipientName: name,
  status: "sent", queuedAt: "2026-11-17T00:00:00Z", sentAt: "2026-11-17T00:12:00Z", redacted: false, ...overrides,
});
const reply = (id: string, dispatchId: string, hallId: string, overrides: Partial<ReplyRow>): ReplyRow => ({
  id, dispatchId, hallId, rawText: "원문", outcome: "question", eventAt: null, placeNote: null, priceNote: null,
  recordedAt: "2026-11-17T04:40:00Z", ...overrides,
});
const version: LetterVersionRow = {
  id: VERSION, letterId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", version: 1,
  recipientHallIds: [HALL_A, HALL_B], recipientNames: ["소담 하우스", "가온 웨딩홀"], body: "본문", signature: "민지와 준호 드림",
  shares: { name: { on: false, value: null }, phone: { on: false, value: null }, budget: { on: false, value: null } },
  fingerprint: "a".repeat(64), createdAt: "2026-11-16T23:00:00Z", approvalCompletedAt: "2026-11-16T23:30:00Z", queuedAt: "2026-11-17T00:00:00Z",
};

const DA = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const DB = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const confirmed = reply("a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1", DA, HALL_A, {
  outcome: "confirmed_time", eventAt: "2026-11-22T02:00:00Z", placeNote: "서울 마포구, 2층 상담실", recordedAt: "2026-11-17T02:05:00Z",
});
const proposed = reply("b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2", DB, HALL_B, {
  outcome: "proposed_time", eventAt: "2026-11-21T07:00:00Z", recordedAt: "2026-11-17T04:40:00Z",
});
const timeline: InquiryTimeline = {
  dispatches: [dispatch(DA, HALL_A, "소담 하우스"), dispatch(DB, HALL_B, "가온 웨딩홀")],
  replies: [confirmed, proposed],
  versions: [version],
};

describe("inquiry timeline into screen sentences", () => {
  it("speaks about the newest real event with the artifact's wording", () => {
    const update = buildAmoraUpdate({ timeline, openLetter: null, now: NOW });
    expect(update).toMatchObject({
      timeLabel: "오늘 오후 1:40",
      mood: "happy",
      text: "가온 웨딩홀은 21일 토요일 오후 4시를 제안했어요.",
      primary: { label: "답장 보기", target: "status" },
    });
    expect(update?.steps).toEqual([
      "소담 하우스, 가온 웨딩홀에 보낼 편지가 승인됐어요",
      "담당자가 승인한 편지를 2곳에 보냈어요",
      "담당자가 소담 하우스 답장을 정리했어요",
      "담당자가 가온 웨딩홀 답장을 정리했어요",
    ]);
    // 같은 줄, 같은 순서에 누가 했는지 붙는다. 보내기와 답장 정리는 담당자(사람)의 일이다.
    expect(buildAmoraUpdateDetail({ timeline, openLetter: null, now: NOW })?.steps.map((step) => step.actor))
      .toEqual(["couple", "operator", "operator", "operator"]);
    expect(buildAmoraUpdate({ timeline: { dispatches: [], replies: [], versions: [] }, openLetter: null, now: NOW })).toBeNull();
  });

  it("uses particles that fit the hall name", () => {
    const sodam = buildAmoraUpdate({
      timeline: { ...timeline, replies: [{ ...proposed, dispatchId: DA, hallId: HALL_A }] }, openLetter: null, now: NOW,
    });
    expect(sodam?.text).toBe("소담 하우스는 21일 토요일 오후 4시를 제안했어요.");
    const confirmedOnly = buildAmoraUpdate({ timeline: { ...timeline, replies: [confirmed] }, openLetter: null, now: NOW });
    expect(confirmedOnly?.text).toBe("소담 하우스 상담이 11월 22일 일요일 오전 11시로 잡혔어요.");
  });

  it("lists an unanswered proposal as a shared decision and drops answered ones", () => {
    const decisions = inquiryDecisions({ timeline, openLetter: null, viewerId: "x", nameOf: () => null });
    expect(decisions).toEqual([{
      id: `proposal-${proposed.id}`, title: "가온 웨딩홀 대체 시간", sub: "토요일 오후 4시 제안", owner: { kind: "together" }, target: "status",
    }]);
    const answered = { ...timeline, replies: [...timeline.replies, reply("c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3", DB, HALL_B, { recordedAt: "2026-11-17T04:50:00Z" })] };
    expect(openProposals(answered)).toEqual([]);
  });

  it("reads erased records: withdrawn dispatches and replies without their original text", () => {
    const base = {
      id: DA, letter_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", version_id: VERSION, hall_id: HALL_A,
      recipient_name: "소담 하우스", queued_at: "2026-11-17T00:00:00Z",
    };
    expect(parseDispatchRow({ ...base, status: "withdrawn", sent_at: null, redacted_at: "2026-11-17T03:00:00Z" }))
      .toMatchObject({ status: "withdrawn", redacted: true });
    expect(parseDispatchRow({ ...base, status: "sent", sent_at: "2026-11-17T00:12:00Z", redacted_at: null }))
      .toMatchObject({ status: "sent", redacted: false });
    expect(parseDispatchRow({ ...base, status: "cancelled", sent_at: null })).toBeNull();

    const row = {
      id: confirmed.id, dispatch_id: DA, hall_id: HALL_A, outcome: "confirmed_time", event_at: "2026-11-22T02:00:00Z",
      place_note: "2층 상담실", price_note: null, recorded_at: "2026-11-17T02:05:00Z",
    };
    expect(parseReplyRow({ ...row, raw_text: null, redacted_at: "2026-11-17T03:00:00Z" }))
      .toMatchObject({ rawText: null, outcome: "confirmed_time", placeNote: "2층 상담실" });
    // 원문이 빈 줄은 지운 답장일 때만 받는다. 지운 답장에 원문이 남아 있어도 받지 않는다.
    expect(parseReplyRow({ ...row, raw_text: null, redacted_at: null })).toBeNull();
    expect(parseReplyRow({ ...row, raw_text: "원문", redacted_at: "2026-11-17T03:00:00Z" })).toBeNull();
  });

  it("treats a withdrawn inquiry as never sent and drops proposals the couple can no longer answer", () => {
    const erased: InquiryTimeline = {
      dispatches: [
        dispatch(DA, HALL_A, "소담 하우스", { status: "withdrawn", sentAt: null, redacted: true }),
        dispatch(DB, HALL_B, "가온 웨딩홀", { redacted: true }),
      ],
      replies: [proposed],
      versions: [],
    };
    const states = hallInquiryStates(erased);
    expect(states.has(HALL_A)).toBe(false);
    expect(states.get(HALL_B)).toEqual({ dispatchStatus: "sent", reply: { outcome: "proposed_time", eventAt: proposed.eventAt } });
    expect(openProposals(erased)).toEqual([]);
    expect(inquiryDecisions({ timeline: erased, openLetter: null, viewerId: "x", nameOf: () => null })).toEqual([]);
    // 잡혀 있던 상담 소식은 남는다. 지운 판의 단계는 말하지 않는다.
    const update = buildAmoraUpdate({ timeline: { ...erased, replies: [{ ...confirmed, dispatchId: DB, hallId: HALL_B, rawText: null }] }, openLetter: null, now: NOW });
    expect(update).toMatchObject({ text: "가온 웨딩홀 상담이 11월 22일 일요일 오전 11시로 잡혔어요.", steps: [] });
  });

  it("keeps the latest dispatch and reply per hall", () => {
    const states = hallInquiryStates(timeline);
    expect(states.get(HALL_A)).toEqual({ dispatchStatus: "sent", reply: { outcome: "confirmed_time", eventAt: confirmed.eventAt } });
    expect(states.get(HALL_B)?.reply?.outcome).toBe("proposed_time");
  });

  it("builds the consultation from the confirmed reply and mentions the other hall's proposal", () => {
    const listings = new Map<string, HallListing>([[HALL_A, {
      id: HALL_A, name: "소담 하우스", region: "서울", areaLabel: "마포구 하우스웨딩", kindLabel: "하우스웨딩", mealPriceWon: 68_000,
      rentalFeeWon: null, rentalIncluded: true, minimumGuarantee: 180, stationWalkMinutes: 8, transitNote: null,
      photoUrl: "https://example.com/sodam.jpg", sourceUrl: "https://example.com", checkedOn: "2026-11-14", active: true,
    }]]);
    const view = buildConsultation({ timeline, listings, partnerName: "준호", events: [], now: NOW });
    expect(view?.model).toEqual({
      dateLabel: "11. 22",
      timeLabel: "일요일 오전 11시",
      venue: "소담 하우스",
      place: "서울 마포구, 2층 상담실",
      partnerName: "준호",
      photo: "https://example.com/sodam.jpg",
      update: {
        timeLabel: "오늘 오후 1:40",
        mood: "happy",
        text: "가온 웨딩홀은 21일 토요일 오후 4시를 제안했어요. 그날 다른 일정은 없어요.",
        steps: [],
        primary: null,
      },
      updateActions: [{ label: "이 시간으로 요청", tone: "ink" }, { label: "다른 시간 묻기", tone: "outline" }],
      questions: ["보증 인원 180명을 줄일 수 있는지", "식대에 음료와 주류가 포함되는지", "꽃장식과 포토테이블 추가 비용", "계약금, 잔금 날짜와 취소 조건"],
    });
    expect(buildConsultation({ timeline: { ...timeline, replies: [proposed] }, listings, partnerName: null, events: [] })).toBeNull();
  });

  it("drafts one schedule line per confirmed reply and recognises it afterwards", () => {
    const draft = consultationEventDraft({ reply: confirmed, hallName: "소담 하우스" });
    expect(draft).toEqual({
      date: "2026-11-22", time: "11:00", title: "소담 하우스 상담", memo: "서울 마포구, 2층 상담실",
      categoryKey: "venue", sourceKey: consultationSourceKey(confirmed.id), status: "planned", assignee: { kind: "couple" },
    });
    const event = { id: "evt_1", ...draft, createdAt: "2026-11-17T02:10:00.000Z", updatedAt: "2026-11-17T02:10:00.000Z" } as ScheduleEvent;
    expect(isInCalendar([event], confirmed.id)?.id).toBe("evt_1");
    expect(isInCalendar([{ ...event, status: "cancelled" } as ScheduleEvent], confirmed.id)).toBeNull();
  });

  it("lists only today's recorded actions for the activity column", () => {
    const event = {
      id: "evt_1", date: "2026-11-22", title: "소담 하우스 상담", sourceKey: consultationSourceKey(confirmed.id),
      createdAt: "2026-11-17T02:10:00.000Z", updatedAt: "2026-11-17T02:10:00.000Z",
    } as ScheduleEvent;
    const yesterday = reply("d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4", DB, HALL_B, { recordedAt: "2026-11-16T03:00:00Z" });
    expect(buildActivity({ timeline: { ...timeline, replies: [...timeline.replies, yesterday] }, events: [event], now: NOW })).toEqual([
      { timeLabel: "13:40", actor: "operator", text: "담당자가 가온 웨딩홀 답장을 정리했어요" },
      { timeLabel: "11:10", actor: "couple", text: "소담 하우스 상담이 일정에 들어갔어요" },
      { timeLabel: "11:05", actor: "operator", text: "담당자가 소담 하우스 답장을 정리했어요" },
      { timeLabel: "09:12", actor: "operator", text: "담당자가 승인한 편지를 2곳에 보냈어요" },
    ]);
  });

  it("never words a person's work as the AI's: operator lines name the operator, couple lines name no doer", () => {
    const operatorLines = [LIVE_COPY.activity.sent(2), LIVE_COPY.activity.reply("가온 웨딩홀"), LIVE_COPY.steps.sent(2),
      LIVE_COPY.steps.reply("가온 웨딩홀"), LIVE_COPY.update.sent(2), LIVE_COPY.update.queued(2), LIVE_COPY.hallStatus.queued];
    for (const line of operatorLines) expect(line, line).toMatch(/^담당자가 /);
    const coupleLines = [LIVE_COPY.activity.schedule("소담 하우스"), LIVE_COPY.steps.approved("소담 하우스"),
      LIVE_COPY.update.paused, LIVE_COPY.update.capped];
    for (const line of coupleLines) expect(line, line).toMatch(/(됐어요|들어갔어요)/);
    for (const line of [...operatorLines, ...coupleLines]) expect(line, line).not.toMatch(/아모라|AI|에이아이/);
  });
});
