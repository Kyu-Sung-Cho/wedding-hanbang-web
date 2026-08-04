import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  rateLimitKey: vi.fn(() => "admin-decision-review:test"),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

import { GET } from "./route";
import { PATCH } from "./[outcomeId]/review/route";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const OUTCOME_ID = "22222222-2222-4222-8222-222222222222";
const THREAD_ID = "33333333-3333-4333-8333-333333333333";
const OPERATION_KEY = "44444444-4444-4444-8444-444444444444";

function queueItem() {
  return {
    outcomeId: OUTCOME_ID,
    threadId: THREAD_ID,
    revision: 1,
    publicationState: "pending_review",
    sourceAvailable: true,
    authorNickname: "준비하는두분",
    title: "계약 범위 밖 추가 비용을 어떻게 확인했나요?",
    sourceContent: "계약서와 견적서를 비교한 실제 경험을 묻습니다.",
    desiredAnswer: "업체에 확인할 문구와 순서",
    actionTaken: "계약서의 포함 범위를 서면으로 다시 확인했습니다.",
    resultSummary: "추가 결제 없이 원래 범위로 진행했습니다.",
    applicableConditions: "같은 항목이 계약서에 포함된 경우입니다.",
    commercialRelationship: "none",
    sponsorshipDetail: null,
    selectedEvidence: [{
      content: "계약 조항 번호와 견적 항목을 함께 보내 확인했습니다.",
      contentOrigin: "member",
      applicability: "taken_as_next_action",
      commercialRelationship: "none",
      sponsorshipDetail: null,
    }],
    createdAt: "2026-08-04T03:00:00.000Z",
    reviewedAt: null,
    reviewReason: null,
    reviewPolicyVersion: null,
    publishedAt: null,
    withdrawnAt: null,
    withdrawnReason: null,
  };
}

