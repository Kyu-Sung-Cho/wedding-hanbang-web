import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  revalidatePath: vi.fn(),
  checkCommunityWriteAccess: vi.fn(),
  getCommunityAuthorMap: vi.fn(async () => ({})),
  logError: vi.fn(),
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

vi.mock("@/utils/log", () => ({
  log: {
    error: mocks.logError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/community/writeAccess", () => ({
  checkCommunityWriteAccess: mocks.checkCommunityWriteAccess,
}));

vi.mock("@/lib/community/authorProfiles", () => ({
  getCommunityAuthorMap: mocks.getCommunityAuthorMap,
  fallbackCommunityAuthor: vi.fn((userId: string) => ({
    user_id: userId,
    nickname: "익명",
  })),
}));

import { DELETE, GET, PATCH } from "./route";

const POST_ID = "22222222-2222-4222-8222-222222222222";
const AUTHOR_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "33333333-3333-4333-8333-333333333333";
const MEDIA_FILE_ID = "55555555-5555-4555-8555-555555555555";
const SUPABASE_URL = "https://example.supabase.co";
const IMAGE_URL = `${SUPABASE_URL}/storage/v1/object/public/community-images/${AUTHOR_ID}/${MEDIA_FILE_ID}.jpg`;
const REPLACEMENT_IMAGE_URL = `${SUPABASE_URL}/storage/v1/object/public/community-images/${AUTHOR_ID}/66666666-6666-4666-8666-666666666666.jpg`;
const originalMediaFlag = process.env.COMMUNITY_MEDIA_PUBLISHING_ENABLED;
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

function request(body: unknown) {
  return new Request(`http://localhost/api/community/posts/${POST_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rawPatchRequest(body: BodyInit, headers: HeadersInit = {}) {
  return new Request(`http://localhost/api/community/posts/${POST_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" as const } : {}),
  });
}

function communityPostsQuery(
  authorId = AUTHOR_ID,
  existingOverrides: Record<string, unknown> = {},
) {
  const maybeSingle = vi.fn(async () => ({
    data: {
      author_id: authorId,
      slides: null,
      images: [],
      visibility: "public",
      title: "기존 제목",
      content: "기존 본문",
      tags: [],
      cost_data: null,
      price_data: null,
      ad_disclosure: "general",
      sponsorship_detail: null,
      ...existingOverrides,
    },
    error: null,
  }));
  const single = vi.fn(async () => ({
    data: {
      id: POST_ID,
      author_id: authorId,
      category: "is_normal",
      is_resolved: true,
    },
    error: null,
  }));
  const updateChain = {
    eq: vi.fn(),
    select: vi.fn(() => ({ single })),
  };
  updateChain.eq.mockReturnValue(updateChain);
  const update = vi.fn(() => updateChain);
  const select = vi.fn(() => ({
    eq: vi.fn(() => ({ maybeSingle })),
  }));

  return {
    query: { select, update },
    maybeSingle,
    single,
    update,
    updateChain,
  };
}

function profileQuery(isAdmin: boolean) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: { is_admin: isAdmin },
          error: null,
        })),
      })),
    })),
  };
}

function requestClient(userId: string, posts = communityPostsQuery()) {
  const communityProfile = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({
          data: { is_suspended: false },
          error: null,
        })),
      })),
    })),
  };

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: userId } },
      })),
    },
    from: vi.fn((table: string) => {
      if (table === "community_posts") return posts.query;
      if (table === "community_profiles") return communityProfile;
      throw new Error(`Unexpected request-client table: ${table}`);
    }),
  };
}

