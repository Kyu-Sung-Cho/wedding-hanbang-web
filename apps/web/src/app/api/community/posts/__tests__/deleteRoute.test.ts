import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { DELETE } from "../[id]/route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "community:post:delete:test"),
}));

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const AUTHOR_ID = "223e4567-e89b-42d3-a456-426614174000";
const POST_ID = "323e4567-e89b-42d3-a456-426614174000";

function request() {
  return new NextRequest(`http://localhost/api/community/posts/${POST_ID}`, {
    method: "DELETE",
  });
}

function context(id = POST_ID) {
  return { params: Promise.resolve({ id }) };
}

function mockAuth(user: { id: string } | null, error: unknown = null) {
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error }),
    },
  } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
}

function mockDeleteRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  vi.mocked(createClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createClient>);
  return rpc;
}

describe("DELETE /api/community/posts/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
  });

  it("rejects an invalid id before authentication", async () => {
    const response = await DELETE(request(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(createClientFromRequest).not.toHaveBeenCalled();
  });

  it("fails closed when authentication cannot be verified", async () => {
    mockAuth(null, { message: "auth unavailable" });

    const response = await DELETE(request(), context());

    expect(response.status).toBe(503);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("deletes through the single atomic lifecycle RPC", async () => {
    mockAuth({ id: USER_ID });
    const rpc = mockDeleteRpc({
      data: [{ post_id: POST_ID, author_id: USER_ID, deleted: true }],
      error: null,
    });

    const response = await DELETE(request(), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, alreadyDeleted: false });
    expect(rpc).toHaveBeenCalledWith("community_hard_delete_post", {
      p_actor_id: USER_ID,
      p_post_id: POST_ID,
    });
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "community:post:delete:test",
      { maxRequests: 10, windowMs: 60 * 60 * 1_000 },
      USER_ID,
    );
  });

  it("lets the database decide current admin permission without a raw-author pre-read", async () => {
    mockAuth({ id: USER_ID });
    const rpc = mockDeleteRpc({
      data: [{ post_id: POST_ID, author_id: AUTHOR_ID, deleted: true }],
      error: null,
    });

    const response = await DELETE(request(), context());

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    const serviceClient = vi.mocked(createClient).mock.results[0]?.value as {
      from?: unknown;
    };
    expect(serviceClient.from).toBeUndefined();
  });

  it("maps database permission denial to forbidden", async () => {
    mockAuth({ id: USER_ID });
    mockDeleteRpc({ data: null, error: { code: "42501" } });

    const response = await DELETE(request(), context());

    expect(response.status).toBe(403);
  });

  it("treats a retry after deletion as an idempotent success", async () => {
    mockAuth({ id: USER_ID });
    mockDeleteRpc({
      data: [{ post_id: POST_ID, author_id: null, deleted: false }],
      error: null,
    });

    const response = await DELETE(request(), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, alreadyDeleted: true });
  });

  it("fails closed on a malformed RPC result", async () => {
    mockAuth({ id: USER_ID });
    mockDeleteRpc({ data: [], error: null });

    const response = await DELETE(request(), context());

    expect(response.status).toBe(503);
  });
});
