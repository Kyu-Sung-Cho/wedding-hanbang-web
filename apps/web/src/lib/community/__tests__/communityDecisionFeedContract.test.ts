import {
  parseCommunityDecisionFeed,
  parseCommunityDecisionPublicOutcome,
} from "@hanbang/shared/community-decision-feed";
import { describe, expect, it } from "vitest";

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const POST_ID = "22222222-2222-4222-8222-222222222222";
const OUTCOME_ID = "33333333-3333-4333-8333-333333333333";

function outcome(overrides: Record<string, unknown> = {}) {
  return {
    id: OUTCOME_ID,
    revision: 1,
    actionTaken: "계약서 문구를 다시 확인했어요.",
    resultSummary: "추가 비용 범위를 문서로 확인했어요.",
    applicableConditions: "계약 전에 특약을 바꿀 수 있는 경우",
    commercialRelationship: "none",
    sponsorshipDetail: null,
    createdAt: "2026-08-04T04:00:00.000Z",
    ...overrides,
  };
}

function feedItem(overrides: Record<string, unknown> = {}) {
  return {
    threadId: THREAD_ID,
    postId: POST_ID,
    state: "completed",
    version: 3,
    kind: "experience_question",
    topicCategory: "contract_extra_cost",
    experienceScope: "extra_charge",
    coarseRegion: "서울",
    preparationStage: "contract_review",
    contractPhase: "before_contract",
    desiredAnswer: "추가 비용을 확인한 순서가 궁금해요.",
    title: "계약 전 추가 비용을 어떻게 확인하셨나요?",
    content: "계약 전에 확인한 실제 경험을 듣고 싶어요.",
    contentOrigin: "member",
    commercialRelationship: "none",
    sponsorshipDetail: null,
    author: { nickname: "준비하는둘", badge: "계약 경험" },
    qualifiedPeerAnswerCount: 1,
    qualifiedProfessionalAnswerCount: 0,
    viewer: { isAuthor: false, canAnswer: false },
    outcome: outcome(),
    createdAt: "2026-08-04T01:00:00.000Z",
    sortAt: "2026-08-04T04:00:00.000Z",
    ...overrides,
  };
}

describe("community decision feed disclosure contract", () => {
  it("accepts a fully disclosed reviewed commercial outcome", () => {
    const parsed = parseCommunityDecisionPublicOutcome({
      outcome: outcome({
        commercialRelationship: "discount",
        sponsorshipDetail: "답변 작성 뒤 플랫폼 조사 할인권을 받았어요.",
      }),
    });
    expect(parsed?.outcome?.commercialRelationship).toBe("discount");
  });

  it("rejects a reviewed commercial outcome whose disclosure is absent", () => {
    expect(parseCommunityDecisionPublicOutcome({
      outcome: outcome({
        commercialRelationship: "discount",
        sponsorshipDetail: null,
      }),
    })).toBeNull();
  });

  it("rejects an organic feed item with an inconsistent relationship disclosure", () => {
    expect(parseCommunityDecisionFeed({
      items: [feedItem({
        commercialRelationship: "none",
        sponsorshipDetail: "관계 없음인데 설명이 붙은 모순",
      })],
      nextCursor: null,
      hasMore: false,
      mode: "for_you",
    }, "for_you")).toBeNull();
  });
});
