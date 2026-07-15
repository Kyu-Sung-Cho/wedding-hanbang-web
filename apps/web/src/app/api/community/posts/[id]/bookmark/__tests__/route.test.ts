import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { POST } from "../route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "community:bookmark:test"),
}));

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const POST_ID = "223e4567-e89b-42d3-a456-426614174000";

function request(bookmarked?: boolean) {
  return new NextRequest(`http://localhost/api/community/posts/${POST_ID}/bookmark`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bookmarked === undefined ? {} : { bookmarked }),
  });
}

function thenableQuery(result: unknown) {
  const query: Record<string, unknown> & PromiseLike<unknown> = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
    single: vi.fn(async () => result),
    delete: vi.fn(() => query),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return query;
}

function mockClients(options: {
  existingBookmark: boolean;
  insertError?: { code?: string; message?: string } | null;
} = { existingBookmark: false }) {
  const readablePost = thenableQuery({ data: { id: POST_ID }, error: null });
  const ownBookmark = thenableQuery({
    data: options.existingBookmark ? { id: "bookmark-1" } : null,
    error: null,
  });
  const authClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
    },
    from: vi.fn((table: string) => table === "community_posts" ? readablePost : ownBookmark),
  };
  vi.mocked(createClientFromRequest).mockResolvedValue(
    authClient as unknown as Awaited<ReturnType<typeof createClientFromRequest>>,
  );

  const serviceBookmark = thenableQuery({
    data: options.existingBookmark ? { id: "bookmark-1" } : null,
    error: null,
  });
  Object.assign(serviceBookmark, {
    insert: vi.fn(async () => ({ data: null, error: options.insertError ?? null })),
  });
  const servicePost = thenableQuery({ data: { bookmark_count: 1 }, error: null });
  const serviceClient = {
    from: vi.fn((table: string) => table === "community_posts" ? servicePost : serviceBookmark),
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
  };
  vi.mocked(createClient).mockReturnValue(serviceClient as unknown as ReturnType<typeof createClient>);
  return { authClient, serviceClient, serviceBookmark };
}

function context() {
  return { params: Promise.resolve({ id: POST_ID }) };
}

describe("POST /api/community/posts/:id/bookmark", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  });

  it("requires the caller to state the desired bookmark value", async () => {
    mockClients();

    const response = await POST(request(), context());

    expect(response.status).toBe(400);
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "community:bookmark:test",
      { maxRequests: 30, windowMs: 60 * 1000 },
      USER_ID,
    );
  });

  it("is idempotent when a retry asks to keep an existing bookmark", async () => {
    const { serviceBookmark } = mockClients({
      existingBookmark: true,
      insertError: { code: "23505", message: "duplicate" },
    });

    const first = await POST(request(true), context());
    const second = await POST(request(true), context());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toMatchObject({ bookmarked: true });
    expect(await second.json()).toMatchObject({ bookmarked: true });
    expect(serviceBookmark.delete).not.toHaveBeenCalled();
  });
});
