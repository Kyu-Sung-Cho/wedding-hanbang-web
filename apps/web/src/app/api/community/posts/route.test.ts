import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
  getCommunityAuthorMap: vi.fn(async () => ({})),
  checkCommunityWriteAccess: vi.fn(async () => ({ allowed: true })),
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "community-post-test"),
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/community/authorProfiles", () => ({
  getCommunityAuthorMap: mocks.getCommunityAuthorMap,
  fallbackCommunityAuthor: vi.fn((userId: string) => ({
    user_id: userId,
    nickname: "익명",
  })),
}));

vi.mock("@/lib/community/writeAccess", () => ({
  checkCommunityWriteAccess: mocks.checkCommunityWriteAccess,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

import { GET, POST } from "./route";

function createPostsQuery(rows: Array<Record<string, unknown>> = []) {
  const result = { data: rows, count: rows.length, error: null };
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    contains: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    gte: vi.fn(),
    gt: vi.fn(),
    range: vi.fn(),
    then: (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };

  for (const method of [
    "select",
    "eq",
    "in",
    "contains",
    "or",
    "order",
    "gte",
    "gt",
    "range",
  ] as const) {
    query[method].mockReturnValue(query);
  }

  return query;
}

function request(sort: string) {
  return new NextRequest(
    `http://localhost/api/community/posts?sort=${encodeURIComponent(sort)}`,
  );
}

function postRequest(
  overrides: Record<string, unknown>,
  idempotencyKey = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
) {
  return new NextRequest("http://localhost/api/community/posts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({
      category: "free",
      title: "예식 준비 질문",
      content: "일반적인 결혼 준비 질문입니다.",
      visibility: "public",
      ad_disclosure: "general",
      ...overrides,
    }),
  });
}

