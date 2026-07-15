import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClientFromRequest } from "@/lib/supabase/server";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { DELETE } from "../route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/demoSession", () => ({
  hasSignedDemoSessionFromCookieHeader: vi.fn(() => true),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "chat:messages:delete:test"),
}));

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const COUPLE_ID = "223e4567-e89b-42d3-a456-426614174000";

function request(mode = "view_reset_shared") {
  return new Request("http://localhost/api/chat/messages", {
    method: "DELETE",
    headers: { "content-type": "application/json", cookie: "demo_session=signed" },
    body: JSON.stringify({ coupleId: COUPLE_ID, mode }),
  });
}

describe("DELETE /api/chat/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasSignedDemoSessionFromCookieHeader).mockReturnValue(true);
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
  });

  it("does not let a demo cookie bypass an authentication lookup failure", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: "auth unavailable" },
        }),
      },
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await DELETE(request());

    expect(response.status).toBe(503);
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("binds non-lifecycle delete requests to the authenticated account", async () => {
    vi.mocked(hasSignedDemoSessionFromCookieHeader).mockReturnValue(false);
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const ownershipQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: { couple_id: COUPLE_ID, role: "bride" },
        error: null,
      }),
    };
    ownershipQuery.select.mockReturnValue(ownershipQuery);
    ownershipQuery.eq.mockReturnValue(ownershipQuery);
    const actionRpc = vi.fn().mockResolvedValue({
      data: "2026-07-14T00:00:00.000Z",
      error: null,
    });
    vi.mocked(createAdminClient)
      .mockReturnValueOnce({ from: vi.fn(() => ownershipQuery) } as unknown as ReturnType<typeof createAdminClient>)
      .mockReturnValueOnce({ rpc: actionRpc } as unknown as ReturnType<typeof createAdminClient>);

    const response = await DELETE(request());

    expect(response.status).toBe(200);
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "chat:messages:delete:test",
      { maxRequests: 10, windowMs: 10 * 60 * 1000 },
      USER_ID,
    );
  });

  it("lets an already-started private deletion continue without consuming a new bucket", async () => {
    vi.mocked(hasSignedDemoSessionFromCookieHeader).mockReturnValue(false);
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const ownershipQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: { couple_id: COUPLE_ID, role: "bride" },
        error: null,
      }),
    };
    ownershipQuery.select.mockReturnValue(ownershipQuery);
    ownershipQuery.eq.mockReturnValue(ownershipQuery);
    const lifecycleQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { private_chat_deleting_at: "2026-07-14T00:00:00.000Z" },
        error: null,
      }),
    };
    lifecycleQuery.select.mockReturnValue(lifecycleQuery);
    lifecycleQuery.eq.mockReturnValue(lifecycleQuery);
    const actionRpc = vi.fn(async (name: string) => {
      if (name === "count_active_amora_private_provider_leases") {
        return { data: 1, error: null };
      }
      return { data: null, error: null };
    });
    vi.mocked(createAdminClient)
      .mockReturnValueOnce({ from: vi.fn(() => ownershipQuery) } as unknown as ReturnType<typeof createAdminClient>)
      .mockReturnValueOnce({
        from: vi.fn(() => lifecycleQuery),
        rpc: actionRpc,
      } as unknown as ReturnType<typeof createAdminClient>);

    const response = await DELETE(request("delete_private"));

    expect(response.status).toBe(202);
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(actionRpc).toHaveBeenCalledWith("begin_private_amora_delete", expect.any(Object));
  });
});
