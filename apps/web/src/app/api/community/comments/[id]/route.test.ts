import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  checkCommunityWriteAccess: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
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

import { DELETE, PATCH } from "./route";

const COMMENT_ID = "22222222-2222-4222-8222-222222222222";
const POST_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OUTSIDER_ID = "33333333-3333-4333-8333-333333333333";

function request(content = "수정한 안전한 답변") {
  return new Request(`http://localhost/api/community/comments/${COMMENT_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

function rawPatchRequest(body: BodyInit, headers: HeadersInit = {}) {
  return new Request(`http://localhost/api/community/comments/${COMMENT_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" as const } : {}),
  });
}

function commentQuery(
  existingAuthorId: string,
  options: { isDeleted?: boolean; authorDeletedAt?: string | null } = {},
) {
  const readSingle = vi.fn(async () => ({
    data: {
      id: COMMENT_ID,
      post_id: POST_ID,
      author_id: existingAuthorId,
      is_deleted: options.isDeleted === true,
      author_deleted_at: options.authorDeletedAt ?? null,
    },
    error: null,
  }));
  const updateSingle = vi.fn(async (): Promise<{
    data: {
      id: string;
      author_id: string;
      content: string;
      is_deleted: boolean;
    } | null;
    error: null;
  }> => ({
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
    is: vi.fn(),
    select: vi.fn(() => ({
      single: updateSingle,
      maybeSingle: updateSingle,
    })),
  };
  updateChain.eq.mockReturnValue(updateChain);
  updateChain.is.mockReturnValue(updateChain);

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
  commentIsDeleted?: boolean;
  authorDeletedAt?: string | null;
}) {
  const serviceComments = commentQuery(options.serviceAuthorId ?? OWNER_ID, {
    isDeleted: options.commentIsDeleted,
    authorDeletedAt: options.authorDeletedAt,
  });
  const userComments = commentQuery(
    options.userScopedAuthorId ?? options.actorId,
  );

  const deleteRpc = vi.fn(async () => ({
    data: {
      comment_id: COMMENT_ID,
      post_comment_count: 0,
    },
    error: null,
  }));
  const serviceClient = {
    rpc: deleteRpc,
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
      if (table === "community_posts") {
        const updateEq = vi.fn(async () => ({ data: null, error: null }));
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: { comment_count: 1 },
                error: null,
              })),
            })),
          })),
          update: vi.fn(() => ({ eq: updateEq })),
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
    deleteRpc,
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

  it("fails as not found when the comment author changes between read and write", async () => {
    const state = harness({ actorId: OWNER_ID, serviceAuthorId: OWNER_ID });
    state.serviceComments.updateSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST116", message: "row no longer matches" },
    } as never);

    const response = await PATCH(request() as never, {
      params: Promise.resolve({ id: COMMENT_ID }),
    });

    expect(state.serviceComments.updateChain.eq).toHaveBeenCalledWith(
      "author_id",
      OWNER_ID,
    );
    expect(response.status).toBe(404);
  });

  it("logs only a content-free category and code when a comment update fails", async () => {
    const state = harness({ actorId: OWNER_ID, serviceAuthorId: OWNER_ID });
    state.serviceComments.updateSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "DB998", message: "secret-comment-content-marker" },
    } as never);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await PATCH(request() as never, {
      params: Promise.resolve({ id: COMMENT_ID }),
    });

    expect(response.status).toBe(500);
    expect(errorLog).toHaveBeenCalledWith("[community.comments.patch]", {
      category: "database",
      code: "DB998",
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      "secret-comment-content-marker",
    );
    errorLog.mockRestore();
  });

  it("rejects a declared comment patch above 8 KiB before the service write", async () => {
    const state = harness({ actorId: OWNER_ID, serviceAuthorId: OWNER_ID });
    const oversized = rawPatchRequest("{}", {
      "content-length": String(8 * 1024 + 1),
    });

    const response = await PATCH(oversized as never, {
      params: Promise.resolve({ id: COMMENT_ID }),
    });

    expect(response.status).toBe(413);
    expect(oversized.bodyUsed).toBe(false);
    expect(state.serviceComments.query.update).not.toHaveBeenCalled();
  });

  it("rejects a streamed comment patch above 8 KiB without content-length", async () => {
    const state = harness({ actorId: OWNER_ID, serviceAuthorId: OWNER_ID });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(8 * 1024 + 1)));
        controller.close();
      },
    });
    const oversized = rawPatchRequest(stream);

    const response = await PATCH(oversized as never, {
      params: Promise.resolve({ id: COMMENT_ID }),
    });

    expect(oversized.headers.get("content-length")).toBeNull();
    expect(response.status).toBe(413);
    expect(state.serviceComments.query.update).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "{"],
    ["a non-object body", "[]"],
    ["an unknown mutation field", JSON.stringify({ content: "safe", author_id: OUTSIDER_ID })],
    ["a non-string content field", JSON.stringify({ content: 17 })],
  ])("rejects %s before the comment service write", async (_label, rawBody) => {
    const state = harness({ actorId: OWNER_ID, serviceAuthorId: OWNER_ID });

    const response = await PATCH(rawPatchRequest(rawBody) as never, {
      params: Promise.resolve({ id: COMMENT_ID }),
    });

    expect(response.status).toBe(400);
    expect(state.serviceComments.query.update).not.toHaveBeenCalled();
  });

  it.each([
    ['<a href="mailto:victim@example.com">contact</a>', "contact"],
    [
      '<img src="https://example.com/010-1234-5678.jpg" alt="010-1234-5678">safe reply',
      "safe reply",
    ],
  ])("strips hidden PII attributes before a comment edit", async (raw, expected) => {
    const state = harness({ actorId: OWNER_ID, serviceAuthorId: OWNER_ID });

    const response = await PATCH(request(raw) as never, {
      params: Promise.resolve({ id: COMMENT_ID }),
    });

    expect(response.status).toBe(200);
    expect(state.serviceComments.query.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: expected }),
    );
    expect(JSON.stringify(state.serviceComments.query.update.mock.calls)).not.toMatch(
      /victim@example\.com|010-1234-5678/iu,
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
  it("routes an administrator away from rewriting another author's comment", async () => {
    const state = harness({
      actorId: OUTSIDER_ID,
      serviceAuthorId: OWNER_ID,
      isAdmin: true,
    });
    const adminRequest = request("administrator rewrite");

    const response = await PATCH(adminRequest as never, {
      params: Promise.resolve({ id: COMMENT_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("COMMUNITY_ADMIN_EDIT_REQUIRES_AUDITED_ACTION");
    expect(adminRequest.bodyUsed).toBe(false);
    expect(state.serviceComments.query.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/community/comments/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records author deletion even while a moderation hold hides the comment", async () => {
    const state = harness({
      actorId: OWNER_ID,
      serviceAuthorId: OWNER_ID,
      commentIsDeleted: true,
      authorDeletedAt: null,
    });

    const response = await DELETE(
      new Request(`http://localhost/api/community/comments/${COMMENT_ID}`, {
        method: "DELETE",
      }) as never,
      { params: Promise.resolve({ id: COMMENT_ID }) },
    );

    expect(response.status).toBe(200);
    expect(state.deleteRpc).toHaveBeenCalledWith(
      "community_delete_comment_service",
      { p_actor_id: OWNER_ID, p_comment_id: COMMENT_ID },
    );
    expect(state.serviceComments.query.update).not.toHaveBeenCalled();
  });

  it("does not record an administrator deletion as the author's intent", async () => {
    const state = harness({
      actorId: OUTSIDER_ID,
      serviceAuthorId: OWNER_ID,
      isAdmin: true,
    });

    const response = await DELETE(
      new Request(`http://localhost/api/community/comments/${COMMENT_ID}`, {
        method: "DELETE",
      }) as never,
      { params: Promise.resolve({ id: COMMENT_ID }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("COMMUNITY_ADMIN_DELETE_REQUIRES_AUDITED_ACTION");
    expect(state.deleteRpc).not.toHaveBeenCalled();
  });

  it("returns the exact committed author-deletion receipt on retry", async () => {
    const state = harness({
      actorId: OWNER_ID,
      authorDeletedAt: "2026-08-04T00:00:00.000Z",
    });

    const response = await DELETE(
      new Request(`http://localhost/api/community/comments/${COMMENT_ID}`, {
        method: "DELETE",
      }) as never,
      { params: Promise.resolve({ id: COMMENT_ID }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      comment_id: COMMENT_ID,
      post_comment_count: 0,
    });
    expect(body).not.toHaveProperty("replayed");
    expect(state.deleteRpc).toHaveBeenCalledTimes(1);
  });
});
