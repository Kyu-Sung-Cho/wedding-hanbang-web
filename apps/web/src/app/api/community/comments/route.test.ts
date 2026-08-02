import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn<() => Promise<Response | null>>(),
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: (scope: string) => `${scope}:test-ip`,
}));

import { GET, POST } from "./route";

const COMMENT_PUBLIC_SELECT =
  "id, post_id, parent_id, author_id:author_public_id, content, upvote_count, is_deleted, created_at, updated_at";

describe("GET /api/community/comments privacy boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("uses an explicit projection and prevents shared caching of user_vote", async () => {
    const postQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "post-1", author_id: "author-1", visibility: "public", under_review: false },
        error: null,
      }),
    };
    postQuery.select.mockReturnValue(postQuery);
    postQuery.eq.mockReturnValue(postQuery);

    const commentsQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    commentsQuery.select.mockReturnValue(commentsQuery);
    commentsQuery.eq.mockReturnValue(commentsQuery);
    commentsQuery.order.mockReturnValue(commentsQuery);

    const from = vi.fn((table: string) => (
      table === "community_posts" ? postQuery : commentsQuery
    ));
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from,
    });

    const response = await GET(
      new Request("https://hanbang.ai/api/community/comments?postId=10000000-0000-4000-8000-000000000001") as never,
    );

    expect(response.status).toBe(200);
    expect(commentsQuery.select).toHaveBeenCalledWith(COMMENT_PUBLIC_SELECT);
    expect(commentsQuery.select).not.toHaveBeenCalledWith("*");
    expect(commentsQuery.limit).toHaveBeenCalledWith(101);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("Vary")).toBe("Cookie, Authorization");
  });

  it("rejects an over-limit list request before auth or database access", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 }),
    );

    const response = await GET(
      new Request("https://hanbang.ai/api/community/comments?postId=10000000-0000-4000-8000-000000000001") as never,
    );

    expect(response.status).toBe(429);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
  });
});

describe("POST /api/community/comments atomic write boundary", () => {
  const actorId = "10000000-0000-4000-8000-000000000001";
  const postId = "20000000-0000-4000-8000-000000000002";
  const publicAuthorId = "30000000-0000-4000-8000-000000000003";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("creates the profile and comment through exactly one service-only RPC", async () => {
    const userFrom = vi.fn();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: actorId } } }),
      },
      from: userFrom,
    });

    const createdComment = {
      id: "40000000-0000-4000-8000-000000000004",
      post_id: postId,
      parent_id: null,
      author_id: publicAuthorId,
      content: "원자적 댓글",
      upvote_count: 0,
      is_deleted: false,
      created_at: "2026-08-03T00:00:00.000Z",
      updated_at: "2026-08-03T00:00:00.000Z",
    };
    const rpcQuery = {
      select: vi.fn(),
      single: vi.fn().mockResolvedValue({ data: createdComment, error: null }),
    };
    rpcQuery.select.mockReturnValue(rpcQuery);
    const profileQuery = {
      select: vi.fn(),
      in: vi.fn().mockResolvedValue({
        data: [{
          user_id: publicAuthorId,
          nickname: "작성자",
          avatar_url: null,
          rank: "sprout",
        }],
        error: null,
      }),
    };
    profileQuery.select.mockReturnValue(profileQuery);
    const serviceClient = {
      rpc: vi.fn(() => rpcQuery),
      from: vi.fn((table: string) => {
        expect(table).toBe("community_profiles");
        return profileQuery;
      }),
    };
    mocks.createAdminClient.mockReturnValue(serviceClient);

    const response = await POST(new Request(
      "https://hanbang.ai/api/community/comments",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ post_id: postId, content: "원자적 댓글" }),
      },
    ) as never);

    expect(response.status).toBe(201);
    expect(serviceClient.rpc).toHaveBeenCalledTimes(1);
    expect(serviceClient.rpc).toHaveBeenCalledWith(
      "community_create_comment_atomic",
      {
        p_actor_id: actorId,
        p_post_id: postId,
        p_parent_id: null,
        p_content: "원자적 댓글",
        p_default_nickname: "user-10000000",
      },
    );
    expect(rpcQuery.select).toHaveBeenCalledWith(COMMENT_PUBLIC_SELECT);
    expect(userFrom).not.toHaveBeenCalled();
    expect(serviceClient.from).toHaveBeenCalledTimes(1);

    const payload = await response.json();
    expect(payload.comment.author_id).toBe(publicAuthorId);
    expect(payload.comment.author.user_id).toBe(publicAuthorId);
    expect(payload.comment.is_author).toBe(true);
  });

  it("maps a target disappearance to 404 without any fallback direct write", async () => {
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: actorId } } }),
      },
      from: vi.fn(),
    });
    const rpcQuery = {
      select: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "P0002", message: "target missing" },
      }),
    };
    rpcQuery.select.mockReturnValue(rpcQuery);
    const serviceClient = {
      rpc: vi.fn(() => rpcQuery),
      from: vi.fn(),
    };
    mocks.createAdminClient.mockReturnValue(serviceClient);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(new Request(
      "https://hanbang.ai/api/community/comments",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ post_id: postId, content: "사라진 대상" }),
      },
    ) as never);

    expect(response.status).toBe(404);
    expect(serviceClient.rpc).toHaveBeenCalledTimes(1);
    expect(serviceClient.from).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("maps a suspended actor rejection to 403", async () => {
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: actorId } } }),
      },
      from: vi.fn(),
    });
    const rpcQuery = {
      select: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "42501", message: "actor suspended" },
      }),
    };
    rpcQuery.select.mockReturnValue(rpcQuery);
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn(() => rpcQuery),
      from: vi.fn(),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(new Request(
      "https://hanbang.ai/api/community/comments",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ post_id: postId, content: "정지 계정" }),
      },
    ) as never);

    expect(response.status).toBe(403);
    consoleError.mockRestore();
  });
});
