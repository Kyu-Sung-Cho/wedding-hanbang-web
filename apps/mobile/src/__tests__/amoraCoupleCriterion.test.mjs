import assert from "node:assert/strict";
import test from "node:test";

import {
  AMORA_COUPLE_CRITERION_CONTRACT_VERSION,
  buildAmoraCoupleCriterionAcceptRequest,
  buildAmoraCoupleCriterionCancelRequest,
  buildAmoraCoupleCriterionProposeRequest,
  parseAmoraCoupleCriterionAcceptRequest,
  parseAmoraCoupleCriterionResponse,
} from "@hanbang/shared/amora-couple-criterion";

const BRIDE = "11111111-1111-4111-8111-111111111111";
const GROOM = "22222222-2222-4222-8222-222222222222";
const PROPOSAL = "33333333-3333-4333-8333-333333333333";
const DECISION = "44444444-4444-4444-8444-444444444444";
const COUPLE = "55555555-5555-4555-8555-555555555555";

test("a couple criterion stays pending until both exact roster members confirm the reviewed sentence", () => {
  const pending = parseAmoraCoupleCriterionResponse({
    version: AMORA_COUPLE_CRITERION_CONTRACT_VERSION,
    coupleId: COUPLE,
    linked: true,
    current: {
      decisionId: DECISION,
      value: "우리 둘이 편안한 하루",
      confirmedAt: "2026-08-14T10:00:00.000Z",
    },
    proposal: {
      id: PROPOSAL,
      value: "가족보다 우리 둘 기준을 먼저 확인하기",
      revision: 1,
      proposerUserId: BRIDE,
      brideUserId: BRIDE,
      groomUserId: GROOM,
      acceptedUserIds: [BRIDE],
      createdAt: "2026-08-14T11:00:00.000Z",
      updatedAt: "2026-08-14T11:00:00.000Z",
    },
  });

  assert.deepEqual(pending?.proposal?.acceptedUserIds, [BRIDE]);
  assert.equal(pending?.current?.value, "우리 둘이 편안한 하루");
  assert.equal(parseAmoraCoupleCriterionResponse({
    ...pending,
    proposal: { ...pending?.proposal, acceptedUserIds: [BRIDE, GROOM, GROOM] },
  }), null);
  const missingCoupleBinding = pending ? {
    version: pending.version,
    linked: pending.linked,
    current: pending.current,
    proposal: pending.proposal,
  } : {};
  assert.equal(parseAmoraCoupleCriterionResponse(missingCoupleBinding), null);
});

test("couple criterion mutations bind the reviewed sentence and exact proposal revision to one couple", () => {
  assert.deepEqual(buildAmoraCoupleCriterionProposeRequest({
    expectedCoupleId: COUPLE,
    expectedCurrentDecisionId: DECISION,
    requestId: "66666666-6666-4666-8666-666666666666",
    value: "  우리 둘의 휴식을 먼저 지키기  ",
  }), {
    version: 1,
    expectedCoupleId: COUPLE,
    expectedCurrentDecisionId: DECISION,
    requestId: "66666666-6666-4666-8666-666666666666",
    value: "우리 둘의 휴식을 먼저 지키기",
  });

  assert.deepEqual(buildAmoraCoupleCriterionAcceptRequest({
    expectedCoupleId: COUPLE,
    proposalId: PROPOSAL,
    expectedRevision: 1,
    requestId: "77777777-7777-4777-8777-777777777777",
  }), {
    version: 1,
    expectedCoupleId: COUPLE,
    proposalId: PROPOSAL,
    expectedRevision: 1,
    requestId: "77777777-7777-4777-8777-777777777777",
  });

  assert.deepEqual(buildAmoraCoupleCriterionCancelRequest({
    expectedCoupleId: COUPLE,
    proposalId: PROPOSAL,
    expectedRevision: 1,
    requestId: "88888888-8888-4888-8888-888888888888",
  }), {
    version: 1,
    expectedCoupleId: COUPLE,
    proposalId: PROPOSAL,
    expectedRevision: 1,
    requestId: "88888888-8888-4888-8888-888888888888",
  });

  assert.equal(parseAmoraCoupleCriterionAcceptRequest({
    version: 1,
    expectedCoupleId: COUPLE,
    proposalId: PROPOSAL,
    expectedRevision: 1,
    requestId: "77777777-7777-4777-8777-777777777777",
    privateOriginal: "공유하면 안 되는 원문",
  }), null);
});
