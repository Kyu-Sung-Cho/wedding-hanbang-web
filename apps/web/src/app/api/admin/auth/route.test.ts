import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn(),
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: (prefix: string) => `${prefix}:pseudonymous-test-key`,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

import { GET, POST } from "./route";

describe("admin auth shared rate-limit boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_PASSWORD", "admin-bootstrap-secret-longer-than-32-characters");
  });

  it("fails closed before reading admin state when the shared limiter blocks", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValue(
      new Response(JSON.stringify({ error: "limited" }), { status: 429 }),
    );

    const response = await GET(new Request("https://hanbang.ai/api/admin/auth?check=exists"));

    expect(response.status).toBe(429);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledTimes(1);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed before comparing the bootstrap secret", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValue(
      new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
    );

    const response = await POST(new Request("https://hanbang.ai/api/admin/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "initial-setup",
        setupPassword: "wrong",
      }),
    }));

    expect(response.status).toBe(503);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledTimes(1);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("deletes a newly created Auth user when initial admin profile persistence fails", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    const deleteUser = vi.fn().mockResolvedValue({ error: null });
    const upsert = vi.fn().mockResolvedValue({ error: { message: "profile write failed" } });
    const countEq = vi.fn().mockResolvedValue({ count: 0, error: null });
    const from = vi.fn()
      .mockReturnValueOnce({
        select: vi.fn(() => ({ eq: countEq })),
      })
      .mockReturnValueOnce({ upsert });
    mocks.createAdminClient.mockReturnValue({
      from,
      auth: {
        admin: {
          createUser: vi.fn().mockResolvedValue({
            data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
            error: null,
          }),
          deleteUser,
        },
      },
    });

    const response = await POST(new Request("https://hanbang.ai/api/admin/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "initial-setup",
        setupPassword: "admin-bootstrap-secret-longer-than-32-characters",
        email: "admin@example.com",
        password: "ValidAdminPass123!",
        name: "Admin",
      }),
    }));

    expect(response.status).toBe(500);
    expect(deleteUser).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
  });
});
