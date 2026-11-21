// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateTodayOneCareResponse } from "@hanbang/shared";

import {
  buildTodayOneDecisionCandidates,
  buildTodayOneInquiryWaitingCandidates,
  buildTodayOneTaskDeadlineCandidates,
  INQUIRY_WAITING_HOURS,
  TODAY_ONE_EXTRA_SOURCES,
} from "../todayOneMore";
import type { InquiryTimeline } from "@/lib/invitation/inquiryRepository";

// 25장 2절: 오늘의 한 가지가 더 고르는 셋의 규칙. 고르는 것은 규칙, 문장은 정해진 틀이다.

const USER_ID = "10000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-11-20T01:00:00.000Z"); // KST 11-20 10:00

function action(overrides: Record<string, unknown> = {}) {
  return {
    id: "act-1",
    title: "청첩장 문구 정하기",
    dueDate: "2026-11-21",
    priority: "normal",
    status: "open",
    source: "amora",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  } as never;
}

function dispatch(overrides: Record<string, unknown> = {}) {
  return {
    id: "dispatch-1",
    letterId: "letter-1",
    versionId: "version-1",
    hallId: "hall-1",
    recipientName: "라온홀",
    status: "sent",
    queuedAt: "2026-11-17T00:00:00.000Z",
    sentAt: "2026-11-17T01:00:00.000Z",
    redacted: false,
    ...overrides,
  } as InquiryTimeline["dispatches"][number];
}

function timeline(dispatches: InquiryTimeline["dispatches"], replies: Record<string, unknown>[] = []): InquiryTimeline {
  return { dispatches, replies: replies as InquiryTimeline["replies"], versions: [] };
}

/** 서버가 만든 후보가 화면 계약(옛 카드와 같은 검사)을 그대로 통과하는지. */
function asCard(candidate: ReturnType<typeof buildTodayOneTaskDeadlineCandidates>[number]) {
  return validateTodayOneCareResponse({
    version: 1,
    state: "ready",
    recipientUserId: USER_ID,
    claimedForDate: "2026-11-20",
    card: {
      id: "20000000-0000-4000-8000-000000000001",
      revision: 1,
      sourceRevision: candidate.sourceRevision,
      sourceKey: candidate.sourceKey,
      kind: candidate.kind,
      whyNow: candidate.whyNow,
      confirmed: candidate.confirmed,
      unknown: candidate.unknown,
      nextAction: candidate.nextAction,
      impact: candidate.impact,
      choices: candidate.choices,
      expiresAt: "2026-11-20T15:00:00.000Z",
    },
  }, USER_ID);
}

describe("할 일 마감", () => {
  it("열린 할 일의 마감이 오늘·내일·사흘 뒤일 때만 고르고 이틀 뒤·지난 마감은 고르지 않는다", () => {
    const windows = ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-19"].map((dueDate) =>
      buildTodayOneTaskDeadlineCandidates({ actions: [action({ dueDate })], stateRevision: 3, now: NOW })
        .map((candidate) => candidate.whyNow),
    );
    expect(windows).toEqual([
      ["오늘까지 해 둘 할 일이 있어요."],
      ["내일까지 해 둘 할 일이 있어요."],
      [],
      ["사흘 뒤까지 해 둘 할 일이 있어요."],
      [],
    ]);
  });

  it("끝냈거나 넘긴 할 일, 마감이 없는 할 일, 표시할 수 없는 제목은 고르지 않는다", () => {
    for (const overrides of [
      { status: "done" },
      { status: "dismissed" },
      { dueDate: undefined },
      { title: "줄‮바꿈" },
      { title: "가".repeat(121) },
    ]) {
      expect(buildTodayOneTaskDeadlineCandidates({ actions: [action(overrides)], stateRevision: 3, now: NOW })).toEqual([]);
    }
  });

  it("KST 날짜로 센다: 한국 새벽 0~9시에도 '내일'은 한국의 내일이다", () => {
    const kstEarlyMorning = new Date("2026-11-19T16:30:00.000Z"); // KST 11-20 01:30
    const [candidate] = buildTodayOneTaskDeadlineCandidates({ actions: [action()], stateRevision: 3, now: kstEarlyMorning });
    expect(candidate.whyNow).toBe("내일까지 해 둘 할 일이 있어요.");
  });

  it("화면 계약을 통과하는 카드가 된다", () => {
    const [candidate] = buildTodayOneTaskDeadlineCandidates({ actions: [action()], stateRevision: 3, now: NOW });
    expect(asCard(candidate).ok).toBe(true);
    expect(candidate.confirmed).toEqual(["할 일: 청첩장 문구 정하기", "마감: 11월 21일"]);
  });
});