describe("community post resolution state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.COMMUNITY_MEDIA_PUBLISHING_ENABLED;
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    mocks.checkCommunityWriteAccess.mockResolvedValue({ allowed: true });
  });

  afterAll(() => {
    if (originalMediaFlag === undefined) {
      delete process.env.COMMUNITY_MEDIA_PUBLISHING_ENABLED;
    } else {
      process.env.COMMUNITY_MEDIA_PUBLISHING_ENABLED = originalMediaFlag;
    }
    if (originalSupabaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    }
  });

  it("keeps an authenticated missing-or-blocked detail response private", async () => {
    const missingPostClient = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: AUTHOR_ID } },
          error: null,
        })),
      },
      from: vi.fn((table: string) => {
        if (table !== "community_posts") {
          throw new Error(`Unexpected request-client table: ${table}`);
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: null,
                error: { code: "PGRST116", message: "not found" },
              })),
            })),
          })),
        };
      }),
    };
    mocks.createClientFromRequest.mockResolvedValue(missingPostClient);

    const response = await GET(
      new Request(`http://localhost/api/community/posts/${POST_ID}`) as never,
      { params: Promise.resolve({ id: POST_ID }) },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("vary")).toBe("Authorization, Cookie");
  });

  /**
   * 로그아웃 방문자에게 getUser()는 항상 세션 없음 오류를 낸다. 그것을 그대로
   * 503으로 바꾸면 공개 글 상세가 비로그인 사용자 전원에게 닫힌다.
   */
  function missingSessionClient() {
    return {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { name: "AuthSessionMissingError", message: "Auth session missing!" },
        })),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: null,
              error: { code: "PGRST116", message: "not found" },
            })),
          })),
        })),
      })),
    };
  }

  it("does not close public post detail for a visitor who presented no credential", async () => {
    mocks.createClientFromRequest.mockResolvedValue(missingSessionClient());

    const response = await GET(
      new Request(`http://localhost/api/community/posts/${POST_ID}`) as never,
      { params: Promise.resolve({ id: POST_ID }) },
    );

    expect(response.status).not.toBe(503);
    expect(response.status).toBe(404);
  });

  it("still fails closed when a presented credential cannot be verified", async () => {
    mocks.createClientFromRequest.mockResolvedValue(missingSessionClient());

    const response = await GET(
      new Request(`http://localhost/api/community/posts/${POST_ID}`, {
        headers: { cookie: "sb-slrtobkksjmxgzatjyqb-auth-token=broken" },
      }) as never,
      { params: Promise.resolve({ id: POST_ID }) },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "게시글 접근 권한을 확인하지 못했습니다.",
    });
  });

  /**
   * 없는 글 주소는 **무엇이 고장 나 있어도** 404 다.
   *
   * 2026-09-02 운영 실측: 상한 인증 쿠키를 든 브라우저에서
   * `/api/community/posts/1` 이 404 가 아니라 `500 {"error":"서버 오류가
   * 발생했습니다."}` 였다. id 판정보다 **먼저** 있는 단계(세션 읽기)가 던졌기
   * 때문이다. 원인 하나를 고치는 것과 별개로, 그 앞 단계는 앞으로도 던질 수 있다.
   */
  it("세션 읽기가 던져도 UUID 가 아닌 주소는 404 다", async () => {
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => {
          throw new Error("Invalid UTF-8 sequence");
        }),
      },
      from: vi.fn(() => {
        throw new Error("없는 주소로 DB 를 건드리면 안 된다");
      }),
    });

    const response = await GET(
      new Request("http://localhost/api/community/posts/1", {
        headers: { cookie: "sb-slrtobkksjmxgzatjyqb-auth-token=base64-garbage" },
      }) as never,
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "게시글을 찾을 수 없습니다.",
    });
  });

  it("세션 읽기가 던져도 500 이 아니라 확인 실패(503)로 닫는다", async () => {
    // 주소는 멀쩡한데 세션을 못 읽는 경우다. 자격 증명을 제시했으므로 fail-closed
    // 지만, 그 답은 "서버 오류" 가 아니라 "확인하지 못했다" 여야 한다.
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => {
          throw new Error("Invalid UTF-8 sequence");
        }),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({ data: null, error: { code: "PGRST116" } })),
          })),
        })),
      })),
    });

    const response = await GET(
      new Request(`http://localhost/api/community/posts/${POST_ID}`, {
        headers: { cookie: "sb-slrtobkksjmxgzatjyqb-auth-token=base64-garbage" },
      }) as never,
      { params: Promise.resolve({ id: POST_ID }) },
    );

    expect(response.status).toBe(503);
  });

  /**
   * 투표는 글의 곁가지다. 예전에는 `if (pollError) throw pollError;` 라서, 투표가
   * 붙어 있지도 않은 글이 투표 테이블 조회 실패 하나로 통째로 500 이 됐다.
   */
  it("투표 조회가 실패해도 글 본문은 그대로 내려준다", async () => {
    mocks.getCommunityAuthorMap.mockResolvedValue({});
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { name: "AuthSessionMissingError", message: "Auth session missing!" },
        })),
      },
      from: vi.fn((table: string) => {
        if (table === "community_polls") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: null,
                  error: { code: "57014", message: "canceling statement" },
                })),
              })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: {
                  id: POST_ID,
                  author_id: AUTHOR_ID,
                  visibility: "public",
                  under_review: false,
                  title: "투표가 없어도 읽히는 글",
                  content: "본문",
                  vendor_tags: [],
                },
                error: null,
              })),
            })),
          })),
        };
      }),
    });

    const response = await GET(
      new Request(`http://localhost/api/community/posts/${POST_ID}`) as never,
      { params: Promise.resolve({ id: POST_ID }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: POST_ID,
      title: "투표가 없어도 읽히는 글",
      poll: null,
    });
  });

  it("loads poll counters only through the actor projection after the viewer boundary", async () => {
    const viewerRpc = vi.fn(() => {
      throw new Error("viewer-scoped client must not expose the block oracle");
    });
    const post = {
      id: POST_ID,
      author_id: AUTHOR_ID,
      visibility: "public",
      under_review: false,
      vendor_tags: [],
      title: "투표가 있는 글",
      content: "본문",
    };
    const postQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn(async () => ({ data: post, error: null })),
    };
    postQuery.select.mockReturnValue(postQuery);
    postQuery.eq.mockReturnValue(postQuery);
    const pollQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({
        data: { id: "44444444-4444-4444-8444-444444444444", post_id: POST_ID },
        error: null,
      })),
    };
    pollQuery.select.mockReturnValue(pollQuery);
    pollQuery.eq.mockReturnValue(pollQuery);
    const emptySingleQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    emptySingleQuery.select.mockReturnValue(emptySingleQuery);
    emptySingleQuery.eq.mockReturnValue(emptySingleQuery);
    const requestFrom = vi.fn((table: string) => {
      if (table === "community_posts") return postQuery;
      if (table === "community_polls") return pollQuery;
      if (table === "community_votes" || table === "community_bookmarks") {
        return emptySingleQuery;
      }
      throw new Error(`Unexpected request table: ${table}`);
    });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: ADMIN_ID } },
          error: null,
        })),
      },
      from: requestFrom,
      rpc: viewerRpc,
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
        id: "44444444-4444-4444-8444-444444444444",
        post_id: POST_ID,
        version: 1,
        question: "어떤 안이 좋나요?",
        allow_multiple: false,
        is_anonymous: true,
        hide_results_until_voted: false,
        closes_at: null,
        total_voters: 2,
        total_votes: 2,
        created_at: "2026-08-04T00:00:00.000Z",
        results_hidden: false,
        user_voted_option_ids: [],
        options: [],
        },
        error: null,
      };
    });
    const adminFrom = vi.fn((table: string) => {
      if (table !== "profiles") {
        throw new Error(`Poll tables must not be read directly by service: ${table}`);
      }
      return profileQuery(false);
    });
    mocks.createAdminClient.mockReturnValue({ from: adminFrom, rpc: serviceRpc });

    const response = await GET(
      new Request(`http://localhost/api/community/posts/${POST_ID}`) as never,
      { params: Promise.resolve({ id: POST_ID }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(pollQuery.select).toHaveBeenCalledWith("id, post_id");
    expect(viewerRpc).not.toHaveBeenCalled();
    expect(serviceRpc).toHaveBeenCalledWith("community_viewer_can_see", {
      p_viewer_user_id: ADMIN_ID,
      p_other_user_id: AUTHOR_ID,
    });
    expect(serviceRpc).toHaveBeenCalledWith(
      "community_get_poll_actor_projection",
      {
        p_actor_id: ADMIN_ID,
        p_poll_id: "44444444-4444-4444-8444-444444444444",
      },
    );
    expect(body.poll).toMatchObject({ total_voters: 2, results_hidden: false });
  });

  it("lets the author mark a question resolved and returns the updated post", async () => {
    const posts = communityPostsQuery();
    const client = requestClient(AUTHOR_ID, posts);
    mocks.createClientFromRequest.mockResolvedValue(client);
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        if (table === "community_posts") return posts.query;
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const response = await PATCH(request({ is_resolved: true }) as never, {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(response.status).toBe(200);
    expect(posts.update).toHaveBeenCalledWith(
      expect.objectContaining({
        is_resolved: true,
        updated_at: expect.any(String),
      }),
    );
    expect(posts.updateChain.eq).toHaveBeenCalledWith("id", POST_ID);
    expect(posts.updateChain.eq).toHaveBeenCalledWith("author_id", AUTHOR_ID);
    await expect(response.json()).resolves.toEqual({
      post: expect.objectContaining({
        id: POST_ID,
        is_resolved: true,
      }),
    });
  });

  it("fails as not found when the post author changes between read and write", async () => {
    const posts = communityPostsQuery();
    posts.single.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST116", message: "row no longer matches" },
    } as never);
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(AUTHOR_ID, posts),
    );
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        if (table === "community_posts") return posts.query;
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const response = await PATCH(request({ is_resolved: true }) as never, {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(posts.updateChain.eq).toHaveBeenCalledWith("author_id", AUTHOR_ID);
    expect(response.status).toBe(404);
  });

  it("logs only a content-free category and code when a post update fails", async () => {
    const posts = communityPostsQuery();
    posts.single.mockResolvedValueOnce({
      data: null,
      error: { code: "DB999", message: "secret-post-content-marker" },
    } as never);
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(AUTHOR_ID, posts),
    );
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        if (table === "community_posts") return posts.query;
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });
    // 실패 보고는 이제 `log.error` 를 거쳐 Sentry 로도 나간다. 그러니 "본문이
    // 새지 않는다"는 계약은 콘솔이 아니라 그 입구에서 확인해야 한다.
    const response = await PATCH(request({ is_resolved: true }) as never, {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(response.status).toBe(500);
    expect(mocks.logError).toHaveBeenCalledWith("[community.posts.patch]", {
      category: "database",
      code: "DB999",
    });
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain(
      "secret-post-content-marker",
    );
  });

  it("rejects a declared post patch above 512 KiB before the service write", async () => {
    const posts = communityPostsQuery();
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(AUTHOR_ID, posts),
    );
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        if (table === "community_posts") return posts.query;
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });
    const oversized = rawPatchRequest("{}", {
      "content-length": String(512 * 1024 + 1),
    });

    const response = await PATCH(oversized as never, {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(response.status).toBe(413);
    expect(oversized.bodyUsed).toBe(false);
    expect(posts.update).not.toHaveBeenCalled();
  });

  it("rejects a streamed post patch above 512 KiB without content-length", async () => {
    const posts = communityPostsQuery();
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(AUTHOR_ID, posts),
    );
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        if (table === "community_posts") return posts.query;
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(512 * 1024 + 1)));
        controller.close();
      },
    });
    const oversized = rawPatchRequest(stream);

    const response = await PATCH(oversized as never, {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(oversized.headers.get("content-length")).toBeNull();
    expect(response.status).toBe(413);
    expect(posts.update).not.toHaveBeenCalled();
  });

  it("rejects unknown mutation fields instead of forwarding them to the post update", async () => {
    const posts = communityPostsQuery();
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(AUTHOR_ID, posts),
    );
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        if (table === "community_posts") return posts.query;
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const response = await PATCH(request({ author_id: ADMIN_ID }) as never, {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(response.status).toBe(400);
    expect(posts.update).not.toHaveBeenCalled();
  });

  it("rejects malformed values for otherwise supported post fields", async () => {
    const posts = communityPostsQuery();
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(AUTHOR_ID, posts),
    );
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        if (table === "community_posts") return posts.query;
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const response = await PATCH(request({ tags: "not-an-array" }) as never, {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(response.status).toBe(400);
    expect(posts.update).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "{"],
    ["a non-object body", "[]"],
    ["a dangerous unknown field", '{"__proto__":{"polluted":true}}'],
  ])("rejects %s before the post service write", async (_label, rawBody) => {
    const posts = communityPostsQuery();
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(AUTHOR_ID, posts),
    );
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        if (table === "community_posts") return posts.query;
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const response = await PATCH(rawPatchRequest(rawBody) as never, {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(response.status).toBe(400);
    expect(posts.update).not.toHaveBeenCalled();
  });

  it("preserves supported disclosure, vendor, tag, and price fields for the author", async () => {
    const posts = communityPostsQuery();
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(AUTHOR_ID, posts),
    );
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        if (table === "community_posts") return posts.query;
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const response = await PATCH(request({
      vendor_tags: ["venue"],
      tags: ["budget"],
      ad_disclosure: "sponsored",
      sponsorship_detail: "sample benefit received",
      price_data: {
        vendor_category: "venue",
        base_price: 2_500,
        extra_price: 100,
        vendor_name: "Sample Venue",
        region: "Seoul",
        details: "weekday package",
      },
    }) as never, {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(response.status).toBe(200);
    expect(posts.update).toHaveBeenCalledWith(expect.objectContaining({
      vendor_tags: ["venue"],
      tags: ["budget"],
      ad_disclosure: "sponsored",
      sponsorship_detail: "sample benefit received",
      price_data: expect.objectContaining({
        vendor_category: "venue",
        base_price: 2_500,
      }),
    }));
  });

  it("rejects a non-boolean resolution value before writing", async () => {
    const posts = communityPostsQuery();
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(AUTHOR_ID, posts),
    );
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        if (table === "community_posts") return posts.query;
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const response = await PATCH(request({ is_resolved: "yes" }) as never, {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(response.status).toBe(400);
    expect(posts.update).not.toHaveBeenCalled();
  });

  it("does not let another member change the resolution state", async () => {
    const posts = communityPostsQuery(AUTHOR_ID);
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient("44444444-4444-4444-8444-444444444444", posts),
    );
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        if (table === "community_posts") return posts.query;
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const response = await PATCH(request({ is_resolved: true }) as never, {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(response.status).toBe(403);
    expect(posts.update).not.toHaveBeenCalled();
  });

  it.each([
    ["title", { title: "administrator rewrite" }],
    ["content", { content: "administrator rewrite" }],
    ["advertising disclosure", { ad_disclosure: "ad" }],
    ["sponsorship detail", { sponsorship_detail: "administrator rewrite" }],
    ["price", { price_data: { vendor_category: "venue", base_price: 1 } }],
    ["vendor tags", { vendor_tags: ["administrator"] }],
    ["images", { images: [IMAGE_URL] }],
    ["slides", { slides: [{ type: "image", url: IMAGE_URL }] }],
  ])("routes an administrator away from rewriting another author's %s", async (_label, payload) => {
    const posts = communityPostsQuery(AUTHOR_ID);
    const client = requestClient(ADMIN_ID, posts);
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(true);
        if (table === "community_posts") return posts.query;
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    };
    mocks.createClientFromRequest.mockResolvedValue(client);
    mocks.createAdminClient.mockReturnValue(adminClient);

    const adminRequest = request(payload);
    const response = await PATCH(adminRequest as never, {
      params: Promise.resolve({ id: POST_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("COMMUNITY_ADMIN_EDIT_REQUIRES_AUDITED_ACTION");
    expect(adminRequest.bodyUsed).toBe(false);
    expect(posts.update).not.toHaveBeenCalled();
  });

  it("does not let an administrator overwrite another author's visibility intent", async () => {
    const posts = communityPostsQuery(AUTHOR_ID);
    const client = requestClient(ADMIN_ID, posts);
    mocks.createClientFromRequest.mockResolvedValue(client);
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(true);
        if (table === "community_posts") return posts.query;
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const adminRequest = request({ visibility: "draft" });
    const response = await PATCH(adminRequest as never, {
      params: Promise.resolve({ id: POST_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("COMMUNITY_ADMIN_EDIT_REQUIRES_AUDITED_ACTION");
    expect(adminRequest.bodyUsed).toBe(false);
    expect(posts.update).not.toHaveBeenCalled();
  });

  it("routes an administrator away from hard deletion of another author's post", async () => {
    const posts = communityPostsQuery(AUTHOR_ID);
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(ADMIN_ID, posts),
    );
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(true);
        if (table === "community_posts") return posts.query;
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const response = await DELETE(
      new Request(`http://localhost/api/community/posts/${POST_ID}`, {
        method: "DELETE",
      }) as never,
      { params: Promise.resolve({ id: POST_ID }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("COMMUNITY_ADMIN_DELETE_REQUIRES_AUDITED_ACTION");
  });

  it("commits an author's deletion and exact profile count through one atomic receipt", async () => {
    const posts = communityPostsQuery(AUTHOR_ID);
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(AUTHOR_ID, posts),
    );
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe("community_delete_post_service");
      expect(args).toEqual({ p_actor_id: AUTHOR_ID, p_post_id: POST_ID });
      return {
        data: {
          actor_id: AUTHOR_ID,
          post_id: POST_ID,
          deleted: true,
          post_count: 2,
        },
        error: null,
      };
    });
    const serviceFrom = vi.fn((table: string) => {
      if (table === "profiles") return profileQuery(false);
      throw new Error(`Direct delete is not part of the post command: ${table}`);
    });
    mocks.createAdminClient.mockReturnValue({ from: serviceFrom, rpc });

    const response = await DELETE(
      new Request(`http://localhost/api/community/posts/${POST_ID}`, {
        method: "DELETE",
      }) as never,
      { params: Promise.resolve({ id: POST_ID }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      actor_id: AUTHOR_ID,
      post_id: POST_ID,
      deleted: true,
      post_count: 2,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(serviceFrom).toHaveBeenCalledTimes(1);
  });

  it("fails closed when an author-delete RPC returns a malformed receipt", async () => {
    const posts = communityPostsQuery(AUTHOR_ID);
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(AUTHOR_ID, posts),
    );
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        throw new Error(`Unexpected service table: ${table}`);
      }),
      rpc: vi.fn(async () => ({
        data: {
          actor_id: AUTHOR_ID,
          post_id: POST_ID,
          deleted: true,
          post_count: -1,
        },
        error: null,
      })),
    });

    const response = await DELETE(
      new Request(`http://localhost/api/community/posts/${POST_ID}`, {
        method: "DELETE",
      }) as never,
      { params: Promise.resolve({ id: POST_ID }) },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_POST_DELETE_UNCONFIRMED",
    });
  });

  it("returns a stable author-delete retry receipt without requiring the deleted row", async () => {
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: AUTHOR_ID } },
        })),
      },
      from: vi.fn(() => {
        throw new Error("A deleted row must not be pre-read for an exact retry");
      }),
    });
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        throw new Error(`Unexpected service table: ${table}`);
      }),
      rpc: vi.fn(async () => ({
        data: {
          actor_id: AUTHOR_ID,
          post_id: POST_ID,
          deleted: true,
          post_count: 0,
        },
        error: null,
      })),
    });

    const response = await DELETE(
      new Request(`http://localhost/api/community/posts/${POST_ID}`, {
        method: "DELETE",
      }) as never,
      { params: Promise.resolve({ id: POST_ID }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      actor_id: AUTHOR_ID,
      post_id: POST_ID,
      deleted: true,
      post_count: 0,
    });
  });

  it("does not reveal a foreign or hidden post through the author-delete boundary", async () => {
    const outsiderId = "44444444-4444-4444-8444-444444444444";
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: outsiderId } } })),
      },
    });
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        throw new Error(`Unexpected service table: ${table}`);
      }),
      rpc: vi.fn(async () => ({
        data: null,
        error: { message: "COMMUNITY_POST_DELETE_FORBIDDEN" },
      })),
    });

    const response = await DELETE(
      new Request(`http://localhost/api/community/posts/${POST_ID}`, {
        method: "DELETE",
      }) as never,
      { params: Promise.resolve({ id: POST_ID }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("찾을 수 없습니다"),
    });
  });

  it("rechecks the complete stored row before a legacy draft becomes public", async () => {
    const posts = communityPostsQuery(AUTHOR_ID, {
      title: "결혼 준비 기록",
      content: "제 이름은 김민지이고 생년월일은 1993년 4월 2일이에요.",
    });
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(AUTHOR_ID, posts),
    );
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const response = await PATCH(request({ visibility: "public" }) as never, {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_PERSONAL_INFO_DETECTED",
      detected: expect.arrayContaining(["name_birth_date"]),
      error: expect.stringContaining("민감한"),
    });
    expect(posts.update).not.toHaveBeenCalled();
  });

  it("blocks personal information hidden in a rich-text attribute on edit", async () => {
    const posts = communityPostsQuery(AUTHOR_ID);
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(AUTHOR_ID, posts),
    );
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        if (table === "community_posts") return posts.query;
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const response = await PATCH(request({
      content: '<a href="mailto:victim@example.com">문의</a>',
    }) as never, {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_PERSONAL_INFO_DETECTED",
      detected: expect.arrayContaining(["email"]),
    });
    expect(posts.update).not.toHaveBeenCalled();
  });

  it("blocks a new attachment while server media publishing is default-off", async () => {
    const posts = communityPostsQuery();
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(AUTHOR_ID, posts),
    );
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const response = await PATCH(request({ images: [IMAGE_URL] }) as never, {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_MEDIA_PUBLISHING_DISABLED",
    });
    expect(posts.update).not.toHaveBeenCalled();
  });

  it("allows a text-only edit that retains the exact existing media", async () => {
    const posts = communityPostsQuery(AUTHOR_ID, {
      content: `<p>기존 본문</p><img src="${IMAGE_URL}">`,
      images: [IMAGE_URL],
    });
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(AUTHOR_ID, posts),
    );
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        if (table === "community_posts") return posts.query;
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const response = await PATCH(request({
      title: "바뀐 제목",
      content: `<p>바뀐 본문</p><img src="${IMAGE_URL}">`,
      images: [IMAGE_URL],
      slides: null,
    }) as never, {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(response.status).toBe(200);
    expect(posts.update).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "바뀐 제목",
        content: `<p>바뀐 본문</p><img src="${IMAGE_URL}">`,
        images: [IMAGE_URL],
        slides: null,
      }),
    );
  });

  it("allows removing existing media while the publishing gate is off", async () => {
    const posts = communityPostsQuery(AUTHOR_ID, {
      content: `<p>기존 본문</p><img src="${IMAGE_URL}">`,
      images: [IMAGE_URL],
    });
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(AUTHOR_ID, posts),
    );
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        if (table === "community_posts") return posts.query;
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const response = await PATCH(request({
      content: "<p>이미지를 제거한 본문</p>",
      images: [],
      slides: null,
    }) as never, {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(response.status).toBe(200);
    expect(posts.update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "<p>이미지를 제거한 본문</p>",
        images: [],
        slides: null,
      }),
    );
  });

  it("blocks changing an inline image and blocks publishing retained draft media", async () => {
    const changedPosts = communityPostsQuery(AUTHOR_ID, {
      content: `<p>기존 본문</p><img src="${IMAGE_URL}">`,
      images: [IMAGE_URL],
    });
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(AUTHOR_ID, changedPosts),
    );
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery(false);
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const changedResponse = await PATCH(request({
      content: `<p>교체 시도</p><img src="${REPLACEMENT_IMAGE_URL}">`,
    }) as never, {
      params: Promise.resolve({ id: POST_ID }),
    });
    expect(changedResponse.status).toBe(503);
    expect(changedPosts.update).not.toHaveBeenCalled();

    const draftPosts = communityPostsQuery(AUTHOR_ID, {
      visibility: "draft",
      images: [IMAGE_URL],
    });
    mocks.createClientFromRequest.mockResolvedValue(
      requestClient(AUTHOR_ID, draftPosts),
    );

    const publishResponse = await PATCH(request({ visibility: "public" }) as never, {
      params: Promise.resolve({ id: POST_ID }),
    });
    expect(publishResponse.status).toBe(503);
    expect(draftPosts.update).not.toHaveBeenCalled();
  });
});
