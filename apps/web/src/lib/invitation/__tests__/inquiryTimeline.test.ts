import type { LetterState } from "@hanbang/shared/invitation";
import { describe, expect, it } from "vitest";
import type { ScheduleEvent } from "@/types/database.types";
import { buildActivity } from "../activity";
import {
  CONSULTATION_SOURCE_PREFIX,
  PASTED_CONSULTATION_SOURCE_PREFIX,
  buildConsultation,
  consultationEventDraft,
  consultationSourceKey,
  findPastedInCalendar,
  isInCalendar,
  pastedConsultationEventDraft,
  pastedConsultationSourceKey,
} from "../consultation";
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

describe("couple self-send mode (D-83 stage 1)", () => {
  const EMPTY: InquiryTimeline = { dispatches: [], replies: [], versions: [] };
  const BRIDE = "11111111-1111-4111-8111-111111111111";
  const GROOM = "22222222-2222-4222-8222-222222222222";
  const openVersion: LetterVersionRow = { ...version, approvalCompletedAt: "2026-11-17T03:00:00Z", queuedAt: null };

  function openLetter(state: Partial<LetterState>): { version: LetterVersionRow; state: LetterState } {
    return {
      version: openVersion,
      state: {
        letterId: openVersion.letterId,
        versionId: openVersion.id,
        version: 1,
        fingerprint: openVersion.fingerprint,
        status: "approved_not_queued",
        approver: { mode: "unset", designatedUserId: null, revision: 0 },
        approvedBy: [BRIDE],
        approvedWhilePaused: [],
        waitingFor: [],
        viewerCanApprove: true,
        viewerIsApprover: true,
        sendingEnabled: false,
        notQueuedReason: "sending_disabled",
        recipients: [{ hallId: HALL_A, name: "소담 하우스" }, { hallId: HALL_B, name: "가온 웨딩홀" }],
        ...state,
      },
    };
  }

  it("drops the paused and capped approval news only when asked", () => {
    for (const reason of ["sending_disabled", "daily_cap", "global_daily_cap"] as const) {
      const open = openLetter({ notQueuedReason: reason });
      const before = buildAmoraUpdate({ timeline: EMPTY, openLetter: open, now: NOW });
      expect(before, reason).toMatchObject({
        text: reason === "sending_disabled" ? LIVE_COPY.update.paused : LIVE_COPY.update.capped,
        primary: { target: "letter" },
      });
      // 칸을 주지 않거나 false 면 이 칸이 생기기 전과 같다.
      expect(buildAmoraUpdate({ timeline: EMPTY, openLetter: open, now: NOW, selfSendMode: false }), reason).toEqual(before);
      expect(buildAmoraUpdateDetail({ timeline: EMPTY, openLetter: open, now: NOW, selfSendMode: true }), reason).toBeNull();
    }
  });

  it("still tells real recorded events in self-send mode", () => {
    // 승인이 답장들보다 늦어 평소에는 멈춤 소식이 가장 최근 일이다.
    const latest = openLetter({ notQueuedReason: "sending_disabled" });
    const open = { ...latest, version: { ...openVersion, approvalCompletedAt: "2026-11-17T04:50:00Z" } };
    expect(buildAmoraUpdate({ timeline, openLetter: open, now: NOW })?.text).toBe(LIVE_COPY.update.paused);
    const withReplies = buildAmoraUpdate({ timeline, openLetter: open, now: NOW, selfSendMode: true });
    expect(withReplies?.text).toBe("가온 웨딩홀은 21일 토요일 오후 4시를 제안했어요.");
    expect(withReplies).toEqual(buildAmoraUpdate({ timeline, openLetter: null, now: NOW }));
  });

  it("leaves out the letter approval decision only when asked", () => {
    const awaiting = openLetter({ status: "awaiting_approval", notQueuedReason: null, approvedBy: [GROOM], waitingFor: [BRIDE], approver: { mode: "both", designatedUserId: null, revision: 1 } });
    const input = { timeline, openLetter: awaiting, viewerId: BRIDE, nameOf: () => "민지" };
    const before = inquiryDecisions(input);
    expect(before.map((item) => item.id)).toEqual([`proposal-${proposed.id}`, `letter-${openVersion.id}`]);
    expect(before[1]).toMatchObject({ title: LIVE_COPY.decisions.letterApproval, sub: LIVE_COPY.decisions.letterYourTurn, target: "letter" });
    expect(inquiryDecisions({ ...input, selfSendMode: false })).toEqual(before);
    // 대체 시간 같은 다른 결정은 그대로 남는다.
    expect(inquiryDecisions({ ...input, selfSendMode: true }).map((item) => item.id)).toEqual([`proposal-${proposed.id}`]);
    const draft = openLetter({ status: "draft", notQueuedReason: null, approvedBy: [], waitingFor: [BRIDE, GROOM] });
    expect(inquiryDecisions({ timeline: EMPTY, openLetter: draft, viewerId: BRIDE, nameOf: () => null, selfSendMode: true })).toEqual([]);
  });
});

