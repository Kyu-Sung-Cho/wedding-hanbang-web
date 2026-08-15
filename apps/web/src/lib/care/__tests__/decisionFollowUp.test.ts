import { describe, expect, it } from "vitest";

import { buildConfirmedDecisionFollowUpCandidates } from "@/lib/care/decisionFollowUp";

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const DECISION_ID = "30000000-0000-4000-8000-000000000001";
const REQUEST_ID = "40000000-0000-4000-8000-000000000001";
const CONFIRMED_AT = "2026-08-10T00:00:00.000Z";

function confirmedDecision(overrides: Record<string, unknown> = {}) {
  return {
    id: DECISION_ID,
    couple_id: COUPLE_ID,
    visibility: "shared",
    decision_type: "decided",
    title: "총예산을 3천만원으로 확정",
    source_ref_id: REQUEST_ID,
    source_actor_role: "bride",
    user_confirmed_at: CONFIRMED_AT,
    decided_at: CONFIRMED_AT,
    superseded_at: null,
    metadata: {
      origin: "couple_plan_change_request",
      requestId: REQUEST_ID,
      changeDigest: "a".repeat(64),
      rosterFingerprint: "b".repeat(32),
      expectedRevision: 7,
      appliedRevision: 8,
      requiredCount: 2,
      acceptances: [
        { userId: BRIDE_ID, acceptedAt: CONFIRMED_AT },
        { userId: GROOM_ID, acceptedAt: CONFIRMED_AT },
      ],
      surfaceHref: "/budget",
    },
    ...overrides,
  };
}

describe("confirmed decision follow-up candidate compiler", () => {
  it("offers a non-mutating follow-up one day after the current roster confirmed a shared decision", () => {
    const candidates = buildConfirmedDecisionFollowUpCandidates({
      coupleId: COUPLE_ID,
      recipientUserId: BRIDE_ID,
      actorRole: "bride",
      currentMemberUserIds: [BRIDE_ID, GROOM_ID],
      stateRevision: 8,
      decisions: [confirmedDecision()],
      now: new Date("2026-08-12T00:00:00.000Z"),
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        sourceKey: `decision:${DECISION_ID}`,
        sourceRevision: 8,
        kind: "decision_follow_up",
        whyNow: "직접 확인한 결정이 반영된 뒤 하루가 지났어요. 지금도 이대로 진행할지 확인해 보세요.",
        confirmed: ["결정: 총예산을 3천만원으로 확정"],
        unknown: [],
        nextAction: { label: "예산 열기", href: "/budget" },
        impact: "확인만 하며 예산·일정·체크리스트를 자동으로 바꾸지 않아요.",
      }),
    ]);
    expect(candidates[0]?.sourceStateDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("refuses a decision whose durable request receipt does not match its source reference", () => {
    const candidates = buildConfirmedDecisionFollowUpCandidates({
      coupleId: COUPLE_ID,
      recipientUserId: BRIDE_ID,
      actorRole: "bride",
      currentMemberUserIds: [BRIDE_ID, GROOM_ID],
      stateRevision: 8,
      decisions: [confirmedDecision({
        source_ref_id: "40000000-0000-4000-8000-000000000002",
      })],
      now: new Date("2026-08-12T00:00:00.000Z"),
    });

    expect(candidates).toEqual([]);
  });

  it("refuses a row that lacks a durable decided timestamp", () => {
    const candidates = buildConfirmedDecisionFollowUpCandidates({
      coupleId: COUPLE_ID,
      recipientUserId: BRIDE_ID,
      actorRole: "bride",
      currentMemberUserIds: [BRIDE_ID, GROOM_ID],
      stateRevision: 8,
      decisions: [confirmedDecision({ decided_at: null })],
      now: new Date("2026-08-12T00:00:00.000Z"),
    });

    expect(candidates).toEqual([]);
  });

  it("waits a full day after the shared decision was actually applied", () => {
    const candidates = buildConfirmedDecisionFollowUpCandidates({
      coupleId: COUPLE_ID,
      recipientUserId: BRIDE_ID,
      actorRole: "bride",
      currentMemberUserIds: [BRIDE_ID, GROOM_ID],
      stateRevision: 8,
      decisions: [confirmedDecision({
        decided_at: "2026-08-11T12:00:00.000Z",
      })],
      now: new Date("2026-08-12T00:00:00.000Z"),
    });

    expect(candidates).toEqual([]);
  });

  it("lets the other current member revisit a decision they also explicitly accepted", () => {
    const candidates = buildConfirmedDecisionFollowUpCandidates({
      coupleId: COUPLE_ID,
      recipientUserId: GROOM_ID,
      actorRole: "groom",
      currentMemberUserIds: [BRIDE_ID, GROOM_ID],
      stateRevision: 8,
      decisions: [confirmedDecision()],
      now: new Date("2026-08-12T00:00:00.000Z"),
    });

    expect(candidates).toHaveLength(1);
  });

  it("keeps the decision eligible after a later unrelated journey revision", () => {
    const candidates = buildConfirmedDecisionFollowUpCandidates({
      coupleId: COUPLE_ID,
      recipientUserId: BRIDE_ID,
      actorRole: "bride",
      currentMemberUserIds: [BRIDE_ID, GROOM_ID],
      stateRevision: 9,
      decisions: [confirmedDecision()],
      now: new Date("2026-08-12T00:00:00.000Z"),
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.sourceRevision).toBe(9);
  });
});
