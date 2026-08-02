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

import { DELETE, GET, POST } from "./route";
import { ADMIN_STEP_UP_COOKIE, createAdminStepUpToken } from "@/lib/auth/adminStepUp";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";

describe("admin auth shared rate-limit boundary", () => {
  function expectPrivateResponse(response: Response) {
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("Vary")).toBe("Cookie, Authorization");
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    vi.stubEnv("ADMIN_PASSWORD", "admin-bootstrap-secret-longer-than-32-characters");
    vi.stubEnv("VERCEL_ENV", "preview");
  });

  it("fails closed before reading admin state when the shared limiter blocks", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValue(
      new Response(JSON.stringify({ error: "limited" }), { status: 429 }),
    );

    const response = await GET(new Request("https://hanbang.ai/api/admin/auth?check=exists"));

    expect(response.status).toBe(429);
    expectPrivateResponse(response);
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
    expectPrivateResponse(response);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledTimes(1);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("charges the ingress bucket before rejecting an unknown action", async () => {
    const response = await POST(new Request("https://hanbang.ai/api/admin/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "attacker-controlled-bucket",
        setupPassword: "admin-bootstrap-secret-longer-than-32-characters",
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledTimes(1);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "admin-auth:ingress:pseudonymous-test-key",
      { maxRequests: 20, windowMs: 10 * 60 * 1000 },
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("charges the ingress bucket before rejecting an oversized body", async () => {
    const response = await POST(new Request("https://hanbang.ai/api/admin/auth", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(16 * 1024 + 1),
      },
      body: "{}",
    }));

    expect(response.status).toBe(413);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledTimes(1);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("uses one shared secret-attempt bucket for every allowed action", async () => {
    mocks.checkRateLimitPersistent.mockImplementation(async (key: string) =>
      key.startsWith("admin-auth:secret:")
        ? new Response(JSON.stringify({ error: "limited" }), { status: 429 })
        : null);

    for (const action of ["login", "initial-setup", "create-admin"]) {
      const response = await POST(new Request("https://hanbang.ai/api/admin/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, setupPassword: "wrong" }),
      }));
      expect(response.status).toBe(429);
    }

    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledTimes(6);
    expect(mocks.checkRateLimitPersistent.mock.calls.map(([key]) => key)).toEqual([
      "admin-auth:ingress:pseudonymous-test-key",
      "admin-auth:secret:pseudonymous-test-key",
      "admin-auth:ingress:pseudonymous-test-key",
      "admin-auth:secret:pseudonymous-test-key",
      "admin-auth:ingress:pseudonymous-test-key",
      "admin-auth:secret:pseudonymous-test-key",
    ]);
  });

  it("deletes a newly created Auth user when initial admin profile persistence fails", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    const deleteUser = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "profile write failed" },
    });
    const countEq = vi.fn().mockResolvedValue({ count: 0, error: null });
    const from = vi.fn()
      .mockReturnValueOnce({
        select: vi.fn(() => ({ eq: countEq })),
      })
      ;
    mocks.createAdminClient.mockReturnValue({
      from,
      rpc,
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
    expect(rpc).toHaveBeenCalledWith("bootstrap_initial_admin_profile", {
      p_user_id: "00000000-0000-4000-8000-000000000001",
      p_name: "Admin",
      p_email: "admin@example.com",
    });
  });

  it.each([
    ["initial-setup", "admin_initial_auth_create_failed"],
    ["create-admin", "admin_auth_create_failed"],
  ] as const)(
    "logs only a fixed event and allowlisted code for %s provider failures",
    async (action, expectedEvent) => {
      const providerMessage = "secret provider detail with internal tenant id";
      const providerCode = "internal_tenant_secret";
      const createUser = vi.fn().mockResolvedValue({
        data: { user: null },
        error: {
          name: "AuthApiError",
          code: providerCode,
          status: 500,
          message: providerMessage,
        },
      });
      const countEq = vi.fn().mockResolvedValue({ count: 0, error: null });
      const currentAdminSingle = vi.fn().mockResolvedValue({ data: { is_admin: true } });
      mocks.createAdminClient.mockReturnValue({
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: action === "initial-setup"
              ? countEq
              : vi.fn(() => ({ single: currentAdminSingle })),
          })),
        })),
        auth: { admin: { createUser } },
      });
      mocks.createClientFromRequest.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: "admin-1" } } }),
        },
      });
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

      try {
        const response = await POST(new Request("https://hanbang.ai/api/admin/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action,
            setupPassword: "admin-bootstrap-secret-longer-than-32-characters",
            email: "admin@example.com",
            password: "ValidAdminPass123!",
          }),
        }));

        expect(response.status).toBe(500);
        expect(consoleError).toHaveBeenCalledTimes(1);
        expect(consoleError).toHaveBeenCalledWith(expectedEvent, { code: "unknown" });
        const serializedCalls = JSON.stringify(consoleError.mock.calls);
        expect(serializedCalls).not.toContain(providerMessage);
        expect(serializedCalls).not.toContain(providerCode);
      } finally {
        consoleError.mockRestore();
      }
    },
  );

  it("keeps initial setup closed in production without an explicit one-time gate", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ADMIN_INITIAL_SETUP_ENABLED", "false");
    const createUser = vi.fn();
    mocks.createAdminClient.mockReturnValue({ auth: { admin: { createUser } } });

    const response = await POST(new Request("https://hanbang.ai/api/admin/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "initial-setup",
        setupPassword: "admin-bootstrap-secret-longer-than-32-characters",
        email: "admin@example.com",
        password: "ValidAdminPass123!",
      }),
    }));

    expect(response.status).toBe(403);
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("rejects a weak configured bootstrap secret before reading the request", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "too-short");

    const response = await POST(new Request("https://hanbang.ai/api/admin/auth", {
      method: "POST",
      body: "{}",
    }));

    expect(response.status).toBe(500);
    expectPrivateResponse(response);
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("issues a short-lived HttpOnly step-up cookie only after both admin checks pass", async () => {
    const single = vi.fn().mockResolvedValue({ data: { is_admin: true } });
    const eq = vi.fn(() => ({ single }));
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })),
    });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: ADMIN_ID, email: "admin@example.com" } },
        }),
      },
    });

    const response = await POST(new Request("https://hanbang.ai/api/admin/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "login",
        setupPassword: "admin-bootstrap-secret-longer-than-32-characters",
      }),
    }));

    expect(response.status).toBe(200);
    expectPrivateResponse(response);
    expect(response.headers.get("set-cookie")).toContain(`${ADMIN_STEP_UP_COOKIE}=`);
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(response.headers.get("set-cookie")).toMatch(/SameSite=strict/i);
    expect(response.headers.get("set-cookie")).toMatch(/Path=\/api\/admin/i);
  });

  it("does not treat the Supabase admin role alone as an active admin session", async () => {
    const single = vi.fn().mockResolvedValue({ data: { is_admin: true } });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn(() => ({ select })),
    });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: ADMIN_ID, email: "admin@example.com" } },
        }),
      },
    });

    const response = await GET(new Request("https://hanbang.ai/api/admin/auth"));

    expect(response.status).toBe(200);
    expectPrivateResponse(response);
    await expect(response.json()).resolves.toEqual({
      isAdmin: false,
      email: "admin@example.com",
    });
  });

  it("marks a signed step-up admin identity response private and non-cacheable", async () => {
    const single = vi.fn().mockResolvedValue({ data: { is_admin: true } });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn(() => ({ select })),
    });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: ADMIN_ID, email: "admin@example.com" } },
        }),
      },
    });
    const token = createAdminStepUpToken(ADMIN_ID);

    const response = await GET(new Request("https://hanbang.ai/api/admin/auth", {
      headers: { cookie: `${ADMIN_STEP_UP_COOKIE}=${token}` },
    }));

    expect(response.status).toBe(200);
    expectPrivateResponse(response);
    await expect(response.json()).resolves.toEqual({
      isAdmin: true,
      email: "admin@example.com",
    });
  });

  it("clears the step-up cookie on administrator logout", async () => {
    const response = await DELETE();

    expect(response.status).toBe(200);
    expectPrivateResponse(response);
    expect(response.headers.get("set-cookie")).toContain(`${ADMIN_STEP_UP_COOKIE}=`);
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
    expect(response.headers.get("set-cookie")).toMatch(/Path=\/api\/admin/i);
  });
});
