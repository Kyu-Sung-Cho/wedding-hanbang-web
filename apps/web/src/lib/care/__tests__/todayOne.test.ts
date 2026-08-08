import { describe, expect, it } from "vitest";
import {
  buildTodayOneScheduleCandidates,
  MAX_TODAY_ONE_CANDIDATES,
  mergeTodayOneCandidatesWithHistory,
  type TodayOneCandidate,
} from "@/lib/care/todayOne";

const NOW = new Date("2026-08-02T03:00:00.000Z");

function event(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    date: "2026-08-03",
    time: "18:00",
    title: `일정 ${id}`,
    momentType: "sanggyeonrye",
    status: "planned",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("in-app TodayOne schedule candidate compiler", () => {
  it("keeps a same-day source revision ahead of a different higher-priority card", () => {
    const changedSource: TodayOneCandidate = {
      sourceKey: "schedule:source-a:d1",
      sourceStateDigest: "b".repeat(64),
      sourceRevision: 8,
      kind: "schedule_moment",
      whyNow: "내일 변경된 일정이 있어요.",
      confirmed: ["날짜: 2026-08-03 19:00"],
      unknown: ["업체의 최신 변경 여부는 확인되지 않았어요."],
      nextAction: { label: "일정 열기", href: "/schedule" },
      impact: "확인만 해요.",
      choices: [],
      priority: 100,
      attentionWindow: "d1",
    };
    const differentHigherPriority: TodayOneCandidate = {
      ...changedSource,
      sourceKey: "schedule:source-b:d1",
      sourceStateDigest: "c".repeat(64),
      whyNow: "내일 다른 일정이 있어요.",
      priority: 999,
    };

    const ordered = mergeTodayOneCandidatesWithHistory(
      [{
        sourceKey: changedSource.sourceKey,
        sourceStateDigest: "a".repeat(64),
        claimedForDate: "2026-08-02",
        claimedToday: true,
      }],
      [differentHigherPriority, changedSource],
    );

    expect(ordered.map(({ sourceKey }) => sourceKey)).toEqual([
      changedSource.sourceKey,
      differentHigherPriority.sourceKey,
    ]);
  });

  it("keeps separate real events even when date and moment type match", () => {
    const candidates = buildTodayOneScheduleCandidates({
      progress: { __events: [event("evt_a"), event("evt_b")] },
      stateRevision: 4,
      now: NOW,
    });

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.sourceEventId).sort()).toEqual([
      "evt_a",
      "evt_b",
    ]);
    expect(new Set(candidates.map((candidate) => candidate.sourceKey)).size).toBe(2);
  });

  it("uses a deterministic relevant-state digest and ignores unrelated budget fields", () => {
    const base = buildTodayOneScheduleCandidates({
      progress: { __events: [event("evt_a")], venue: { spent: 1 } },
      stateRevision: 4,
      now: NOW,
    })[0];
    const unrelatedChange = buildTodayOneScheduleCandidates({
      progress: { __events: [event("evt_a")], venue: { spent: 999_999 } },
      stateRevision: 5,
      now: NOW,
    })[0];
    const scheduleChange = buildTodayOneScheduleCandidates({
      progress: {
        __events: [event("evt_a", { time: "19:00", updatedAt: "2026-08-02T00:00:00.000Z" })],
      },
      stateRevision: 5,
      now: NOW,
    })[0];

    expect(base.sourceKey).toBe(unrelatedChange.sourceKey);
    expect(base.sourceStateDigest).toBe(unrelatedChange.sourceStateDigest);
    expect(base.sourceRevision).toBe(4);
    expect(unrelatedChange.sourceRevision).toBe(5);
    expect(scheduleChange.sourceStateDigest).not.toBe(base.sourceStateDigest);
  });

  it("suppresses completed, cancelled, and unsafe schedule events", () => {
    const candidates = buildTodayOneScheduleCandidates({
      progress: {
        __events: [
          event("evt_done", { status: "completed" }),
          event("evt_cancelled", {
            status: "cancelled",
            cancellation: {
              cancelledAt: "2026-08-02T01:00:00.000Z",
              cancelledByProfileId: "10000000-0000-4000-8000-000000000001",
              reason: "가족 일정 변경",
            },
            updatedAt: "2026-08-02T01:00:00.000Z",
          }),
          event("evt_unsafe", { title: "상견례\u202E거짓" }),
        ],
      },
      stateRevision: 1,
      now: NOW,
    });

    expect(candidates).toEqual([]);
  });

  it("uses KST day boundaries and reports only confirmed schedule facts", () => {
    const candidates = buildTodayOneScheduleCandidates({
      progress: { __events: [event("evt_a")] },
      stateRevision: 2,
      now: new Date("2026-08-01T16:30:00.000Z"),
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: "schedule_moment",
      whyNow: "내일 일정 evt_a 일정이 있어요.",
      confirmed: ["일정: 일정 evt_a", "날짜: 2026-08-03 18:00"],
      nextAction: { label: "일정 열기", href: "/schedule" },
    });
    expect(candidates[0].unknown[0]).toContain("최신 변경 여부");
    expect(candidates[0].impact).toContain("실제 일정이나 외부 서비스는 바꾸지 않아요");
  });

  it("bounds candidate work and never derives a budget-over card", () => {
    const events = Array.from({ length: MAX_TODAY_ONE_CANDIDATES + 25 }, (_, index) =>
      event(`evt_${index}`));
    const candidates = buildTodayOneScheduleCandidates({
      progress: {
        __events: events,
        venue: { budget: 1, spent: 9_999_999_999 },
      },
      stateRevision: 8,
      now: NOW,
    });

    expect(candidates).toHaveLength(MAX_TODAY_ONE_CANDIDATES);
    expect(candidates.every((candidate) => candidate.kind === "schedule_moment")).toBe(true);
  });
});
