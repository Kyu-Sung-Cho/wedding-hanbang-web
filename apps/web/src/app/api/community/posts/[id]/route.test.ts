import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  revalidatePath: vi.fn(),
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

import { PATCH } from "./route";

const POST_ID = "22222222-2222-4222-8222-222222222222";
const AUTHOR_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "33333333-3333-4333-8333-333333333333";

function request(body: unknown) {
  return new Request(`http://localhost/api/community/posts/${POST_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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

  it("rejects a non-boolean resolution value before writing", async () => {
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
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const response = await PATCH(request({ is_resolved: true }) as never, {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(response.status).toBe(403);
    expect(posts.update).not.toHaveBeenCalled();
  });

  it("lets an administrator reopen a question", async () => {
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

    const response = await PATCH(request({ is_resolved: false }) as never, {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(response.status).toBe(200);
    expect(posts.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_resolved: false }),
    );
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
});
