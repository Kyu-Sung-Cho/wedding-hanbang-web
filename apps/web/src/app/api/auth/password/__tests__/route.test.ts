// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HANBANG_EXPECTED_ACTOR_USER_ID_HEADER,
  HANBANG_MUTATION_CONTRACT_VERSION,
  HANBANG_MUTATION_CONTRACT_VERSION_HEADER,
} from "@hanbang/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { PATCH } from "../route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "auth:password:test"),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";

function passwordRequest(headers: HeadersInit = {}) {
  return new Request("http://localhost/api/auth/password", {
    method: "PATCH",
    headers: {
      Authorization: "Bearer test.user.access-token",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ password: "new-password-123" }),
  });
}

describe("/api/auth/password PATCH", () => {
  const authFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
    authFetch.mockResolvedValue(new Response(JSON.stringify({ id: USER_ID }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", authFetch);
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
      },
    } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("rejects a password form owned by another account before changing credentials", async () => {
    const response = await PATCH(passwordRequest({
      [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
      [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: OTHER_USER_ID,
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "MUTATION_ACTOR_CHANGED",
    });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(authFetch).not.toHaveBeenCalled();
  });

  it("rejects a headerless password mutation before changing credentials", async () => {
    const response = await PATCH(passwordRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "MUTATION_ACTOR_CONTRACT_INVALID",
    });
    expect(authFetch).not.toHaveBeenCalled();
  });

  it("uses the request-bound user token and never service-role admin auth", async () => {
    const response = await PATCH(passwordRequest({
      [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
      [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: USER_ID,
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ success: true });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(authFetch).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/user",
      expect.objectContaining({
        method: "PUT",
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer test.user.access-token",
          apikey: "test-anon-key",
        }),
        body: JSON.stringify({ password: "new-password-123" }),
      }),
    );
  });

  it("fails closed without the request-bound bearer even when cookies authenticate", async () => {
    const response = await PATCH(passwordRequest({
      Authorization: "",
      [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
      [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: USER_ID,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "PASSWORD_BEARER_REQUIRED",
    });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(authFetch).not.toHaveBeenCalled();
  });

  it("preserves Supabase secure-password reauthentication failures", async () => {
    authFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      code: "reauth_nonce_missing",
      message: "Reauthentication nonce is required",
    }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    }));

    const response = await PATCH(passwordRequest({
      [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
      [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: USER_ID,
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "PASSWORD_REAUTH_REQUIRED",
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
