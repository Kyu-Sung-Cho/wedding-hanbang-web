import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { getMutedActorIds, mutedActorFilterValue } from "@/lib/community/mutes";
import { getCommunityActorIdForUser } from "@/lib/community/actorIdentity";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { GET, POST } from "../route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/community/mutes", () => ({
  getMutedActorIds: vi.fn(async () => []),
  mutedActorFilterValue: vi.fn(() => null),
}));
vi.mock("@/lib/community/actorIdentity", () => ({
  getCommunityActorIdForUser: vi.fn(async () => null),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "community:posts:test"),
}));

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";

function queryResult(result: unknown) {
  const query: Record<string, unknown> & PromiseLike<unknown> = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    not: vi.fn(() => query),
    or: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(() => query),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return query;
}

describe("/api/community/posts trust boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
    vi.mocked(getMutedActorIds).mockResolvedValue([]);
    vi.mocked(mutedActorFilterValue).mockReturnValue(null);
    vi.mocked(getCommunityActorIdForUser).mockResolvedValue(null);
  });

  it("does not treat an auth lookup failure as an anonymous empty bookmark collection", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: "auth backend unavailable" },
        }),
      },
      from: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await GET(
      new NextRequest("http://localhost/api/community/posts?bookmarked=true"),
    );

    expect(response.status).toBe(503);
  });

  it("does not disguise a failed bookmark query as a genuine empty collection", async () => {
    const postQuery = queryResult({ data: [], count: 0, error: null });
    const bookmarkQuery = queryResult({
      data: null,
      error: { message: "bookmark query failed" },
    });
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
      from: vi.fn((table: string) =>
        table === "community_bookmarks" ? bookmarkQuery : postQuery
      ),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await GET(
      new NextRequest("http://localhost/api/community/posts?bookmarked=true"),
    );

    expect(response.status).toBe(503);
  });

  it("does not turn a missing exact count into a genuine zero-post feed", async () => {
    const postQuery = queryResult({ data: [], count: null, error: null });
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
      from: vi.fn(() => postQuery),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await GET(
      new NextRequest("http://localhost/api/community/posts?sort=new"),
    );

    expect(response.status).toBe(503);
  });

  it("returns service unavailable instead of inventing an anonymous author profile", async () => {
    const postQuery = queryResult({
      data: [
        {
          id: "323e4567-e89b-42d3-a456-426614174000",
          author_id: USER_ID,
          title: "게시글",
          content: "본문",
          created_at: "2026-07-13T00:00:00.000Z",
        },
      ],
      count: 1,
      error: null,
    });
    const missingProfileQuery = queryResult({ data: [], error: null });
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
      from: vi.fn((table: string) =>
        table === "community_profiles" ? missingProfileQuery : postQuery
      ),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await GET(
      new NextRequest("http://localhost/api/community/posts?sort=new"),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "작성자 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
    });
  });

  it("applies the signed-in reader's author mutes before feed count and pagination", async () => {
    const mutedUserId = "223e4567-e89b-42d3-a456-426614174000";
    const postQuery = queryResult({ data: [], count: 0, error: null });
    vi.mocked(getMutedActorIds).mockResolvedValue([mutedUserId]);
    vi.mocked(mutedActorFilterValue).mockReturnValue(`(${mutedUserId})`);
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
      from: vi.fn(() => postQuery),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await GET(
      new NextRequest("http://localhost/api/community/posts?sort=new"),
    );

    expect(response.status).toBe(200);
    expect(postQuery.not).toHaveBeenCalledWith("author_public_id", "in", `(${mutedUserId})`);
  });

  it("rejects poll publishing before any service-role write", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
      from: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await POST(
      new NextRequest("http://localhost/api/community/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ poll: null }),
      }),
    );

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      code: "community_poll_writes_retired",
    });
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "community:posts:test",
      { maxRequests: 10, windowMs: 10 * 60 * 1000 },
      USER_ID,
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects retired price fields with an explicit gone response", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await POST(
      new NextRequest("http://localhost/api/community/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ price_data: { total: 1 } }),
      }),
    );

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      code: "community_structured_fields_retired",
      field: "price_data",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects every unknown create field instead of silently ignoring it", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await POST(
      new NextRequest("http://localhost/api/community/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "제목", unexpected: true }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ field: "unexpected" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    { tags: ["   "] },
    { ad_disclosure: "general", sponsorship_detail: "무시하면 안 되는 값" },
  ])("rejects ambiguous create values instead of dropping them: %j", async (body) => {
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await POST(
      new NextRequest("http://localhost/api/community/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: "free",
          title: "제목",
          content: "본문",
          visibility: "public",
          ad_disclosure: "general",
          ...body,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects the actual UTF-8 body size even without Content-Length", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
    const oversized = new NextRequest("http://localhost/api/community/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "가".repeat(90_000) }),
    });
    expect(oversized.headers.get("content-length")).toBeNull();

    const response = await POST(oversized);

    expect(response.status).toBe(413);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects an oversized post body before auth or JSON parsing", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/community/posts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(256 * 1024 + 1),
        },
        body: JSON.stringify({ title: "too large" }),
      }),
    );

    expect(response.status).toBe(413);
    expect(createClientFromRequest).not.toHaveBeenCalled();
  });

  it("retires the cohort feed before auth or cohort-member reads", async () => {
    const authClient = {
      auth: { getUser: vi.fn() },
      from: vi.fn(),
    };
    vi.mocked(createClientFromRequest).mockResolvedValue(
      authClient as unknown as Awaited<ReturnType<typeof createClientFromRequest>>,
    );

    const response = await GET(
      new NextRequest("http://localhost/api/community/posts?sort=my_cohort"),
    );

    expect(response.status).toBe(410);
    expect(authClient.auth.getUser).not.toHaveBeenCalled();
    expect(authClient.from).not.toHaveBeenCalled();
    const source = readFileSync(resolve(process.cwd(), "src/app/api/community/posts/route.ts"), "utf8");
    expect(source).not.toContain('.from("cohort_members")');
  });
});
