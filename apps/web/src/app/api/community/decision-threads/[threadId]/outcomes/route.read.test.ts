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

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const OUTCOME_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function request() {
  return new NextRequest(
    `https://hanbang.ai/api/community/decision-threads/${THREAD_ID}/outcomes`,
  );
}

describe("DecisionThread reviewed public outcome read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
    });
  });

  it("returns only the current reviewed projection for the captured viewer", async () => {
    const projection = {
      id: OUTCOME_ID,
      revision: 2,
      actionTaken: "계약 전 특약 문구를 다시 요청했어요.",
      resultSummary: "추가금 조건을 문서로 분리해 확인했어요.",
      applicableConditions: "본계약 전에 특약을 수정할 수 있었던 경우",
      commercialRelationship: "none",
      sponsorshipDetail: null,
      createdAt: "2026-08-04T04:00:00.000Z",
    };
    const rpc = vi.fn(async () => ({ data: projection, error: null }));
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await GET(request(), {
      params: Promise.resolve({ threadId: THREAD_ID }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    await expect(response.json()).resolves.toEqual({ outcome: projection });
    expect(rpc).toHaveBeenCalledWith(
      "community_get_decision_public_outcome",
      { p_thread_id: THREAD_ID, p_viewer_id: USER_ID },
    );
  });

  it("returns a truthful empty projection after withdrawal or source loss", async () => {
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    });
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await GET(request(), {
      params: Promise.resolve({ threadId: THREAD_ID }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ outcome: null });
    expect(rpc).toHaveBeenCalledWith(
      "community_get_decision_public_outcome",
      { p_thread_id: THREAD_ID, p_viewer_id: null },
    );
  });

  it("returns the same exact reviewed projection to a guest without exposing identity", async () => {
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    });
    const projection = {
      id: OUTCOME_ID,
      revision: 3,
      actionTaken: "Asked for the signed scope.",
      resultSummary: "The duplicate charge was removed.",
      applicableConditions: "The signed scope lists the same item.",
      commercialRelationship: "none",
      sponsorshipDetail: null,
      createdAt: "2026-08-04T03:00:00.000Z",
    };
    const rpc = vi.fn(async () => ({ data: projection, error: null }));
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await GET(request(), {
      params: Promise.resolve({ threadId: THREAD_ID }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({ outcome: projection });
    expect(rpc).toHaveBeenCalledWith(
      "community_get_decision_public_outcome",
      { p_thread_id: THREAD_ID, p_viewer_id: null },
    );
  });

  it("does not downgrade a failed presented session into a guest read", async () => {
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { name: "AuthApiError" },
        })),
      },
    });
    const rpc = vi.fn();
    mocks.createAdminClient.mockReturnValue({ rpc });
    const authenticatedRequest = new NextRequest(
      `https://hanbang.ai/api/community/decision-threads/${THREAD_ID}/outcomes`,
      { headers: { authorization: "Bearer invalid-presented-session" } },
    );

    const response = await GET(authenticatedRequest, {
      params: Promise.resolve({ threadId: THREAD_ID }),
    });

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the service returns an undeclared private field", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: {
          id: OUTCOME_ID,
          revision: 1,
          actionTaken: "확인했어요.",
          resultSummary: "정리했어요.",
          applicableConditions: "계약 전",
          commercialRelationship: "none",
          sponsorshipDetail: null,
          createdAt: "2026-08-04T04:00:00.000Z",
          authorId: USER_ID,
        },
        error: null,
      })),
    });

    const response = await GET(request(), {
      params: Promise.resolve({ threadId: THREAD_ID }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_DECISION_STATE_UNCONFIRMED",
    });
  });
});