describe("GET /api/community/posts answer-state filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkCommunityWriteAccess.mockResolvedValue({ allowed: true });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("treats Supabase's missing-session result as a real guest public read", async () => {
    const query = createPostsQuery();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { name: "AuthSessionMissingError" },
        })),
      },
      from: vi.fn(() => query),
    });

    const response = await GET(request("new"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
  });

  /**
   * 배지 하나가 커뮤니티 전체를 닫지 못하게 한다.
   *
   * poll summary 는 카드에 붙는 곁가지인데, 그 블록의 `getServiceClient()` 가
   * 감싸이지 않은 채 있었다. 서비스 키·목적지 고정이 어긋나면 생성 자체가 던지고,
   * 그 예외가 라우트 맨 바깥까지 올라가 **피드 전체가 500** 이 됐다.
   */
  it("서비스 클라이언트가 죽어도 피드는 글을 돌려준다", async () => {
    const query = createPostsQuery([
      {
        id: "22222222-2222-4222-8222-222222222222",
        author_id: "11111111-1111-4111-8111-111111111111",
        created_at: "2026-07-30T00:00:00.000Z",
        upvote_count: 0,
        comment_count: 0,
      },
    ]);
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("Supabase project destination is not explicitly pinned.");
    });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { name: "AuthSessionMissingError" },
        })),
      },
      from: vi.fn(() => query),
    });

    const response = await GET(request("new"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.posts).toHaveLength(1);
    // 배지만 빠진다.
    expect(body.posts[0].poll).toBeNull();
  });

  /**
   * 2026-09-02 운영 실측: 상한 인증 쿠키를 든 브라우저에 목록이 500 이었다.
   * 세션 읽기가 던져서 라우트 맨 바깥 `catch` 가 받았기 때문이다. 그 자리는
   * 앞으로도 던질 수 있으므로, 던져도 **분류된 응답**이 나가야 한다.
   */
  it("세션 읽기가 던져도 500 이 아니라 확인 실패(503)로 닫는다", async () => {
    // 쿠키는 **읽히는** 값이다 — 즉 진짜 세션을 제시한 요청이다. 그 상태에서 세션
    // 읽기가 던지면 확인 실패로 닫는 것이 맞다. 던지는 것 자체가 500 이 되면 안 된다.
    const query = createPostsQuery();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => {
          throw new Error("Invalid UTF-8 sequence");
        }),
      },
      from: vi.fn(() => query),
    });

    const response = await GET(
      new NextRequest("http://localhost/api/community/posts?sort=new", {
        headers: { cookie: "sb-slrtobkksjmxgzatjyqb-auth-token=base64-eyJhIjoxfQ" },
      }),
    );

    expect(response.status).toBe(503);
    expect(query.select).not.toHaveBeenCalled();
  });

  it("세션 읽기가 던져도 자격 증명을 안 낸 방문자에게는 공개 목록을 준다", async () => {
    const query = createPostsQuery();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => {
          throw new Error("Invalid UTF-8 sequence");
        }),
      },
      from: vi.fn(() => query),
    });

    const response = await GET(request("new"));

    expect(response.status).toBe(200);
  });

  /**
   * 디코딩조차 되지 않는 쿠키를 든 브라우저는 **로그아웃 방문자**다.
   *
   * 미들웨어가 이미 그 쿠키를 떼어 내지만, 라우트가 그 사실에 의존하면 프록시
   * matcher 가 바뀌거나 라우트가 다른 경로로 불릴 때 같은 요청이 다시 503 이 된다.
   * 그래서 **미들웨어를 거치지 않고** 핸들러를 직접 불러서 잰다.
   */
  it("상한 쿠키는 미들웨어 없이도 공개 목록을 받는다", async () => {
    const query = createPostsQuery();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { name: "AuthSessionMissingError" },
        })),
      },
      from: vi.fn(() => query),
    });

    const response = await GET(
      new NextRequest("http://localhost/api/community/posts?sort=new", {
        headers: { cookie: "sb-slrtobkksjmxgzatjyqb-auth-token=base64-garbage" },
      }),
    );

    expect(response.status).toBe(200);
    expect(query.select).toHaveBeenCalled();
  });

  it("형식이 멀쩡한 세션은 확인 실패면 그대로 닫는다", async () => {
    // 이것까지 익명으로 떨어뜨리면 진짜 확인 실패를 조용히 삼킨다.
    const query = createPostsQuery();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { name: "AuthApiError", message: "Refresh token is not valid" },
        })),
      },
      from: vi.fn(() => query),
    });

    const response = await GET(
      new NextRequest("http://localhost/api/community/posts?sort=new", {
        headers: { cookie: "sb-slrtobkksjmxgzatjyqb-auth-token=base64-eyJhIjoxfQ" },
      }),
    );

    expect(response.status).toBe(503);
    expect(query.select).not.toHaveBeenCalled();
  });

  it("fails closed when a presented session cannot be verified", async () => {
    const query = createPostsQuery();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { name: "AuthApiError" },
        })),
      },
      from: vi.fn(() => query),
    });
    const authenticatedRequest = new NextRequest(
      "http://localhost/api/community/posts?sort=new",
      { headers: { authorization: "Bearer invalid-presented-session" } },
    );

    const response = await GET(authenticatedRequest);

    expect(response.status).toBe(503);
    expect(query.select).not.toHaveBeenCalled();
  });

  it("returns only recent unresolved question posts with no answers", async () => {
    const query = createPostsQuery();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null } })),
      },
      from: vi.fn(() => query),
    });

    const response = await GET(request("unanswered"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(query.in).toHaveBeenCalledWith("category", ["is_normal", "ama"]);
    expect(query.eq).toHaveBeenCalledWith("ad_disclosure", "general");
    expect(query.eq).toHaveBeenCalledWith("is_resolved", false);
    expect(query.eq).toHaveBeenCalledWith("comment_count", 0);
    expect(query.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
  });

  it("returns only resolved question posts ordered by the latest resolution update", async () => {
    const query = createPostsQuery();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null } })),
      },
      from: vi.fn(() => query),
    });

    const response = await GET(request("resolved"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(query.in).toHaveBeenCalledWith("category", ["is_normal", "ama"]);
    expect(query.eq).toHaveBeenCalledWith("ad_disclosure", "general");
    expect(query.eq).toHaveBeenCalledWith("is_resolved", true);
    expect(query.eq).not.toHaveBeenCalledWith("comment_count", 0);
    expect(query.order).toHaveBeenCalledWith("updated_at", {
      ascending: false,
    });
  });

  it("does not present zero-reaction posts as helped posts", async () => {
    const query = createPostsQuery();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null } })),
      },
      from: vi.fn(() => query),
    });

    const response = await GET(request("top"));

    expect(response.status).toBe(200);
    expect(query.gt).toHaveBeenCalledWith("upvote_count", 0);
    expect(query.order).toHaveBeenCalledWith("upvote_count", {
      ascending: false,
    });
  });

  it("loads signed-in poll summaries through the actor boundary and service projection", async () => {
    const viewerId = "10000000-0000-4000-8000-000000000001";
    const authorId = "10000000-0000-4000-8000-000000000002";
    const postId = "20000000-0000-4000-8000-000000000001";
    const pollId = "30000000-0000-4000-8000-000000000001";
    const postsQuery = createPostsQuery([
      {
        id: postId,
        author_id: authorId,
        created_at: "2026-08-04T00:00:00.000Z",
        upvote_count: 1,
        comment_count: 0,
      },
    ]);
    const pollQuery = {
      select: vi.fn(),
      in: vi.fn(async () => ({
        data: [{ id: pollId, post_id: postId }],
        error: null,
      })),
    };
    pollQuery.select.mockReturnValue(pollQuery);
    const votesQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(async () => ({ data: [], error: null })),
    };
    votesQuery.select.mockReturnValue(votesQuery);
    votesQuery.eq.mockReturnValue(votesQuery);
    const viewerRpc = vi.fn(() => {
      throw new Error("viewer-scoped client must not expose the block oracle");
    });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: viewerId } },
          error: null,
        })),
      },
      rpc: viewerRpc,
      from: vi.fn((table: string) => {
        if (table === "community_posts") return postsQuery;
        if (table === "community_polls") return pollQuery;
        if (table === "community_votes") return votesQuery;
        throw new Error(`Unexpected viewer table: ${table}`);
      }),
    });
    const serviceRpc = vi.fn(async (name: string) => {
      if (name === "community_viewer_can_see") {
        return { data: true, error: null };
      }
      if (name !== "community_get_poll_actor_projection") {
        throw new Error(`Unexpected service RPC: ${name}`);
      }
      return {
        data: {
        ok: true,
        id: pollId,
        post_id: postId,
        version: 1,
        question: "무엇이 더 중요한가요?",
        allow_multiple: false,
        is_anonymous: true,
        hide_results_until_voted: false,
        closes_at: null,
        total_voters: 5,
        total_votes: 5,
        created_at: "2026-08-04T00:00:00.000Z",
        results_hidden: false,
        user_voted_option_ids: [],
        options: [],
        },
        error: null,
      };
    });
    const serviceFrom = vi.fn(() => {
      throw new Error("Poll base tables must not be read through service role");
    });
    mocks.createAdminClient.mockReturnValue({ rpc: serviceRpc, from: serviceFrom });

    const response = await GET(request("new"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(pollQuery.select).toHaveBeenCalledWith("id, post_id");
    expect(viewerRpc).not.toHaveBeenCalled();
    expect(serviceRpc).toHaveBeenCalledWith("community_viewer_can_see", {
      p_viewer_user_id: viewerId,
      p_other_user_id: authorId,
    });
    expect(serviceRpc).toHaveBeenCalledWith(
      "community_get_poll_actor_projection",
      { p_actor_id: viewerId, p_poll_id: pollId },
    );
    expect(serviceFrom).not.toHaveBeenCalled();
    expect(body.posts[0].poll).toEqual({
      id: pollId,
      question: "무엇이 더 중요한가요?",
      total_voters: 5,
      closes_at: null,
    });
  });
});

