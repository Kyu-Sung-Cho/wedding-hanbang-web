import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { PATCH } from "../[id]/route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "community:post:update:test"),
}));

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const POST_ID = "323e4567-e89b-42d3-a456-426614174000";

function request(body: unknown, contentLength?: number) {
  return new NextRequest(`http://localhost/api/community/posts/${POST_ID}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(contentLength === undefined ? {} : { "content-length": String(contentLength) }),
    },
    body: JSON.stringify(body),
  });
}

function context() {
  return { params: Promise.resolve({ id: POST_ID }) };
}

function mockAuth() {
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
        error: null,
      }),
    },
  } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
}

function chainedQuery(terminal: "single" | "maybeSingle", result: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query[terminal].mockResolvedValue(result);
  return query;
}

function mockAtomicUpdate(options: {
  rpcData?: unknown;
  rpcError?: unknown;
  postData?: unknown;
} = {}) {
  const readQuery = chainedQuery("maybeSingle", {
    data: options.postData ?? {
      id: POST_ID,
      author_id: "423e4567-e89b-42d3-a456-426614174000",
      title: "수정 제목",
      content: "<p>수정 본문</p>",
    },
    error: null,
  });
  const rpc = vi.fn().mockResolvedValue({
    data: options.rpcData ?? [
      { post_id: POST_ID, updated: true, viewer_is_author: true },
    ],
    error: options.rpcError ?? null,
  });
  const serviceClient = {
    rpc,
    from: vi.fn(() => readQuery),
  };
  vi.mocked(createClient).mockReturnValue(
    serviceClient as unknown as ReturnType<typeof createClient>,
  );
  return { rpc, readQuery, serviceClient };
}

describe("PATCH /api/community/posts/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
    mockAuth();
  });

  it("rejects the actual UTF-8 body size without trusting Content-Length", async () => {
    const oversized = request({ content: "가".repeat(90_000) });
    expect(oversized.headers.get("content-length")).toBeNull();

    const response = await PATCH(oversized, context());

    expect(response.status).toBe(413);
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    "poll",
    "price_data",
    "images",
    "slides",
    "cost_data",
    "ai_comment",
    "cohort_room_id",
    "vendor_tags",
    "rating",
    "is_quick_review",
    "is_verified_review",
    "verification_doc_url",
  ])("returns gone for the retired %s field", async (field) => {
    const response = await PATCH(request({ [field]: null }), context());

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      code: "community_structured_fields_retired",
      field,
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects an unknown field before any service-role read or write", async () => {
    const response = await PATCH(request({ mystery: true }), context());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ field: "mystery" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    { title: "가".repeat(201) },
    { content: "a".repeat(50_001) },
    { tags: "태그" },
    { tags: Array.from({ length: 11 }, (_, index) => `태그${index}`) },
    { tags: [1] },
    { tags: ["가".repeat(31)] },
    { tags: ["   "] },
    { sponsorship_detail: "a".repeat(501) },
  ])("rejects invalid or over-limit values instead of coercing them: %j", async (body) => {
    const response = await PATCH(request(body), context());

    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("keeps a valid update working and writes exactly the validated values", async () => {
    const { rpc, serviceClient } = mockAtomicUpdate();

    const response = await PATCH(
      request({
        title: "  수정 제목  ",
        content: "<p>수정 본문</p><script>위험</script>",
        tags: ["준비팁"],
      }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      post: { id: POST_ID, viewer_is_author: true },
    });
    expect(rpc).toHaveBeenCalledWith("community_update_post", {
      p_actor_id: USER_ID,
      p_post_id: POST_ID,
      p_patch: {
        title: "수정 제목",
        content: "<p>수정 본문</p>",
        tags: ["준비팁"],
      },
    });
    expect(serviceClient.from).toHaveBeenCalledTimes(1);
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(
      serviceClient.from.mock.invocationCallOrder[0],
    );
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "community:post:update:test",
      { maxRequests: 30, windowMs: 60 * 60 * 1_000 },
      USER_ID,
    );
  });

  it("preserves a false author flag for a current administrator update", async () => {
    mockAtomicUpdate({
      rpcData: [{ post_id: POST_ID, updated: true, viewer_is_author: false }],
    });

    const response = await PATCH(request({ title: "관리자 수정" }), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      post: { viewer_is_author: false },
    });
  });

  it("accepts an exact replay as an idempotent update result", async () => {
    mockAtomicUpdate({
      rpcData: [{ post_id: POST_ID, updated: false, viewer_is_author: true }],
    });

    const response = await PATCH(request({ title: "수정 제목" }), context());

    expect(response.status).toBe(200);
  });

  it("maps the database's current-permission denial to forbidden", async () => {
    mockAtomicUpdate({ rpcData: null, rpcError: { code: "42501" } });

    const response = await PATCH(request({ title: "권한 없음" }), context());

    expect(response.status).toBe(403);
  });
});
