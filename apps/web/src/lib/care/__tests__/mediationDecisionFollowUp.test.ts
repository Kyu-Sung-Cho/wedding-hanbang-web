import { describe, expect, it } from "vitest";

import { buildConfirmedDecisionFollowUpCandidates } from "@/lib/care/decisionFollowUp";
import { buildMediationDecisionFollowUpCandidates } from "@/lib/care/mediationDecisionFollowUp";

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const DECISION_ID = "30000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "40000000-0000-4000-8000-000000000001";
const PROPOSAL_VERSION = "50000000-0000-4000-8000-000000000001";
const DECIDED_AT = "2026-08-10T00:00:00.000Z";
const ROSTER_FINGERPRINT = "7704026f6654810dd28e75fbf0cd700f";

function confirmedMediationDecision(overrides: Record<string, unknown> = {}) {
  return {
    id: DECISION_ID,
    couple_id: COUPLE_ID,
    category: "conflict_resolution",
    decision_type: "decided",
    source: "chat",
    source_ref_id: MESSAGE_ID,
    visibility: "shared",
    decided_at: DECIDED_AT,
    superseded_at: null,
    title: "누가 옳은지 정한 게 아니라 다음 대화 시간을 합의함",
    chosen_value: { value: "상대가 분명 화가 났다는 원문 추정" },
    reasoning: "private/raw/requester summary must never be copied",
    metadata: {
      confirmed_by_both: true,
      acceptance_count: 2,
      proposal_version: PROPOSAL_VERSION,
      roster_fingerprint: ROSTER_FINGERPRINT,
    },
    ...overrides,
  };
}

