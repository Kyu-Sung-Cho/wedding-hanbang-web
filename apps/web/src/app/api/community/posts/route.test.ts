import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn<() => Promise<Response | null>>(),
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  getCommunityAuthorMap: vi.fn(),
  getCommunityPublicIdForUser: vi.fn(),
  getCommunityPublicIdsForUsers: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: (scope: string) => `${scope}:test-ip`,
}));

vi.mock("@/lib/community/authorProfiles", () => ({
  fallbackCommunityAuthor: vi.fn(),
  getCommunityAuthorMap: mocks.getCommunityAuthorMap,
}));
vi.mock("@/lib/community/publicIdentity", () => ({
  getCommunityPublicIdForUser: mocks.getCommunityPublicIdForUser,
  getCommunityPublicIdsForUsers: mocks.getCommunityPublicIdsForUsers,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import { GET, POST } from "./route";

function communityClient(user: { id: string } | null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    range: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.or.mockReturnValue(query);
  query.order.mockReturnValue(query);

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
    from: vi.fn(() => query),
    query,
  };
}

describe("GET /api/community/posts cache boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.getCommunityAuthorMap.mockResolvedValue({});
    mocks.getCommunityPublicIdForUser.mockResolvedValue(null);
    mocks.getCommunityPublicIdsForUsers.mockResolvedValue([]);
  });

  it("rejects an over-limit request before authentication or feed queries", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 }),
    );

    const response = await GET(
      new Request("https://hanbang.ai/api/community/posts") as never,
    );

    expect(response.status).toBe(429);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
  });

  it("partitions an anonymous cacheable feed by cookie and authorization", async () => {
    mocks.createClientFromRequest.mockResolvedValue(communityClient(null));

    const response = await GET(
      new Request("https://hanbang.ai/api/community/posts") as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, s-maxage=10, stale-while-revalidate=30",
    );
    expect(response.headers.get("Vary")).toBe("Cookie, Authorization");
  });

  it("keeps an authenticated feed private and non-cacheable", async () => {
    mocks.createClientFromRequest.mockResolvedValue(communityClient({ id: "user-1" }));

    const response = await GET(
      new Request("https://hanbang.ai/api/community/posts") as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("Vary")).toBe("Cookie, Authorization");
  });

  it("bounds deep pagination and page size before building the range", async () => {
    const client = communityClient(null);
    mocks.createClientFromRequest.mockResolvedValue(client);

    const response = await GET(
      new Request("https://hanbang.ai/api/community/posts?page=999999&limit=999999") as never,
    );

    expect(response.status).toBe(200);
    expect(client.query.range).toHaveBeenCalledWith(9_950, 9_999);
  });
});

describe("POST /api/community/posts atomic write boundary", () => {
  const actorId = "10000000-0000-4000-8000-000000000001";
  const publicAuthorId = "20000000-0000-4000-8000-000000000002";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  function authenticatedClient() {
    return {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: actorId } } }),
      },
      from: vi.fn(),
    };
  }

  function atomicServiceClient(error: unknown = null) {
    const post = error
      ? null
      : {
          id: "30000000-0000-4000-8000-000000000003",
          author_id: publicAuthorId,
          category: "free",
          title: "원자적 게시글",
          content: "본문",
          visibility: "public",
        };
    const rpcQuery = {
      select: vi.fn(),
      single: vi.fn().mockResolvedValue({ data: post, error }),
    };
    rpcQuery.select.mockReturnValue(rpcQuery);
    return {
      rpc: vi.fn<
        (name: string, args: Record<string, unknown>) => typeof rpcQuery
      >(() => rpcQuery),
      from: vi.fn(),
      rpcQuery,
    };
  }

  function postRequest(body: Record<string, unknown>) {
    return new Request("https://hanbang.ai/api/community/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never;
  }

  it("creates a profile and post through one service-only RPC", async () => {
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient());
    const serviceClient = atomicServiceClient();
    mocks.createAdminClient.mockReturnValue(serviceClient);

    const response = await POST(postRequest({
      category: "free",
      title: "원자적 게시글",
      content: "본문",
      visibility: "public",
      ad_disclosure: "general",
    }));

    expect(response.status).toBe(201);
    expect(serviceClient.rpc).toHaveBeenCalledTimes(1);
    expect(serviceClient.rpc).toHaveBeenCalledWith(
      "community_create_post_with_poll_atomic",
      expect.objectContaining({
        p_actor_id: actorId,
        p_default_nickname: "user-10000000",
        p_category: "free",
        p_title: "원자적 게시글",
        p_content: "본문",
        p_images: [],
        p_slides: null,
        p_visibility: "public",
        p_vendor_tags: [],
        p_tags: [],
        p_cost_data: null,
        p_ad_disclosure: "general",
        p_sponsorship_detail: null,
        p_price_data: null,
        p_is_quick_review: false,
        p_rating: null,
        p_poll: null,
      }),
    );
    expect(serviceClient.rpcQuery.select).toHaveBeenCalledWith(
      COMMUNITY_POST_PUBLIC_SELECT,
    );
    expect(serviceClient.from).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/community");

    const payload = await response.json();
    expect(payload.post.author_id).toBe(publicAuthorId);
    expect(payload.post.is_author).toBe(true);
  });

  it("sends the post and complete poll as one contiguous atomic payload", async () => {
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient());
    const serviceClient = atomicServiceClient();
    mocks.createAdminClient.mockReturnValue(serviceClient);

    const response = await POST(postRequest({
      category: "free",
      title: "원자적 게시글",
      content: "본문",
      visibility: "members",
      ad_disclosure: "general",
      poll: {
        question: "어느 쪽인가요?",
        options: [{ label: "첫 번째" }, { label: "두 번째" }],
        allow_multiple: false,
        is_anonymous: true,
        hide_results_until_voted: true,
        closes_at: "2099-01-01T00:00:00.000Z",
      },
    }));

    expect(response.status).toBe(201);
    expect(serviceClient.rpc).toHaveBeenCalledTimes(1);
    const rpcArguments = serviceClient.rpc.mock.calls[0]?.[1];
    expect(rpcArguments?.p_poll).toEqual({
      question: "어느 쪽인가요?",
      options: [
        { position: 0, label: "첫 번째", image_url: null },
        { position: 1, label: "두 번째", image_url: null },
      ],
      allow_multiple: false,
      is_anonymous: true,
      hide_results_until_voted: true,
      closes_at: "2099-01-01T00:00:00.000Z",
    });
    expect(serviceClient.from).not.toHaveBeenCalled();
  });

  it("returns a validation error from the RPC without compensating deletes", async () => {
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient());
    const serviceClient = atomicServiceClient({
      code: "22023",
      message: "invalid poll",
    });
    mocks.createAdminClient.mockReturnValue(serviceClient);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(postRequest({
      category: "free",
      title: "원자적 게시글",
      content: "본문",
      visibility: "public",
      ad_disclosure: "general",
    }));

    expect(response.status).toBe(400);
    expect(serviceClient.rpc).toHaveBeenCalledTimes(1);
    expect(serviceClient.from).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("maps a suspended actor rejection to 403", async () => {
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient());
    const serviceClient = atomicServiceClient({
      code: "42501",
      message: "actor suspended",
    });
    mocks.createAdminClient.mockReturnValue(serviceClient);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(postRequest({
      category: "free",
      title: "정지 계정 게시글",
      content: "본문",
      visibility: "public",
      ad_disclosure: "general",
    }));

    expect(response.status).toBe(403);
    expect(serviceClient.rpc).toHaveBeenCalledTimes(1);
    expect(serviceClient.from).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