describe("두 분이 정할 것", () => {
  it("문의에서 생긴 줄만 고르고 홈과 같은 글을 확인한 사실로 쓴다", () => {
    const candidates = buildTodayOneDecisionCandidates({
      decisions: [
        { id: "proposal-1", title: "라온홀 대체 시간", sub: "토요일 오후 4시 제안", owner: { kind: "together" }, target: "status" },
        { id: "letter-1", title: "상담 문의 편지 확인", sub: "내 차례예요", owner: { kind: "together" }, target: "letter" },
        { id: "action-1", title: "예산 나누기", sub: null, owner: { kind: "together" }, target: null },
      ],
      stateRevision: 3,
    });
    expect(candidates.map((candidate) => [candidate.confirmed, candidate.nextAction.href])).toEqual([
      [["라온홀 대체 시간", "토요일 오후 4시 제안"], "/halls/consultation"],
      [["상담 문의 편지 확인", "내 차례예요"], "/halls/letter"],
    ]);
    for (const candidate of candidates) expect(asCard(candidate).ok).toBe(true);
  });
});

describe("답 없는 문의", () => {
  it(`보낸 지 ${INQUIRY_WAITING_HOURS}시간이 넘었고 답이 없을 때만 고른다`, () => {
    const exactly48 = new Date(Date.parse("2026-11-17T01:00:00.000Z") + INQUIRY_WAITING_HOURS * 3_600_000);
    const justBefore = new Date(exactly48.getTime() - 1);
    expect(buildTodayOneInquiryWaitingCandidates({ timeline: timeline([dispatch()]), stateRevision: 3, now: justBefore })).toEqual([]);
    const [candidate] = buildTodayOneInquiryWaitingCandidates({ timeline: timeline([dispatch()]), stateRevision: 3, now: exactly48 });
    expect(candidate.confirmed).toEqual(["웨딩홀: 라온홀", "보낸 날: 11월 17일"]);
    expect(asCard(candidate).ok).toBe(true);

    expect(buildTodayOneInquiryWaitingCandidates({
      timeline: timeline([dispatch()], [{ id: "reply-1", dispatchId: "dispatch-1", hallId: "hall-1", outcome: "question", recordedAt: "2026-11-18T00:00:00.000Z" }]),
      stateRevision: 3,
      now: NOW,
    })).toEqual([]);
  });

  it("보내지 않았거나 거둬들인 문의, 지운 문의는 고르지 않고 홀마다 가장 최근 문의만 본다", () => {
    for (const overrides of [{ status: "queued", sentAt: null }, { status: "withdrawn" }, { redacted: true }, { sentAt: null }]) {
      expect(buildTodayOneInquiryWaitingCandidates({ timeline: timeline([dispatch(overrides)]), stateRevision: 3, now: NOW })).toEqual([]);
    }
    // 같은 홀에 다시 보낸 문의가 아직 48시간이 안 됐으면 옛 문의로 재촉하지 않는다.
    const resent = dispatch({ id: "dispatch-2", queuedAt: "2026-11-19T20:00:00.000Z", sentAt: "2026-11-19T21:00:00.000Z" });
    expect(buildTodayOneInquiryWaitingCandidates({ timeline: timeline([dispatch(), resent]), stateRevision: 3, now: NOW })).toEqual([]);
  });
});

describe("다른 갈래의 자리", () => {
  it("끝난 맡은 일(갈래 4)은 아직 비어 있다", () => {
    expect(TODAY_ONE_EXTRA_SOURCES).toEqual([]);
  });
});
