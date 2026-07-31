import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  checkCommunityWriteAccess: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/community/writeAccess", () => ({
  checkCommunityWriteAccess: mocks.checkCommunityWriteAccess,
}));

import { PATCH } from "./route";

const COMMENT_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OUTSIDER_ID = "33333333-3333-4333-8333-333333333333";

function request(content = "수정한 안전한 답변") {
  return new Request(`http://localhost/api/community/comments/${COMMENT_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

function commentQuery(existingAuthorId: string) {
  const readSingle = vi.fn(async () => ({
    data: {
      id: COMMENT_ID,
      author_id: existingAuthorId,
      is_deleted: false,
    },
    error: null,
  }));
  const updateSingle = vi.fn(async () => ({
    data: {
      id: COMMENT_ID,
      author_id: existingAuthorId,
      content: "수정한 안전한 답변",
      is_deleted: false,
    },
    error: null,
  }));
  const updateChain = {
    eq: vi.fn(),
    select: vi.fn(() => ({ single: updateSingle })),
  };
  updateChain.eq.mockReturnValue(updateChain);

  return {
    query: {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single: readSingle })),
      })),
      update: vi.fn(() => updateChain),
    },
    readSingle,
    update: vi.fn(),
    updateChain,
    updateSingle,
  };
}

function harness(options: {
  actorId: string;
  serviceAuthorId?: string;
  userScopedAuthorId?: string;
  isAdmin?: boolean;
}) {
  const serviceComments = commentQuery(options.serviceAuthorId ?? OWNER_ID);
  const userComments = commentQuery(
    options.userScopedAuthorId ?? options.actorId,
  );

  const serviceClient = {
    from: vi.fn((table: string) => {
      if (table === "community_comments") return serviceComments.query;
      if (table === "profiles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: { is_admin: options.isAdmin === true },
                error: null,
              })),
            })),
          })),
        };
      }
      throw new Error(`Unexpected service table: ${table}`);
    }),
  };
  const requestClient = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: options.actorId } },
      })),
    },
    from: vi.fn((table: string) => {
      if (table === "community_comments") return userComments.query;
      throw new Error(`Unexpected request table: ${table}`);
    }),
  };

  mocks.createAdminClient.mockReturnValue(serviceClient);
  mocks.createClientFromRequest.mockResolvedValue(requestClient);
  return {
    requestClient,
    serviceClient,
    serviceComments,
    userComments,
  };
}

describe("PATCH /api/community/comments/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkCommunityWriteAccess.mockResolvedValue({ allowed: true });
  });

  it("rechecks ownership and persists through the service-role client", async () => {
    const state = harness({ actorId: OWNER_ID, serviceAuthorId: OWNER_ID });

    const response = await PATCH(request() as never, {
      params: Promise.resolve({ id: COMMENT_ID }),
    });

    expect(response.status).toBe(200);
    expect(state.requestClient.from).not.toHaveBeenCalled();
    expect(state.serviceComments.query.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: "수정한 안전한 답변" }),
    );
    expect(state.serviceComments.updateChain.eq).toHaveBeenCalledWith(
      "id",
      COMMENT_ID,
    );
    expect(state.serviceComments.updateChain.eq).toHaveBeenCalledWith(
      "author_id",
      OWNER_ID,
    );
    expect(state.serviceComments.updateChain.eq).toHaveBeenCalledWith(
      "is_deleted",
      false,
    );
  });

  it("does not trust a user-scoped ownership result for another member", async () => {
    const state = harness({
      actorId: OUTSIDER_ID,
      serviceAuthorId: OWNER_ID,
      userScopedAuthorId: OUTSIDER_ID,
    });

    const response = await PATCH(request() as never, {
      params: Promise.resolve({ id: COMMENT_ID }),
    });

    expect(response.status).toBe(403);
    expect(state.requestClient.from).not.toHaveBeenCalled();
    expect(state.serviceComments.query.update).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: "수정 권한이 없습니다.",
    });
  });
});
