import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCommunityDecisionFeed,
  parseCommunityDecisionInbox,
} from "@hanbang/shared/community-decision-feed";

const UUIDS = {
  thread: "10000000-0000-4000-8000-000000000001",
  post: "20000000-0000-4000-8000-000000000001",
  outcome: "30000000-0000-4000-8000-000000000001",
};

function feedItem() {
  return {
    threadId: UUIDS.thread,
    postId: UUIDS.post,
    state: "completed",
    version: 4,
    kind: "experience_question",
    topicCategory: "contract_extra_cost",
    experienceScope: "extra_charge",
    coarseRegion: "서울",
    preparationStage: "contracted",
    contractPhase: "after_contract",
    desiredAnswer: "추가 비용을 확인한 방법",
    title: "계약 뒤 추가금은 어떻게 확인했나요?",
    content: "원본 파일 비용이 별도인지 먼저 겪은 분의 경험이 궁금해요.",
    contentOrigin: "member",
    commercialRelationship: "none",
    sponsorshipDetail: null,
    author: { nickname: "준비하는봄", badge: "member" },
    qualifiedPeerAnswerCount: 2,
    qualifiedProfessionalAnswerCount: 0,
    viewer: { isAuthor: false, canAnswer: false },
    outcome: {
      id: UUIDS.outcome,
      revision: 1,
      actionTaken: "계약서 문구를 확인했어요.",
      resultSummary: "추가금 없이 원본을 받았어요.",
      applicableConditions: "계약 전 원본 조항이 없을 때 해당해요.",
      commercialRelationship: "none",
      sponsorshipDetail: null,
      createdAt: "2026-08-04T03:00:00.000Z",
    },
    createdAt: "2026-08-03T03:00:00.000Z",
    sortAt: "2026-08-04T03:00:00.000Z",
  };
}

test("decision feed accepts only the minimal reviewed projection", () => {
  const parsed = parseCommunityDecisionFeed({
    items: [feedItem()],
    nextCursor: null,
    hasMore: false,
    mode: "outcomes",
  }, "outcomes");
  assert.equal(parsed?.items[0]?.threadId, UUIDS.thread);

  const leaked = feedItem();
  leaked.responder_request_id = UUIDS.outcome;
  assert.equal(parseCommunityDecisionFeed({
    items: [leaked],
    nextCursor: null,
    hasMore: false,
    mode: "outcomes",
  }), null);
});

test("decision inbox rejects invented counts without a durable target", () => {
  assert.deepEqual(parseCommunityDecisionInbox({
    waitingReplies: {
      count: 1,
      targetQuestionId: UUIDS.thread,
      targetStatus: "private_waitlist",
    },
    experienceNeeded: { count: 0, targetThreadId: null },
    returnedOutcomes: { count: 0, targetThreadId: null },
  })?.waitingReplies, {
    count: 1,
    targetQuestionId: UUIDS.thread,
    targetStatus: "private_waitlist",
  });

  assert.equal(parseCommunityDecisionInbox({
    waitingReplies: {
      count: 0,
      targetQuestionId: null,
      targetStatus: null,
    },
    experienceNeeded: { count: 3, targetThreadId: null },
    returnedOutcomes: { count: 0, targetThreadId: null },
  }), null);
});
