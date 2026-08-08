import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { GET } from "./route";

const VIEWER_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_ID = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";

function authClient(userId: string | null, error: unknown = null) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: userId ? { id: userId } : null },
        error,
      })),
    },
  };
}

function feedItem() {
  return {
    threadId: THREAD_ID,
    postId: POST_ID,
    state: "open",
    version: 1,
    kind: "experience_question",
    topicCategory: "contract_extra_cost",
    experienceScope: "extra_charge",
    coarseRegion: "서울",
    preparationStage: "contract_review",
    contractPhase: "before_contract",
    desiredAnswer: "계약서에 확인할 문구와 실제 대응 순서",
    title: "계약 뒤 추가 비용을 요청받으면 어떻게 확인하나요?",
    content: "계약 범위와 추가 비용을 실제로 확인한 경험이 궁금해요.",
    contentOrigin: "member",
    commercialRelationship: "none",
    sponsorshipDetail: null,
    author: { nickname: "준비하는두분", badge: "member" },
    qualifiedPeerAnswerCount: 1,
    qualifiedProfessionalAnswerCount: 0,
    viewer: { isAuthor: false, canAnswer: false },
    outcome: null,
    createdAt: "2026-08-04T03:00:00.000Z",
    sortAt: "2026-08-04T03:00:00.000Z",
  };
}

describe("GET DecisionThread feed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows a credential-free public discovery read", async () => {
    mocks.createClientFromRequest.mockResolvedValue(
      authClient(null, { name: "AuthSessionMissingError" }),
    );
    const rpc = vi.fn(async () => ({
      data: {
        items: [feedItem()],
        nextCursor: null,
        hasMore: false,
        mode: "for_you",
      },
      error: null,
    }));
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await GET(new NextRequest(
      "https://hanbang.ai/api/community/decision-threads?mode=for_you&limit=10",
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [feedItem()],
      nextCursor: null,
      hasMore: false,
      mode: "for_you",
    });
    expect(rpc).toHaveBeenCalledWith(
      "community_list_decision_threads",
      {
        p_viewer_id: null,
        p_mode: "for_you",
        p_cursor_at: null,
        p_cursor_id: null,
        p_limit: 10,
      },
    );
  });

  it("requires login for the factual assigned-responder lane", async () => {
    mocks.createClientFromRequest.mockResolvedValue(authClient(null));
    const rpc = vi.fn();
    mocks.createAdminClient.mockReturnValue({ rpc });
    const response = await GET(new NextRequest(
      "https://hanbang.ai/api/community/decision-threads?mode=needs_help",
    ));
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses the authenticated viewer for visibility and assignment checks", async () => {
    mocks.createClientFromRequest.mockResolvedValue(authClient(VIEWER_ID));
    const rpc = vi.fn(async () => ({
      data: {
        items: [],
        nextCursor: null,
        hasMore: false,
        mode: "needs_help",
      },
      error: null,
    }));
    mocks.createAdminClient.mockReturnValue({ rpc });
    const response = await GET(new NextRequest(
      "https://hanbang.ai/api/community/decision-threads?mode=needs_help",
      { headers: { authorization: "Bearer valid-session" } },
    ));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "community_list_decision_threads",
      expect.objectContaining({ p_viewer_id: VIEWER_ID, p_mode: "needs_help" }),
    );
  });

  it("fails closed on response contract drift", async () => {
    mocks.createClientFromRequest.mockResolvedValue(authClient(VIEWER_ID));
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: {
          items: [{ ...feedItem(), authorId: VIEWER_ID }],
          nextCursor: null,
          hasMore: false,
          mode: "for_you",
        },
        error: null,
      })),
    });
    const response = await GET(new NextRequest(
      "https://hanbang.ai/api/community/decision-threads",
    ));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_DECISION_STATE_UNCONFIRMED",
    });
  });

  it("rejects repeated or half-present cursors before the RPC", async () => {
    mocks.createClientFromRequest.mockResolvedValue(authClient(VIEWER_ID));
    const rpc = vi.fn();
    mocks.createAdminClient.mockReturnValue({ rpc });
    const response = await GET(new NextRequest(
      "https://hanbang.ai/api/community/decision-threads?mode=for_you&mode=outcomes&cursorAt=2026-08-04T03%3A00%3A00.000Z",
    ));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
