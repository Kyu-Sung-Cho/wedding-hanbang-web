import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { POST } from "../route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "chat:clear-request:test"),
}));

describe("POST /api/chat/clear-request", () => {
  const userId = "123e4567-e89b-42d3-a456-426614174000";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
  });

  it("fails closed when authentication state cannot be verified", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: "auth unavailable" },
        }),
      },
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await POST(new Request("http://localhost/api/chat/clear-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "request" }),
    }));

    expect(response.status).toBe(503);
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("binds the persistent limiter to the authenticated account", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: userId } },
          error: null,
        }),
      },
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await POST(new Request("http://localhost/api/chat/clear-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(400);
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "chat:clear-request:test",
      { maxRequests: 20, windowMs: 10 * 60 * 1000 },
      userId,
    );
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
