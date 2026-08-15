import { describe, expect, it } from "vitest";

import {
  MEDIATION_OUTCOME_FOLLOW_UP_CHOICES,
  validateMediationOutcomeFollowUpReceiptResponse,
  validateMediationOutcomeFollowUpRequest,
  validateMediationOutcomeFollowUpResponse,
} from "@hanbang/shared";

const RECIPIENT_ID = "10000000-0000-4000-8000-000000000001";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";

function readyResponse() {
  return {
    version: 1,
    state: "ready",
    recipientUserId: RECIPIENT_ID,
    coupleId: COUPLE_ID,
    card: {
      id: "30000000-0000-4000-8000-000000000001",
      revision: 1,
      sourceDigest: "a".repeat(64),
      outcomeIdempotencyKey: "40000000-0000-4000-8000-000000000001",
      kind: "mediation_outcome_follow_up",
      visibility: "private",
      title: "둘이 확인한 조율, 지금은 어떤가요?",
      question: "지금 그 조율은 어떻게 되었나요?",
      confirmed: ["두 분이 직접 확인한 조율안이 있어요."],
      unknown: ["지금 실제 결과는 아직 확인하지 않았어요."],
      impact: "내 선택은 나에게만 보이며 공동 기록이나 상대 카드에는 영향을 주지 않아요.",
      choices: MEDIATION_OUTCOME_FOLLOW_UP_CHOICES.map((choice) => ({ ...choice })),
      safeguards: {
        automaticSharedMutation: false,
        automaticRemediation: false,
      },
      eligibleAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-09-10T00:00:00.000Z",
    },
  };
}

describe("recipient-private mediation outcome follow-up contract", () => {
  it("accepts only the exact owner-bound ready card shape", () => {
    expect(validateMediationOutcomeFollowUpResponse(
      readyResponse(),
      RECIPIENT_ID,
      COUPLE_ID,
    )).toMatchObject({ ok: true });

    expect(validateMediationOutcomeFollowUpResponse(
      { ...readyResponse(), requesterSummary: "절대 노출 금지" },
      RECIPIENT_ID,
      COUPLE_ID,
    )).toEqual({ ok: false, reason: "state" });

    expect(validateMediationOutcomeFollowUpResponse(
      readyResponse(),
      "10000000-0000-4000-8000-000000000002",
      COUPLE_ID,
    )).toEqual({ ok: false, reason: "owner" });

    expect(validateMediationOutcomeFollowUpResponse(
      readyResponse(),
      RECIPIENT_ID,
      "20000000-0000-4000-8000-000000000002",
    )).toEqual({ ok: false, reason: "couple" });

    expect(validateMediationOutcomeFollowUpResponse(
      {
        ...readyResponse(),
        card: {
          ...readyResponse().card,
          confirmed: ["REQUESTER_SUMMARY_MUST_NOT_RENDER"],
        },
      },
      RECIPIENT_ID,
      COUPLE_ID,
    )).toEqual({ ok: false, reason: "card" });
  });

  it("binds a bounded personal outcome to the exact card CAS and receipt", () => {
    const request = {
      cardId: "30000000-0000-4000-8000-000000000001",
      cardRevision: 1,
      sourceDigest: "a".repeat(64),
      outcome: "blocked",
      idempotencyKey: "40000000-0000-4000-8000-000000000001",
    };
    expect(validateMediationOutcomeFollowUpRequest(request)).toMatchObject({ ok: true });
    expect(validateMediationOutcomeFollowUpRequest({
      ...request,
      note: "자유서술은 저장하지 않아요",
    })).toEqual({ ok: false, reason: "outcome" });
    expect(validateMediationOutcomeFollowUpRequest({
      ...request,
      outcome: "retry_mediation",
    })).toEqual({ ok: false, reason: "outcome" });

    const response = {
      version: 1,
      recipientUserId: RECIPIENT_ID,
      coupleId: COUPLE_ID,
      receipt: {
        id: "50000000-0000-4000-8000-000000000001",
        cardId: request.cardId,
        cardRevision: request.cardRevision,
        sourceDigest: request.sourceDigest,
        outcome: request.outcome,
        recordedAt: "2026-08-12T00:00:00.000Z",
        idempotencyKey: request.idempotencyKey,
      },
    };
    expect(validateMediationOutcomeFollowUpReceiptResponse(
      response,
      RECIPIENT_ID,
      COUPLE_ID,
    )).toMatchObject({ ok: true });
    expect(validateMediationOutcomeFollowUpReceiptResponse(
      { ...response, partnerCardState: "recorded" },
      RECIPIENT_ID,
      COUPLE_ID,
    )).toEqual({ ok: false, reason: "receipt" });
  });
});
