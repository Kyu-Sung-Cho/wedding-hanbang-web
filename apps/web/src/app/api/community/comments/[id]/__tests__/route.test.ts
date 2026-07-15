import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { DELETE, PATCH } from "../route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn((key: string) => `${key}:test`),
}));

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const COMMENT_ID = "223e4567-e89b-42d3-a456-426614174000";

function context(id = COMMENT_ID) {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(body: unknown, contentLength?: number) {
  const encoded = JSON.stringify(body);
  return new NextRequest(`http://localhost/api/community/comments/${COMMENT_ID}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(contentLength === undefined ? {} : { "content-length": String(contentLength) }),
    },
    body: encoded,
  });
}

function deleteRequest() {
  return new NextRequest(`http://localhost/api/community/comments/${COMMENT_ID}`, {
    method: "DELETE",
  });
}

function mockAuth(user: { id: string } | null, error: unknown = null) {
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error }),
    },
  } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
}

function updateQuery(result: unknown) {
  const query = {
    update: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  query.update.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return query;
}

describe("/api/community/comments/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
  });

  it.each([
    ["PATCH", () => PATCH(patchRequest({ content: "수정" }), context())],
    ["DELETE", () => DELETE(deleteRequest(), context())],
  ])("fails closed when %s authentication cannot be verified", async (_method, request) => {
    mockAuth(null, { message: "auth unavailable" });

    const response = await request();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    ["PATCH", () => PATCH(patchRequest({ content: "수정" }), context("not-a-uuid"))],
    ["DELETE", () => DELETE(deleteRequest(), context("not-a-uuid"))],
  ])("rejects an invalid %s comment id before authentication", async (_method, request) => {
    const response = await request();

    expect(response.status).toBe(400);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    { body: { content: "수정", author_id: USER_ID }, contentLength: undefined, expected: 400 },
    { body: { content: "수정" }, contentLength: 16 * 1024 + 1, expected: 413 },
    { body: { content: "가".repeat(2_001) }, contentLength: undefined, expected: 400 },
  ])("rejects a malformed or oversized PATCH body", async ({ body, contentLength, expected }) => {
    mockAuth({ id: USER_ID });

    const response = await PATCH(patchRequest(body, contentLength), context());

    expect(response.status).toBe(expected);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("updates only the signed-in author's active comment", async () => {
    mockAuth({ id: USER_ID });
    const query = updateQuery({
      data: {
        id: COMMENT_ID,
        author_id: USER_ID,
        content: "안전한 수정",
        is_deleted: false,
      },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => query),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await PATCH(
      patchRequest({ content: "<strong>안전한 수정</strong><script>위험</script>" }),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.comment.content).toBe("안전한 수정");
    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: "안전한 수정" }),
    );
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "community:comment:update:test",
      { maxRequests: 30, windowMs: 60 * 60 * 1_000 },
      USER_ID,
    );
    expect(query.eq).toHaveBeenCalledWith("id", COMMENT_ID);
    expect(query.eq).toHaveBeenCalledWith("author_id", USER_ID);
    expect(query.eq).toHaveBeenCalledWith("is_deleted", false);
  });

  it("does not update a comment when the actor-author condition matches no row", async () => {
    mockAuth({ id: USER_ID });
    const query = updateQuery({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => query),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await PATCH(patchRequest({ content: "수정 시도" }), context());

    expect(response.status).toBe(404);
  });

  it("deletes through the atomic actor-scoped RPC and verifies its result", async () => {
    mockAuth({ id: USER_ID });
    const rpc = vi.fn().mockResolvedValue({
      data: [{ comment_id: COMMENT_ID, author_id: USER_ID, post_id: "323e4567-e89b-42d3-a456-426614174000", deleted: true }],
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createAdminClient>);

    const response = await DELETE(deleteRequest(), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, alreadyDeleted: false });
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "community:comment:delete:test",
      { maxRequests: 10, windowMs: 60 * 60 * 1_000 },
      USER_ID,
    );
    expect(rpc).toHaveBeenCalledWith("community_soft_delete_comment", {
      p_actor_id: USER_ID,
      p_comment_id: COMMENT_ID,
    });
  });

  it("fails closed when an atomic delete result cannot be tied to the actor and comment", async () => {
    mockAuth({ id: USER_ID });
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: [{ comment_id: COMMENT_ID, author_id: "423e4567-e89b-42d3-a456-426614174000", deleted: true }],
        error: null,
      }),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await DELETE(deleteRequest(), context());

    expect(response.status).toBe(503);
  });
});