describe("admin DecisionThread outcome review API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAdmin.mockResolvedValue({
      authorized: true,
      userId: ADMIN_ID,
    });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("returns a strict private review queue", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        items: [queueItem()],
        nextCursor: null,
        hasMore: false,
        state: "pending_review",
      },
      error: null,
    }));
    mocks.getServiceClient.mockReturnValue({ rpc });

    const response = await GET(new NextRequest(
      "https://hanbang.ai/api/admin/community/decision-outcomes?state=pending_review&limit=20",
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      items: [queueItem()],
      nextCursor: null,
      hasMore: false,
      state: "pending_review",
    });
    expect(rpc).toHaveBeenCalledWith(
      "community_list_decision_outcome_reviews",
      {
        p_state: "pending_review",
        p_cursor_at: null,
        p_cursor_id: null,
        p_limit: 20,
      },
    );
  });

  it("fails closed if the queue contains an internal identity", async () => {
    mocks.getServiceClient.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: {
          items: [{ ...queueItem(), authorId: ADMIN_ID }],
          nextCursor: null,
          hasMore: false,
          state: "pending_review",
        },
        error: null,
      })),
    });
    const response = await GET(new NextRequest(
      "https://hanbang.ai/api/admin/community/decision-outcomes",
    ));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_DECISION_PUBLICATION_QUEUE_UNCONFIRMED",
    });
  });

  it("rejects cross-site review before admin verification", async () => {
    const response = await PATCH(
      new NextRequest(
        `https://hanbang.ai/api/admin/community/decision-outcomes/${OUTCOME_ID}/review`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "idempotency-key": OPERATION_KEY,
            "sec-fetch-site": "cross-site",
          },
          body: JSON.stringify({
            decision: "publish",
            reason: "사람이 원문과 공개 범위를 확인했습니다.",
            policyVersion: "p0-human-v1",
          }),
        },
      ),
      { params: Promise.resolve({ outcomeId: OUTCOME_ID }) },
    );
    expect(response.status).toBe(403);
    expect(mocks.verifyAdmin).not.toHaveBeenCalled();
  });

  it("records a human publish decision with an exact receipt", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        receiptVersion: 1,
        operationKey: OPERATION_KEY,
        outcomeId: OUTCOME_ID,
        threadId: THREAD_ID,
        revision: 1,
        publicationState: "published",
        reviewedAt: "2026-08-04T04:00:00.000Z",
        replayed: false,
      },
      error: null,
    }));
    mocks.getServiceClient.mockReturnValue({ rpc });
    const response = await PATCH(
      new NextRequest(
        `https://hanbang.ai/api/admin/community/decision-outcomes/${OUTCOME_ID}/review`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "idempotency-key": OPERATION_KEY,
            "sec-fetch-site": "same-origin",
          },
          body: JSON.stringify({
            decision: "publish",
            reason: "사람이 원문과 공개 범위를 확인했습니다.",
            policyVersion: "p0-human-v1",
          }),
        },
      ),
      { params: Promise.resolve({ outcomeId: OUTCOME_ID }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      outcomeId: OUTCOME_ID,
      threadId: THREAD_ID,
      revision: 1,
      publicationState: "published",
      reviewedAt: "2026-08-04T04:00:00.000Z",
      replayed: false,
    });
    expect(rpc).toHaveBeenCalledWith(
      "community_review_decision_outcome",
      {
        p_admin_id: ADMIN_ID,
        p_outcome_id: OUTCOME_ID,
        p_decision: "publish",
        p_reason: "사람이 원문과 공개 범위를 확인했습니다.",
        p_policy_version: "p0-human-v1",
        p_operation_key: OPERATION_KEY,
      },
    );
  });

  it("lets only an exact completed review replay bypass the rate gate", async () => {
    const durableReceipt = {
      receiptVersion: 1,
      operationKey: OPERATION_KEY,
      outcomeId: OUTCOME_ID,
      threadId: THREAD_ID,
      revision: 1,
      publicationState: "published",
      reviewedAt: "2026-08-04T04:00:00.000Z",
      replayed: false,
    };
    const rpc = vi.fn(async (operation: string) => (
      operation === "community_has_completed_decision_publication_command"
        ? { data: true, error: null }
        : { data: durableReceipt, error: null }
    ));
    mocks.getServiceClient.mockReturnValue({ rpc });
    mocks.checkRateLimitPersistent.mockResolvedValue(
      NextResponse.json({ code: "RATE_LIMITED" }, { status: 429 }),
    );
    const makeRequest = () => new NextRequest(
      `https://hanbang.ai/api/admin/community/decision-outcomes/${OUTCOME_ID}/review`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "idempotency-key": OPERATION_KEY,
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({
          decision: "publish",
          reason: "Human review confirmed source and privacy.",
          policyVersion: "p0-human-v1",
        }),
      },
    );

    const first = await PATCH(makeRequest(), {
      params: Promise.resolve({ outcomeId: OUTCOME_ID }),
    });
    const replay = await PATCH(makeRequest(), {
      params: Promise.resolve({ outcomeId: OUTCOME_ID }),
    });
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    expect(rpc).toHaveBeenCalledWith(
      "community_has_completed_decision_publication_command",
      {
        p_actor_id: ADMIN_ID,
        p_operation: "review_publish",
        p_operation_key: OPERATION_KEY,
        p_outcome_id: OUTCOME_ID,
        p_payload: {
          outcomeId: OUTCOME_ID,
          decision: "publish",
          reason: "Human review confirmed source and privacy.",
          policyVersion: "p0-human-v1",
        },
      },
    );
  });

  it("keeps a new rate-limited review command outside the replay boundary", async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    mocks.getServiceClient.mockReturnValue({ rpc });
    mocks.checkRateLimitPersistent.mockResolvedValue(
      NextResponse.json({ code: "RATE_LIMITED" }, { status: 429 }),
    );
    const response = await PATCH(
      new NextRequest(
        `https://hanbang.ai/api/admin/community/decision-outcomes/${OUTCOME_ID}/review`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "idempotency-key": OPERATION_KEY,
            "sec-fetch-site": "same-origin",
          },
          body: JSON.stringify({
            decision: "reject",
            reason: "This is a new review decision.",
            policyVersion: "p0-human-v1",
          }),
        },
      ),
      { params: Promise.resolve({ outcomeId: OUTCOME_ID }) },
    );
    expect(response.status).toBe(429);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "community_has_completed_decision_publication_command",
      expect.objectContaining({ p_operation: "review_reject" }),
    );
  });

  it("maps unavailable source to a non-publishing conflict", async () => {
    mocks.getServiceClient.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: null,
        error: {
          code: "55000",
          message: "COMMUNITY_DECISION_PUBLICATION_SOURCE_UNAVAILABLE",
        },
      })),
    });
    const response = await PATCH(
      new NextRequest(
        `https://hanbang.ai/api/admin/community/decision-outcomes/${OUTCOME_ID}/review`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "idempotency-key": OPERATION_KEY,
            "sec-fetch-site": "same-origin",
          },
          body: JSON.stringify({
            decision: "publish",
            reason: "사람이 확인했지만 원문이 비공개로 전환됐습니다.",
            policyVersion: "p0-human-v1",
          }),
        },
      ),
      { params: Promise.resolve({ outcomeId: OUTCOME_ID }) },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_DECISION_PUBLICATION_SOURCE_UNAVAILABLE",
    });
  });
});