describe("POST /api/community/posts public personal-information boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkCommunityWriteAccess.mockResolvedValue({ allowed: true });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
        })),
      },
    });
  });

  it("commits a validated post, optional poll, and profile count through one atomic receipt", async () => {
    const actorId = "11111111-1111-4111-8111-111111111111";
    const postId = "22222222-2222-4222-8222-222222222222";
    const rpc = vi.fn(async (name: string) => {
      if (name === "community_replay_post_command_service") {
        return { data: null, error: null };
      }
      if (name === "community_create_post_service") {
        return {
          data: {
            post: {
              id: postId,
              author_id: actorId,
              category: "free",
              title: "예식 준비 질문",
              content: "일반적인 결혼 준비 질문입니다.",
              visibility: "public",
            },
            poll_id: "33333333-3333-4333-8333-333333333333",
            post_count: 1,
          },
          error: null,
        };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    const from = vi.fn((table: string) => {
      if (table === "profiles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { name: "예비부부" },
                error: null,
              })),
            })),
          })),
        };
      }
      throw new Error(`Direct write/read is not part of the post command: ${table}`);
    });
    mocks.createAdminClient.mockReturnValue({ rpc, from });

    const response = await POST(postRequest({
      poll: {
        question: "어느 시간이 좋을까요?",
        options: [{ label: "오전" }, { label: "오후" }],
      },
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      post: { id: postId, author_id: actorId },
      poll_id: "33333333-3333-4333-8333-333333333333",
      post_count: 1,
    });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "community_replay_post_command_service",
      expect.objectContaining({
        p_actor_id: actorId,
        p_idempotency_key: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "community_create_post_service",
      expect.objectContaining({
        p_actor_id: actorId,
        p_idempotency_key: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        p_payload: expect.objectContaining({
          category: "free",
          poll: expect.objectContaining({
            options: [
              { image_url: null, label: "오전", position: 0 },
              { image_url: null, label: "오후", position: 1 },
            ],
          }),
        }),
      }),
    );
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("replays an exact committed receipt before mutable write gates", async () => {
    const actorId = "11111111-1111-4111-8111-111111111111";
    const receipt = {
      post: {
        id: "22222222-2222-4222-8222-222222222222",
        author_id: actorId,
        title: "예식 준비 질문",
      },
      poll_id: null,
      post_count: 4,
    };
    const rpc = vi.fn(async (name: string) => {
      expect(name).toBe("community_replay_post_command_service");
      return { data: receipt, error: null };
    });
    mocks.createAdminClient.mockReturnValue({ rpc });
    mocks.checkCommunityWriteAccess.mockResolvedValue({
      allowed: false,
      code: "COMMUNITY_READ_ONLY",
      message: "읽기 전용",
      status: 503,
    } as never);
    mocks.checkRateLimitPersistent.mockResolvedValue(
      new Response(null, { status: 429 }) as never,
    );

    const response = await POST(postRequest({}));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(receipt);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(mocks.checkCommunityWriteAccess).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
  });

  it("fails closed when the replay RPC returns a malformed or cross-actor receipt", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: {
          post: {
            id: "22222222-2222-4222-8222-222222222222",
            author_id: "99999999-9999-4999-8999-999999999999",
          },
          poll_id: null,
          post_count: 1,
        },
        error: null,
      })),
    });

    const response = await POST(postRequest({}));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_POST_REPLAY_UNCONFIRMED",
    });
    expect(mocks.checkCommunityWriteAccess).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
  });

  it("requires a client-stable UUID idempotency key before any write dependency", async () => {
    const response = await POST(postRequest({}, "not-a-uuid"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_POST_IDEMPOTENCY_REQUIRED",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.checkCommunityWriteAccess).not.toHaveBeenCalled();
  });

  it("rejects new media publishing while leaving text validation active", async () => {
    const previous = process.env.COMMUNITY_MEDIA_PUBLISHING_ENABLED;
    process.env.COMMUNITY_MEDIA_PUBLISHING_ENABLED = "false";
    try {
      const response = await POST(postRequest({
        images: [
          "https://project.supabase.co/storage/v1/object/public/community-images/11111111-1111-4111-8111-111111111111/upload.jpg",
        ],
      }));

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toMatchObject({
        code: "COMMUNITY_MEDIA_PUBLISHING_DISABLED",
      });
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.COMMUNITY_MEDIA_PUBLISHING_ENABLED;
      } else {
        process.env.COMMUNITY_MEDIA_PUBLISHING_ENABLED = previous;
      }
    }
  });

  it.each([
    [
      "rich-text mail link",
      { content: '<a href="mailto:victim@example.com">문의</a>' },
      "email",
    ],
    [
      "tag",
      { tags: ["당뇨 진단을 받아 치료 중이에요."] },
      "health",
    ],
    [
      "price region",
      {
        price_data: {
          vendor_category: "venue",
          base_price: 3_000_000,
          region: "서울 강남구 역삼동 123-45",
        },
      },
      "precise_address",
    ],
    [
      "legacy cost details",
      {
        cost_data: {
          totalCost: 3_000_000,
          region: "서울",
          guestCount: 100,
          weddingDate: "2026-10-10",
          categories: [],
          advice: "웨딩홀 계약번호 VENU-2026-0042",
        },
      },
      "vendor_contract_identifier",
    ],
  ])("rejects sensitive text hidden in the %s field", async (_label, body, kind) => {
    const response = await POST(postRequest(body));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_PERSONAL_INFO_DETECTED",
      detected: expect.arrayContaining([kind]),
      error: expect.stringContaining("민감한"),
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
