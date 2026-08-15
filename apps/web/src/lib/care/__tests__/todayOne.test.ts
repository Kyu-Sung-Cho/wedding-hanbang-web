import { createHash } from "node:crypto";
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

  it("keeps a completed family event only for its D+1 review card", () => {
    const candidates = buildTodayOneScheduleCandidates({
      progress: {
        __events: [event("evt_completed_sanggyeonrye", {
          date: "2026-08-01",
          title: "상견례",
          status: "completed",
        })],
      },
      stateRevision: 2,
      now: NOW,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      sourceEventId: "evt_completed_sanggyeonrye",
      kind: "schedule_moment",
      attentionWindow: "dAfter",
      care: {
        momentType: "sanggyeonrye",
        attentionWindow: "dAfter",
      },
    });
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

  it("preserves the structured D-1 care for a parents' meeting instead of reducing it to title and date", () => {
    const candidates = buildTodayOneScheduleCandidates({
      progress: { __events: [event("evt_sanggyeonrye", { title: "부모님 첫 만남" })] },
      stateRevision: 2,
      now: NOW,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: "schedule_moment",
      care: {
        version: 1,
        momentType: "sanggyeonrye",
        attentionWindow: "d1",
        guidance: "내일 양쪽 부모님이 함께 만나. 서로 편하게 대화할 수 있도록 필요한 것만 마지막으로 맞춰보자.",
        checklist: [
          "예약·참석 인원 최종 확인",
          "이동이 불편한 분을 고려해 좌석·접근성 확인",
          "오늘 다룰 주제와 피하고 싶은 주제를 파트너와 합의",
          "식사비 결제 방식은 당사자끼리 미리 합의",
          "대화가 부담스러울 때 쉬어갈 신호 정하기",
        ],
        script: "내일 ○시에 ○○로 예약했어요. 편하게 인사 나누는 자리로 생각해 주세요. 자세한 결정은 저희가 정리해서 다시 말씀드릴게요.",
        relatedChecklist: {
          categoryKey: "meeting",
          categoryLabel: "부모님 첫 만남",
        },
        evidence: {
          refs: [
            { key: "canonical_schedule_event", label: "사용자가 저장한 일정" },
            { key: "canonical_checklist_category", label: "부모님 첫 만남 체크리스트" },
            { key: "curated_family_coordination_guidance", label: "가족 행사 중립 안내" },
          ],
          limitations: [
            "가족마다 관습과 기대가 달라 정답으로 단정하지 않아요.",
            "저장된 일정 밖의 최신 변경은 직접 확인해야 해요.",
          ],
        },
      },
    });
  });

  it("preserves checklist-only dress fitting care for D-1 without money or follow-up fields", () => {
    const scheduledEvent = event("evt_dress_fitting", {
      title: "드레스 수선·최종 확인",
      momentType: "dress_fitting",
      categoryKey: "dress",
    });
    const candidates = buildTodayOneScheduleCandidates({
      progress: { __events: [scheduledEvent] },
      stateRevision: 6,
      now: NOW,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: "schedule_moment",
      attentionWindow: "d1",
      care: {
        version: 1,
        momentType: "dress_fitting",
        attentionWindow: "d1",
        guidance: "내일 드레스 수선 상태를 확인해. 입어보기만 하지 말고 실제로 움직여보자.",
        checklist: [
          "매장에서 요청했다면 결혼식 날 신을 높이와 비슷한 신발",
          "파트너와 함께 입는다면 전체 비율 확인",
          "앉기·걷기·팔 들기 테스트",
          "면사포·장갑 등 함께 빌릴 물품 최종 확정",
        ],
        relatedChecklist: {
          categoryKey: "dress",
          categoryLabel: "드레스·예식 정장",
        },
      },
    });
    expect(candidates[0].care).not.toHaveProperty("relatedBudget");
    expect(candidates[0].care).not.toHaveProperty("question");
    expect(JSON.stringify(candidates[0].care)).not.toMatch(/계약|추가금|해지|위약|환불|예산/);

    const semanticSnapshot = {
      version: 1,
      cellKind: "d1",
      momentDate: "2026-08-03",
      event: {
        id: scheduledEvent.id,
        date: scheduledEvent.date,
        time: scheduledEvent.time,
        title: scheduledEvent.title,
        memo: null,
        categoryKey: "dress",
        sourceKey: null,
        momentType: "dress_fitting",
        status: "planned",
        completionCriteria: null,
        assignee: null,
      },
      care: candidates[0].care,
    };
    expect(candidates[0].sourceStateDigest).toBe(
      createHash("sha256").update(JSON.stringify(semanticSnapshot), "utf8").digest("hex"),
    );
  });

  it("keeps dress fitting D+1 generic and does not expose the catalog's fee question", () => {
    const candidates = buildTodayOneScheduleCandidates({
      progress: {
        __events: [event("evt_dress_fitting_after", {
          date: "2026-08-01",
          title: "드레스 수선·최종 확인",
          momentType: "dress_fitting",
          categoryKey: "dress",
          status: "completed",
        })],
      },
      stateRevision: 7,
      now: NOW,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: "schedule_moment",
      attentionWindow: "dAfter",
      nextAction: { label: "일정 열기", href: "/schedule" },
    });
    expect(candidates[0]).not.toHaveProperty("care");
    expect(JSON.stringify(candidates[0])).not.toMatch(/직원 비용|예산|계약|추가금/);
  });

  it("preserves the D+1 question for a first family greeting without inventing a script", () => {
    const candidates = buildTodayOneScheduleCandidates({
      progress: {
        __events: [event("evt_family_greeting", {
          date: "2026-08-01",
          title: "가족 첫인사",
          momentType: "family_greeting",
        })],
      },
      stateRevision: 3,
      now: NOW,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      care: {
        version: 1,
        momentType: "family_greeting",
        attentionWindow: "dAfter",
        guidance: "어제 잘 다녀왔어? 고생했어.",
        checklist: [],
        question: "분위기는 어땠어? 다음 만남에도 참고하고 싶은 호칭이나 취향이 있었다면, 저장해도 되는 내용만 알려줘.",
        relatedChecklist: {
          categoryKey: "meeting",
          categoryLabel: "부모님 첫 만남",
        },
      },
    });
    expect(candidates[0].care).not.toHaveProperty("script");
  });

  it("preserves the legacy card shape for moments outside the first family-care vertical", () => {
    const candidates = buildTodayOneScheduleCandidates({
      progress: {
        __events: [event("evt_dress", {
          title: "드레스 매장 방문",
          momentType: "dress_tour",
        })],
      },
      stateRevision: 4,
      now: NOW,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: "schedule_moment",
      whyNow: "내일 드레스 매장 방문 일정이 있어요.",
      confirmed: ["일정: 드레스 매장 방문", "날짜: 2026-08-03 18:00"],
      nextAction: { label: "일정 열기", href: "/schedule" },
    });
    expect(candidates[0]).not.toHaveProperty("care");
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