describe("mediation decision outcome follow-up compiler", () => {
  it("reproduces the legacy gap: an accepted mediation decision is not a plan-change follow-up", () => {
    const legacyCandidates = buildConfirmedDecisionFollowUpCandidates({
      coupleId: COUPLE_ID,
      recipientUserId: BRIDE_ID,
      actorRole: "bride",
      currentMemberUserIds: [BRIDE_ID, GROOM_ID],
      stateRevision: 8,
      decisions: [confirmedMediationDecision()],
      now: new Date("2026-08-11T00:00:00.000Z"),
    });

    expect(legacyCandidates).toEqual([]);
  });

  it("compiles one private, non-mutating outcome candidate 24 hours after both partners confirmed", () => {
    const candidates = buildMediationDecisionFollowUpCandidates({
      coupleId: COUPLE_ID,
      recipientUserId: BRIDE_ID,
      currentRoster: { brideUserId: BRIDE_ID, groomUserId: GROOM_ID },
      safety: {
        violence: false,
        coercion: false,
        privateSafetyHold: false,
      },
      decisions: [confirmedMediationDecision()],
      now: new Date("2026-08-11T00:00:00.000Z"),
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        decisionId: DECISION_ID,
        sourceKey: `mediation-decision:${DECISION_ID}:recipient:${BRIDE_ID}`,
        kind: "mediation_outcome_follow_up",
        visibility: "private",
        recipientUserId: BRIDE_ID,
        confirmed: ["두 분이 직접 확인한 조율안이 있어요."],
        unknown: ["지금 실제 결과는 아직 확인하지 않았어요."],
        outcomes: [
          { outcome: "resolved", label: "이제 괜찮아졌어요" },
          { outcome: "changed", label: "상황이 달라졌어요" },
          { outcome: "blocked", label: "아직 막혀 있어요" },
          { outcome: "stop", label: "여기서 멈출게요" },
        ],
        safeguards: {
          automaticSharedMutation: false,
          automaticRemediation: false,
        },
      }),
    ]);
    expect(candidates[0]?.sourceStateDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("fails closed instead of throwing when the backend decision collection is malformed", () => {
    expect(() => buildMediationDecisionFollowUpCandidates({
      coupleId: COUPLE_ID,
      recipientUserId: BRIDE_ID,
      currentRoster: { brideUserId: BRIDE_ID, groomUserId: GROOM_ID },
      safety: {
        violence: false,
        coercion: false,
        privateSafetyHold: false,
      },
      decisions: null as never,
      now: new Date("2026-08-11T00:00:00.000Z"),
    })).not.toThrow();

    expect(buildMediationDecisionFollowUpCandidates({
      coupleId: COUPLE_ID,
      recipientUserId: BRIDE_ID,
      currentRoster: { brideUserId: BRIDE_ID, groomUserId: GROOM_ID },
      safety: {
        violence: false,
        coercion: false,
        privateSafetyHold: false,
      },
      decisions: null as never,
      now: new Date("2026-08-11T00:00:00.000Z"),
    })).toEqual([]);
  });

  it.each([
    ["violence", { violence: true, coercion: false, privateSafetyHold: false }],
    ["coercion", { violence: false, coercion: true, privateSafetyHold: false }],
    ["private safety hold", { violence: false, coercion: false, privateSafetyHold: true }],
    ["incomplete safety context", { violence: false, coercion: false }],
  ])("suppresses an ordinary follow-up when %s is present", (_name, safety) => {
    const candidates = buildMediationDecisionFollowUpCandidates({
      coupleId: COUPLE_ID,
      recipientUserId: BRIDE_ID,
      currentRoster: { brideUserId: BRIDE_ID, groomUserId: GROOM_ID },
      safety: safety as never,
      decisions: [confirmedMediationDecision()],
      now: new Date("2026-08-11T00:00:00.000Z"),
    });

    expect(candidates).toEqual([]);
  });

  it("waits a full 24 hours from the durable two-sided decision timestamp", () => {
    const candidates = buildMediationDecisionFollowUpCandidates({
      coupleId: COUPLE_ID,
      recipientUserId: BRIDE_ID,
      currentRoster: { brideUserId: BRIDE_ID, groomUserId: GROOM_ID },
      safety: {
        violence: false,
        coercion: false,
        privateSafetyHold: false,
      },
      decisions: [confirmedMediationDecision()],
      now: new Date("2026-08-10T23:59:59.999Z"),
    });

    expect(candidates).toEqual([]);
  });

  it("does not resurrect a follow-up after its 30-day private response window", () => {
    const candidates = buildMediationDecisionFollowUpCandidates({
      coupleId: COUPLE_ID,
      recipientUserId: BRIDE_ID,
      currentRoster: { brideUserId: BRIDE_ID, groomUserId: GROOM_ID },
      safety: {
        violence: false,
        coercion: false,
        privateSafetyHold: false,
      },
      decisions: [confirmedMediationDecision()],
      now: new Date("2026-09-10T00:00:00.000Z"),
    });

    expect(candidates).toEqual([]);
  });

  it.each([
    ["one-sided acceptance", {
      confirmed_by_both: false,
      acceptance_count: 1,
      proposal_version: PROPOSAL_VERSION,
      roster_fingerprint: ROSTER_FINGERPRINT,
    }],
    ["missing canonical proposal revision", {
      confirmed_by_both: true,
      acceptance_count: 2,
      proposal_version: null,
      roster_fingerprint: ROSTER_FINGERPRINT,
    }],
    ["a previous couple roster", {
      confirmed_by_both: true,
      acceptance_count: 2,
      proposal_version: PROPOSAL_VERSION,
      roster_fingerprint: "a".repeat(32),
    }],
  ])("requires the exact durable mediation receipt and rejects %s", (_name, metadata) => {
    const candidates = buildMediationDecisionFollowUpCandidates({
      coupleId: COUPLE_ID,
      recipientUserId: BRIDE_ID,
      currentRoster: { brideUserId: BRIDE_ID, groomUserId: GROOM_ID },
      safety: {
        violence: false,
        coercion: false,
        privateSafetyHold: false,
      },
      decisions: [confirmedMediationDecision({ metadata })],
      now: new Date("2026-08-11T00:00:00.000Z"),
    });

    expect(candidates).toEqual([]);
  });

  it("never copies raw chat, requester summaries, titles, reasoning, or partner-state guesses", () => {
    const rawChat = "PRIVATE_RAW_DO_NOT_COPY";
    const requesterSummary = "REQUESTER_SUMMARY_DO_NOT_COPY";
    const partnerGuess = "PARTNER_STATE_GUESS_DO_NOT_COPY";
    const candidates = buildMediationDecisionFollowUpCandidates({
      coupleId: COUPLE_ID,
      recipientUserId: BRIDE_ID,
      currentRoster: { brideUserId: BRIDE_ID, groomUserId: GROOM_ID },
      safety: {
        violence: false,
        coercion: false,
        privateSafetyHold: false,
      },
      decisions: [confirmedMediationDecision({
        title: rawChat,
        chosen_value: { value: requesterSummary },
        reasoning: partnerGuess,
        metadata: {
          confirmed_by_both: true,
          acceptance_count: 2,
          proposal_version: PROPOSAL_VERSION,
          roster_fingerprint: ROSTER_FINGERPRINT,
          requester_summary: requesterSummary,
          raw_private_text: rawChat,
          partner_emotion: partnerGuess,
        },
      })],
      now: new Date("2026-08-11T00:00:00.000Z"),
    });

    expect(candidates).toHaveLength(1);
    const serialized = JSON.stringify(candidates[0]);
    expect(serialized).not.toContain(rawChat);
    expect(serialized).not.toContain(requesterSummary);
    expect(serialized).not.toContain(partnerGuess);
  });
});
