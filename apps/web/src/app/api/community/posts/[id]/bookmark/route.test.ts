import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn<() => Promise<Response | null>>(),
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: (scope: string, _request: Request, userId?: string) =>
    `${scope}:${userId ?? "guest"}`,
}));

import { POST } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const POST_ID = "10000000-0000-4000-8000-000000000001";

function authenticatedClient(post: unknown) {
  const postQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: post, error: null }),
  };
  postQuery.select.mockReturnValue(postQuery);
  postQuery.eq.mockReturnValue(postQuery);

  return {
    client: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
      },
      from: vi.fn().mockReturnValue(postQuery),
    },
    postQuery,
  };
}

function useServiceClient(
  requestClient: ReturnType<typeof authenticatedClient>,
  rpc = vi.fn(),
) {
  mocks.createAdminClient.mockReturnValue({
    from: requestClient.client.from,
    rpc,
  });
}

describe("POST /api/community/posts/[id]/bookmark", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("rejects a malformed post UUID before authentication or service-role access", async () => {
    const response = await POST(
      new NextRequest("https://hanbang.ai/api/community/posts/not-a-uuid/bookmark", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns a uniform not-found response for another user's hidden post", async () => {
    const requestClient = authenticatedClient({
      id: POST_ID,
      author_id: OTHER_USER_ID,
      visibility: "draft",
      under_review: false,
    });
    mocks.createClientFromRequest.mockResolvedValue(requestClient.client);
    useServiceClient(requestClient);

    const response = await POST(
      new NextRequest(`https://hanbang.ai/api/community/posts/${POST_ID}/bookmark`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: POST_ID }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "게시글을 찾을 수 없습니다.",
    });
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
  });

  it("returns the same not-found response for a nonexistent post", async () => {
    const requestClient = authenticatedClient(null);
    mocks.createClientFromRequest.mockResolvedValue(requestClient.client);
    useServiceClient(requestClient);

    const response = await POST(
      new NextRequest(`https://hanbang.ai/api/community/posts/${POST_ID}/bookmark`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: POST_ID }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "게시글을 찾을 수 없습니다.",
    });
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
  });

  it("uses the atomic service RPC for a readable post", async () => {
    const requestClient = authenticatedClient({
      id: POST_ID,
      author_id: OTHER_USER_ID,
      visibility: "public",
      under_review: false,
    });
    const rpc = vi.fn().mockResolvedValue({
      data: { bookmarked: true, bookmark_count: 7 },
      error: null,
    });
    mocks.createClientFromRequest.mockResolvedValue(requestClient.client);
    useServiceClient(requestClient, rpc);

    const response = await POST(
      new NextRequest(`https://hanbang.ai/api/community/posts/${POST_ID}/bookmark`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: POST_ID }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0, must-revalidate",
    );
    expect(rpc).toHaveBeenCalledWith("community_toggle_bookmark", {
      p_post_id: POST_ID,
      p_user_id: USER_ID,
    });
    await expect(response.json()).resolves.toEqual({
      bookmarked: true,
      bookmark_count: 7,
    });
  });

  it("maps an atomic visibility-race rejection to the same not-found response", async () => {
    const requestClient = authenticatedClient({
      id: POST_ID,
      author_id: OTHER_USER_ID,
      visibility: "public",
      under_review: false,
    });
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "community_post_not_found" },
    });
    mocks.createClientFromRequest.mockResolvedValue(requestClient.client);
    useServiceClient(requestClient, rpc);

    const response = await POST(
      new NextRequest(`https://hanbang.ai/api/community/posts/${POST_ID}/bookmark`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: POST_ID }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "게시글을 찾을 수 없습니다.",
    });
  });

  it("fails closed when the atomic RPC returns a malformed payload", async () => {
    const requestClient = authenticatedClient({
      id: POST_ID,
      author_id: OTHER_USER_ID,
      visibility: "public",
      under_review: false,
    });
    const rpc = vi.fn().mockResolvedValue({
      data: { bookmarked: "yes", bookmark_count: -1 },
      error: null,
    });
    mocks.createClientFromRequest.mockResolvedValue(requestClient.client);
    useServiceClient(requestClient, rpc);

    const response = await POST(
      new NextRequest(`https://hanbang.ai/api/community/posts/${POST_ID}/bookmark`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: POST_ID }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "북마크 처리에 실패했습니다.",
    });
  });
});
