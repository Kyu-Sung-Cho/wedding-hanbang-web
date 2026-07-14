import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistentStrict: vi.fn(),
  rateLimitKey: vi.fn((scope: string, request?: unknown) => {
    void scope;
    void request;
    return "admin-auth:ip";
  }),
  createClientFromRequest: vi.fn(),
  createServiceClient: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  profileCount: vi.fn(),
  profileCountEq: vi.fn(),
  profileSingle: vi.fn(),
  profileUpsert: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistentStrict: mocks.checkRateLimitPersistentStrict,
  rateLimitKey: mocks.rateLimitKey,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createServiceClient,
}));

import { GET, POST } from "../route";

function request(action: unknown) {
  return new Request("http://localhost/api/admin/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, setupPassword: "wrong-password" }),
  });
}

describe("/api/admin/auth POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.ADMIN_PASSWORD = "a-unique-admin-access-secret-123";
    process.env.ADMIN_INITIAL_SETUP_ENABLED = "true";
    mocks.checkRateLimitPersistentStrict.mockResolvedValue(null);
    mocks.profileCount.mockResolvedValue({ count: 0, error: null });
    mocks.profileUpsert.mockResolvedValue({ error: null });
    mocks.createUser.mockResolvedValue({
      data: { user: { id: "new-admin" } },
      error: null,
    });
    mocks.deleteUser.mockResolvedValue({ error: null });
    mocks.profileCountEq.mockReturnValue({ is: mocks.profileCount });
    mocks.createServiceClient.mockReturnValue({
      auth: { admin: { createUser: mocks.createUser, deleteUser: mocks.deleteUser } },
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: mocks.profileCountEq })),
        upsert: mocks.profileUpsert,
      })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects unknown actions before allocating a rate-limit bucket", async () => {
    const response = await POST(request("attacker-controlled-bucket"));

    expect(response.status).toBe(400);
    expect(mocks.rateLimitKey).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistentStrict).not.toHaveBeenCalled();
  });

  it.each(["login", "initial-setup", "create-admin"])(
    "shares one IP bucket for the %s action",
    async (action) => {
      const response = await POST(request(action));

      expect(response.status).toBe(403);
      expect(mocks.rateLimitKey).toHaveBeenCalledTimes(1);
      expect(mocks.rateLimitKey.mock.calls[0]?.[0]).toBe("admin-auth");
    },
  );

  it("fails closed when initial administrator inventory cannot be read", async () => {
    mocks.profileCount.mockResolvedValueOnce({ count: null, error: { message: "db unavailable" } });
    const response = await POST(new Request("http://localhost/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "initial-setup",
        setupPassword: process.env.ADMIN_PASSWORD,
        email: "admin@example.com",
        password: "StrongAdmin1!",
      }),
    }));

    expect(response.status).toBe(503);
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "ADMIN_AUTH_ADMIN_INVENTORY_LOOKUP_FAILED",
      { context: "initial-setup" },
    );
  });

  it("does not expose account provider errors to the client or logs", async () => {
    const sensitiveMessage = "provider-internal tenant=secret-project";
    mocks.createUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: sensitiveMessage },
    });

    const response = await POST(new Request("http://localhost/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "initial-setup",
        setupPassword: process.env.ADMIN_PASSWORD,
        email: "admin@example.com",
        password: "StrongAdmin1!",
      }),
    }));
    const responseText = await response.text();

    expect(response.status).toBe(503);
    expect(responseText).not.toContain(sensitiveMessage);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(sensitiveMessage);
    expect(console.error).toHaveBeenCalledWith(
      "ADMIN_AUTH_USER_CREATE_FAILED",
      { context: "initial-setup" },
    );
  });

  it("fails closed with a symbolic log when GET profile lookup fails", async () => {
    const sensitiveMessage = "profiles row policy details secret";
    mocks.createClientFromRequest.mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "admin-1" } } }) },
    });
    mocks.profileSingle.mockResolvedValueOnce({
      data: null,
      error: { message: sensitiveMessage },
    });
    mocks.createServiceClient.mockReturnValueOnce({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: mocks.profileSingle })),
        })),
      })),
    });

    const response = await GET(new Request("http://localhost/api/admin/auth"));
    const responseText = await response.text();

    expect(response.status).toBe(503);
    expect(responseText).not.toContain(sensitiveMessage);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(sensitiveMessage);
    expect(console.error).toHaveBeenCalledWith(
      "ADMIN_AUTH_PROFILE_LOOKUP_FAILED",
      { context: "session-check" },
    );
  });

  it("treats a deleting administrator session as non-admin", async () => {
    mocks.createClientFromRequest.mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "admin-1", email: "admin@example.com" } },
      }) },
    });
    mocks.profileSingle.mockResolvedValueOnce({
      data: { is_admin: true, account_deleting_at: "2026-07-14T00:00:00.000Z" },
      error: null,
    });
    mocks.createServiceClient.mockReturnValueOnce({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: mocks.profileSingle })),
        })),
      })),
    });

    const response = await GET(new Request("http://localhost/api/admin/auth"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ isAdmin: false });
  });

  it("does not treat a failed login profile query as a non-admin result", async () => {
    const sensitiveMessage = "database host=private.internal";
    mocks.createClientFromRequest.mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "admin-1" } } }) },
    });
    mocks.profileSingle.mockResolvedValueOnce({
      data: null,
      error: { message: sensitiveMessage },
    });
    mocks.createServiceClient.mockReturnValueOnce({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: mocks.profileSingle })),
        })),
      })),
    });

    const response = await POST(new Request("http://localhost/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "login",
        setupPassword: process.env.ADMIN_PASSWORD,
      }),
    }));
    const responseText = await response.text();

    expect(response.status).toBe(503);
    expect(responseText).not.toContain(sensitiveMessage);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(sensitiveMessage);
    expect(console.error).toHaveBeenCalledWith(
      "ADMIN_AUTH_PROFILE_LOOKUP_FAILED",
      { context: "login" },
    );
  });

  it("rejects login for an administrator whose deletion has started", async () => {
    mocks.createClientFromRequest.mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "admin-1" } } }) },
    });
    mocks.profileSingle.mockResolvedValueOnce({
      data: { is_admin: true, account_deleting_at: "2026-07-14T00:00:00.000Z" },
      error: null,
    });
    mocks.createServiceClient.mockReturnValueOnce({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: mocks.profileSingle })),
        })),
      })),
    });

    const response = await POST(new Request("http://localhost/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "login",
        setupPassword: process.env.ADMIN_PASSWORD,
      }),
    }));

    expect(response.status).toBe(403);
  });

  it("does not let a deleting administrator create another administrator", async () => {
    mocks.createClientFromRequest.mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "admin-1" } } }) },
    });
    mocks.profileSingle.mockResolvedValueOnce({
      data: { is_admin: true, account_deleting_at: "2026-07-14T00:00:00.000Z" },
      error: null,
    });
    mocks.createServiceClient.mockReturnValueOnce({
      auth: { admin: { createUser: mocks.createUser, deleteUser: mocks.deleteUser } },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: mocks.profileSingle })),
        })),
        upsert: mocks.profileUpsert,
      })),
    });

    const response = await POST(new Request("http://localhost/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create-admin",
        setupPassword: process.env.ADMIN_PASSWORD,
        email: "next-admin@example.com",
        password: "StrongAdmin1!",
      }),
    }));

    expect(response.status).toBe(403);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("counts only active administrators for inventory checks", async () => {
    const response = await GET(new Request(
      "http://localhost/api/admin/auth?check=exists",
    ));

    expect(response.status).toBe(200);
    expect(mocks.profileCountEq).toHaveBeenCalledWith("is_admin", true);
    expect(mocks.profileCount).toHaveBeenCalledWith("account_deleting_at", null);
  });

  it("removes a newly-created auth user when profile creation fails", async () => {
    mocks.profileUpsert.mockResolvedValueOnce({ error: { message: "profile unavailable" } });
    const response = await POST(new Request("http://localhost/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "initial-setup",
        setupPassword: process.env.ADMIN_PASSWORD,
        email: "admin@example.com",
        password: "StrongAdmin1!",
      }),
    }));

    expect(response.status).toBe(503);
    expect(mocks.createUser).toHaveBeenCalledTimes(1);
    expect(mocks.deleteUser).toHaveBeenCalledWith("new-admin");
  });

  it("never permits initial setup in production even if the environment flag is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const response = await POST(new Request("http://localhost/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "initial-setup",
          setupPassword: process.env.ADMIN_PASSWORD,
          email: "admin@example.com",
          password: "StrongAdmin1!",
        }),
      }));

      expect(response.status).toBe(403);
      expect(mocks.createUser).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
