import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
  getCommunityAuthorMap: vi.fn(async () => ({})),
  checkCommunityWriteAccess: vi.fn(async () => ({ allowed: true })),
  checkRateLimit: vi.fn(() => null),
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
  checkRateLimit: mocks.checkRateLimit,
  rateLimitKey: mocks.rateLimitKey,
}));

import { GET, POST } from "./route";

function createPostsQuery() {
  const result = { data: [], count: 0, error: null };
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

function postRequest(overrides: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/community/posts", {
    method: "POST",
    headers: { "content-type": "application/json" },
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
    mocks.checkRateLimit.mockReturnValue(null);
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
});

describe("POST /api/community/posts public personal-information boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkCommunityWriteAccess.mockResolvedValue({ allowed: true });
    mocks.checkRateLimit.mockReturnValue(null);
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
        })),
      },
    });
  });

  it.each([
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