describe("consultations picked from a pasted reply (D-83 stage 1)", () => {
  const event = (overrides: Partial<ScheduleEvent>): ScheduleEvent => ({
    id: "evt_paste", date: "2026-11-30", title: "소담 하우스 상담",
    createdAt: "2026-11-17T02:10:00.000Z", updatedAt: "2026-11-17T02:10:00.000Z", ...overrides,
  } as ScheduleEvent);

  it("keys them by hall, date and time, apart from reply consultations", () => {
    expect(PASTED_CONSULTATION_SOURCE_PREFIX.startsWith(CONSULTATION_SOURCE_PREFIX)).toBe(false);
    expect(pastedConsultationSourceKey(HALL_A, "2026-11-30", "14:00")).toBe(`hall-consultation-pasted:${HALL_A}:2026-11-30T14:00`);
    expect(pastedConsultationSourceKey(HALL_A, "2026-11-30")).toBe(`hall-consultation-pasted:${HALL_A}:2026-11-30`);
  });

  it("drafts one schedule line with the hall's consultation title and no memo", () => {
    const draft = pastedConsultationEventDraft({ hallId: HALL_A, hallName: "소담 하우스", date: "2026-11-30", time: "14:00" });
    expect(draft).toEqual({
      date: "2026-11-30", time: "14:00", title: "소담 하우스 상담", categoryKey: "venue",
      sourceKey: `hall-consultation-pasted:${HALL_A}:2026-11-30T14:00`, status: "planned", assignee: { kind: "couple" },
    });
    expect(draft).not.toHaveProperty("memo");
    for (const time of [undefined, null]) {
      const dayOnly = pastedConsultationEventDraft({ hallId: HALL_A, hallName: "소담 하우스", date: "2026-11-30", time });
      expect(dayOnly).not.toHaveProperty("time");
      expect(dayOnly.sourceKey).toBe(`hall-consultation-pasted:${HALL_A}:2026-11-30`);
    }
  });

  it("finds an earlier pick, ignores cancelled ones, and never mixes it up with a reply consultation", () => {
    const key = pastedConsultationSourceKey(HALL_A, "2026-11-30", "14:00");
    expect(findPastedInCalendar([event({ sourceKey: key })], key)?.id).toBe("evt_paste");
    expect(findPastedInCalendar([event({ sourceKey: key, status: "cancelled" })], key)).toBeNull();
    expect(findPastedInCalendar([event({ sourceKey: pastedConsultationSourceKey(HALL_A, "2026-11-30") })], key)).toBeNull();
    expect(findPastedInCalendar([event({ sourceKey: consultationSourceKey(confirmed.id) })], key)).toBeNull();
    expect(isInCalendar([event({ sourceKey: key })], confirmed.id)).toBeNull();
    // 오늘 한 일은 답장 일정만 센다. 붙여 넣어 넣은 일정은 답장 ID 로 읽히지 않는다.
    expect(buildActivity({ timeline: { dispatches: [], replies: [], versions: [] }, events: [event({ sourceKey: key })], now: NOW })).toEqual([]);
  });
});
