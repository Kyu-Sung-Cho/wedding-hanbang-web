import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { GET } from "./route";

const OWNER = "10000000-0000-4000-8000-000000000001";
const QUESTION = "20000000-0000-4000-8000-000000000001";

function request(path = "/api/community/decision-threads/inbox") {
  return new Request(`http://localhost${path}`, {
    headers: { authorization: "Bearer access-token" },
  });
}

describe("GET /api/community/decision-threads/inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: OWNER } },
      error: null,
    });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: mocks.getUser },
    });
    mocks.createAdminClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({
      data: {
        waitingReplies: {
          count: 1,
          targetQuestionId: QUESTION,
          targetStatus: "private_waitlist",
        },
        experienceNeeded: { count: 0, targetThreadId: null },
        returnedOutcomes: { count: 0, targetThreadId: null },
      },
      error: null,
    });
  });

  it("returns only the current owner's strictly parsed factual lanes", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      waitingReplies: {
        count: 1,
        targetQuestionId: QUESTION,
        targetStatus: "private_waitlist",
      },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "community_get_decision_inbox",
      { p_viewer_id: OWNER },
    );
  });

  it("requires authentication before using the service projection", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed for invented counts, leaked shapes, and query expansion", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        waitingReplies: {
          count: 0,
          targetQuestionId: null,
          targetStatus: null,
        },
        experienceNeeded: { count: 3, targetThreadId: null },
        returnedOutcomes: { count: 0, targetThreadId: null },
      },
      error: null,
    });
    expect((await GET(request())).status).toBe(503);

    mocks.rpc.mockResolvedValueOnce({
      data: {
        waitingReplies: {
          count: 0,
          targetQuestionId: null,
          targetStatus: null,
        },
        experienceNeeded: { count: 0, targetThreadId: null },
        returnedOutcomes: { count: 0, targetThreadId: null },
        responderIds: [OWNER],
      },
      error: null,
    });
    expect((await GET(request())).status).toBe(503);

    expect((await GET(request(
      "/api/community/decision-threads/inbox?ownerId=" + OWNER,
    ))).status).toBe(400);
  });
});
