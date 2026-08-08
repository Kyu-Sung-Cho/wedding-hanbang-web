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
      headers: {
        "content-type": "application/json",
        origin: "https://hanbang.ai",
      },
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
      headers: {
        "content-type": "application/json",
        origin: "https://hanbang.ai",
      },
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

  it("rejects an untrusted mutation before reading configuration or rate state", async () => {
    const response = await POST(new Request("https://hanbang.ai/api/admin/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "login" }),
    }));

    expect(response.status).toBe(403);
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a streamed oversized body without Content-Length", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    const request = new Request("https://hanbang.ai/api/admin/auth", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://hanbang.ai",
      },
      body: JSON.stringify({ padding: "x".repeat(17 * 1024) }),
    });
    expect(request.headers.get("content-length")).toBeNull();

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed on malformed JSON", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    const response = await POST(new Request("https://hanbang.ai/api/admin/auth", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://hanbang.ai",
      },
      body: "{",
    }));

    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("uses one fixed POST rate-limit namespace for unknown actions", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    const response = await POST(new Request("https://hanbang.ai/api/admin/auth", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://hanbang.ai",
      },
      body: JSON.stringify({ action: "attacker-controlled-key" }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "admin-auth:post:pseudonymous-test-key",
      { maxRequests: 8, windowMs: 15 * 60 * 1000 },
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("does not expose raw Auth provider failures", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    const providerMessage = "secret provider detail with internal tenant id";
    const countEq = vi.fn().mockResolvedValue({ count: 0, error: null });
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn(() => ({ eq: countEq })),
      }),
      auth: {
        admin: {
          createUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: { message: providerMessage },
          }),
        },
      },
    });

    const response = await POST(new Request("https://hanbang.ai/api/admin/auth", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://hanbang.ai",
      },
      body: JSON.stringify({
        action: "initial-setup",
        setupPassword: "admin-bootstrap-secret-longer-than-32-characters",
        email: "admin@example.com",
        password: "ValidAdminPass123!",
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain(providerMessage);
    expect(body).toEqual({ error: "관리자 계정을 생성하지 못했습니다." });
  });
});
