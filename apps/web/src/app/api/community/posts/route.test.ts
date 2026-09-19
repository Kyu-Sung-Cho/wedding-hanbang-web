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
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildQuickReviewPostBody,
  type QuickReviewDraft,
} from "@/app/(community)/community/quick-review/quickReviewSubmission";

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

  it("orders the full hot feed in the database before taking a page", async () => {
    const query = createPostsQuery();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
      from: vi.fn(() => query),
    });
    const response = await GET(request("hot"));
    expect(response.status).toBe(200);
    expect(query.order.mock.calls).toEqual([
      ["hot_rank", { ascending: false }],
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(query.order.mock.invocationCallOrder.at(-1))
      .toBeLessThan(query.range.mock.invocationCallOrder[0]);
    expect(query.eq).toHaveBeenCalledWith("ad_disclosure", "general");
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

/**
 * 웹 15초 후기 화면이 만드는 본문이 라우트 검증을 지나 저장 RPC 까지 가는가.
 *
 * 저장 RPC(`community_create_post_service`)는 SQL 안에서 본문을 한 번 더 검사한다. 여기서는
 * 그 검사를 그대로 옮긴 대역을 둔다. 2026-09-19 까지 화면은 `vendor_tags: [업체 이름]` 을
 * 보냈고, 라우트는 그것을 거르지 않아 RPC 가 `COMMUNITY_POST_PAYLOAD_INVALID` 로 거절했다.
 * 사용자에게는 503 "같은 내용으로 다시 시도해 주세요"만 보였다.
 */
describe("POST /api/community/posts 15초 후기 본문", () => {
  const actorId = "11111111-1111-4111-8111-111111111111";
  const postId = "22222222-2222-4222-8222-222222222222";
  const idempotencyKey = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const SQL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

  /**
   * `supabase/migrations/20260804200000_community_post_service_write_boundary.sql` 의 본문 검사.
   * 문제가 있으면 SQL 이 올리는 예외 이름을, 없으면 null.
   */
  function sqlPayloadProblem(payload: Record<string, unknown>): string | null {
    const strings = (value: unknown, max: number) =>
      Array.isArray(value) && value.length <= max && value.every((item) => typeof item === "string");
    const invalid =
      typeof payload.category !== "string" || payload.category.length < 1
      || typeof payload.title !== "string" || payload.title.length < 1 || payload.title.length > 200
      || typeof payload.content !== "string" || payload.content.length > 50000
      || !strings(payload.images, 10)
      || (payload.slides !== null && !(Array.isArray(payload.slides) && payload.slides.length <= 10))
      || !strings(payload.vendor_tags, 5)
      || !(payload.vendor_tags as string[]).every((tag) => SQL_UUID.test(tag))
      || !strings(payload.tags, 10)
      || !["public", "members", "draft"].includes(String(payload.visibility))
      || !["general", "sponsored", "ad"].includes(String(payload.ad_disclosure))
      || typeof payload.is_quick_review !== "boolean"
      || (payload.rating !== null
        && !(typeof payload.rating === "number" && /^[1-5]$/u.test(String(payload.rating))));
    if (invalid) return "COMMUNITY_POST_PAYLOAD_INVALID";
    if (
      payload.ad_disclosure === "sponsored"
      && String(payload.sponsorship_detail ?? "").trim().length < 5
    ) {
      return "COMMUNITY_POST_SPONSORSHIP_DETAIL_INVALID";
    }
    return null;
  }

  const draft: QuickReviewDraft = {
    vendorName: "라벨르 스튜디오",
    category: "studio",
    rating: 4,
    review: "실장님이 친절해요",
    images: [],
    adDisclosure: "general",
  };

  function quickReviewRequest(body: unknown, headers: Record<string, string> = { "idempotency-key": idempotencyKey }) {
    return new NextRequest("http://localhost/api/community/posts", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  function serviceClient() {
    const rpc = vi.fn(async (name: string, args: { p_payload: Record<string, unknown> }) => {
      if (name === "community_replay_post_command_service") return { data: null, error: null };
      if (name === "community_create_post_service") {
        const problem = sqlPayloadProblem(args.p_payload);
        if (problem) return { data: null, error: { code: "22023", message: problem } };
        return {
          data: { post: { id: postId, author_id: actorId }, poll_id: null, post_count: 1 },
          error: null,
        };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    const from = vi.fn((table: string) => {
      if (table !== "profiles") throw new Error(`Unexpected table: ${table}`);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: { name: "예비부부" }, error: null })),
          })),
        })),
      };
    });
    return { rpc, from };
  }

  function createCall(rpc: ReturnType<typeof serviceClient>["rpc"]) {
    const call = rpc.mock.calls.find(([name]) => name === "community_create_post_service");
    expect(call, "저장 RPC 까지 가지 못했다").toBeTruthy();
    return call![1] as { p_idempotency_key: string; p_payload: Record<string, unknown> };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkCommunityWriteAccess.mockResolvedValue({ allowed: true });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: actorId } } })) },
    });
  });

  it("SQL 이 아직 같은 검사를 한다. 대역이 낡으면 여기서 먼저 빨개진다", () => {
    const sql = readFileSync(
      path.resolve(
        process.cwd(),
        "../../supabase/migrations/20260804200000_community_post_service_write_boundary.sql",
      ),
      "utf8",
    );
    expect(sql).toMatch(/p_payload -> 'vendor_tags'[\s\S]{0,400}\[0-9a-f\]\{8\}-/u);
    expect(sql).toMatch(/jsonb_typeof\(p_payload -> 'is_quick_review'\) IS DISTINCT FROM 'boolean'/u);
    expect(sql).toMatch(/length\(btrim\(COALESCE\(p_payload ->> 'sponsorship_detail', ''\)\)\) < 5/u);
  });

  it.each([
    ["일반", { adDisclosure: "general" as const }],
    ["광고", { adDisclosure: "ad" as const }],
    ["협찬", { adDisclosure: "sponsored" as const, sponsorshipDetail: "드레스 대여비 1회 제공" }],
  ])("%s 후기 본문이 라우트를 지나 저장 RPC 검사까지 통과한다", async (_label, disclosure) => {
    const client = serviceClient();
    mocks.createAdminClient.mockReturnValue(client);
    const body = buildQuickReviewPostBody({ ...draft, ...disclosure });

    const response = await POST(quickReviewRequest(body));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ post: { id: postId } });
    const { p_idempotency_key, p_payload } = createCall(client.rpc);
    expect(p_idempotency_key).toBe(idempotencyKey);
    expect(p_payload).toMatchObject({
      category: "tour_review",
      title: "라벨르 스튜디오 후기",
      content: "실장님이 친절해요",
      vendor_tags: [],
      tags: ["studio"],
      is_quick_review: true,
      rating: 4,
      ad_disclosure: disclosure.adDisclosure,
      sponsorship_detail: disclosure.adDisclosure === "sponsored" ? "드레스 대여비 1회 제공" : null,
    });
    expect(sqlPayloadProblem(p_payload)).toBeNull();
  });

  it("예전 화면 본문(업체 이름을 vendor_tags 에)은 저장 RPC 에서 거절된다. 대역이 실제로 무는지 본다", async () => {
    const client = serviceClient();
    mocks.createAdminClient.mockReturnValue(client);

    const response = await POST(quickReviewRequest({
      ...buildQuickReviewPostBody(draft),
      vendor_tags: ["라벨르 스튜디오"],
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "COMMUNITY_POST_SAVE_FAILED" });
    expect(createCall(client.rpc).p_payload.vendor_tags).toStrictEqual(["라벨르 스튜디오"]);
  });

  it("요청 키 헤더가 없으면 본문을 읽기 전에 400 이다. 예전 화면이 늘 맞던 응답이다", async () => {
    const response = await POST(quickReviewRequest(buildQuickReviewPostBody(draft), {}));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "COMMUNITY_POST_IDEMPOTENCY_REQUIRED" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
