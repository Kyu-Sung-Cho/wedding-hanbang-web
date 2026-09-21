import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClientFromRequest } from "@/lib/supabase/server";
import { isAmoraTodayOneEnabled } from "@/lib/features/amoraCareFlags";
import { checkRateLimit } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { GET, PUT } from "./route";

const transport = vi.hoisted(() => ({ createServerClient: vi.fn(), cookies: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: transport.createServerClient }));
vi.mock("next/headers", () => ({ cookies: transport.cookies }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/features/amoraCareFlags", () => ({
  isAmoraTodayOneEnabled: vi.fn(() => true),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "amora-today-one-preferences:test"),
}));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

const USER_ID = "10000000-0000-4000-8000-000000000001";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";

function query(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  return builder;
}

function makeClient(options?: {
  userId?: string | null;
  preference?: Record<string, unknown> | null;
  rpcResult?: { data: unknown; error: unknown };
}) {
  const preference = Object.prototype.hasOwnProperty.call(options ?? {}, "preference")
    ? options?.preference ?? null
    : null;
  const tables = {
    profiles: query({ data: { couple_id: COUPLE_ID, role: "bride" }, error: null }),
    couples: query({ data: { bride_id: USER_ID, groom_id: null }, error: null }),
    amora_today_one_preferences: query({ data: preference, error: null }),
  };
  const from = vi.fn((name: keyof typeof tables) => tables[name]);
  const rpc = vi.fn().mockResolvedValue(options?.rpcResult ?? {
    data: {
      enabled: true,
      optedInAt: "2026-08-02T03:00:00.000Z",
      pausedUntil: null,
      dailyLimit: 1,
    },
    error: null,
  });
  return {
    client: {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: options?.userId === null ? null : { id: options?.userId ?? USER_ID } },
        }),
      },
      from,
      rpc,
    },
    from,
    rpc,
  };
}

function put(mode: string) {
  return new Request("http://localhost/api/amora/today-one/preferences", {
    method: "PUT",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ mode, expectedOwnerId: USER_ID }),
  });
}

describe("/api/amora/today-one/preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAmoraTodayOneEnabled).mockReturnValue(true);
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue(null);
  });

  it("returns unavailable while the exact-true rollout flag is off", async () => {
    const { client, from } = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    vi.mocked(isAmoraTodayOneEnabled).mockReturnValue(false);

    const response = await GET(new Request("http://localhost/api/amora/today-one/preferences"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toEqual({ available: false });
    expect(from).not.toHaveBeenCalled();
  });

  it("keeps a missing preference explicitly off without creating a row", async () => {
    const { client, rpc } = makeClient({ preference: null });
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);

    const response = await GET(new Request("http://localhost/api/amora/today-one/preferences"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: true,
      ownerId: USER_ID,
      preference: {
        enabled: false,
        optedInAt: null,
        pausedUntil: null,
        dailyLimit: 1,
      },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("derives a 24-hour pause on the server and confirms the owner RPC result", async () => {
    vi.setSystemTime(new Date("2026-08-02T03:00:00.000Z"));
    const pausedUntil = "2026-08-03T03:00:00.000Z";
    const { client, rpc } = makeClient({
      preference: {
        enabled: true,
        opted_in_at: "2026-08-01T00:00:00.000Z",
        paused_until: null,
        daily_limit: 1,
      },
      rpcResult: {
        data: {
          enabled: true,
          optedInAt: "2026-08-01T00:00:00.000Z",
          pausedUntil,
          dailyLimit: 1,
        },
        error: null,
      },
    });
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);

    const response = await PUT(put("pause_24h"));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("set_amora_today_one_preference", {
      p_enabled: true,
      p_paused_until: pausedUntil,
    });
    expect(await response.json()).toMatchObject({
      available: true,
      preference: { enabled: true, pausedUntil },
    });
  });

  it("maps enable and disable to the authenticated preference RPC", async () => {
    const enabled = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(enabled.client as never);
    expect((await PUT(put("enable"))).status).toBe(200);
    expect(enabled.rpc).toHaveBeenCalledWith("set_amora_today_one_preference", {
      p_enabled: true,
      p_paused_until: null,
    });

    const disabled = makeClient({
      rpcResult: {
        data: { enabled: false, optedInAt: null, pausedUntil: null, dailyLimit: 1 },
        error: null,
      },
    });
    vi.mocked(createClientFromRequest).mockResolvedValue(disabled.client as never);
    expect((await PUT(put("disable"))).status).toBe(200);
    expect(disabled.rpc).toHaveBeenCalledWith("set_amora_today_one_preference", {
      p_enabled: false,
      p_paused_until: null,
    });
  });

  it("rejects untrusted, unknown, and pause-from-off mutations", async () => {
    const { client, rpc } = makeClient({ preference: null });
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    vi.mocked(isTrustedMutationRequest).mockReturnValueOnce(false);
    expect((await PUT(put("enable"))).status).toBe(403);

    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    expect((await PUT(put("forever"))).status).toBe(400);
    const pause = await PUT(put("pause_24h"));
    expect(pause.status).toBe(409);
    expect(await pause.json()).toMatchObject({ code: "TODAY_ONE_NOT_ENABLED" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("TodayOne legacy bearer compatibility through the request authentication boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    transport.createServerClient.mockReset();
    transport.cookies.mockReset();
    const server = await vi.importActual<typeof import("@/lib/supabase/server")>("@/lib/supabase/server");
    const trust = await vi.importActual<typeof import("@/utils/trustedMutation")>("@/utils/trustedMutation");
    vi.mocked(createClientFromRequest).mockImplementation(server.createClientFromRequest);
    vi.mocked(isTrustedMutationRequest).mockImplementation(trust.isTrustedMutationRequest);
    vi.mocked(isAmoraTodayOneEnabled).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue(null);
  });

  it("allows an owner-less legacy request only for its verified bearer, never the other cookie account", async () => {
    const bearer = makeClient();
    const cookie = makeClient({ userId: "10000000-0000-4000-8000-000000000002" });
    transport.cookies.mockResolvedValue({ getAll: () => [{ name: "sb-session", value: "cookie-account" }], set: vi.fn() });
    transport.createServerClient.mockImplementation((_url, _key, options) =>
      options.global?.headers.Authorization === "Bearer verified-a" && options.cookies.getAll().length === 0
        ? bearer.client : cookie.client);

    const response = await PUT(new Request("https://hanbang.ai/api/amora/today-one/preferences", {
      method: "PUT", headers: { authorization: "Bearer verified-a", cookie: "sb-session=cookie-account", "content-type": "application/json" },
      body: JSON.stringify({ mode: "enable" }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ownerId: USER_ID, preference: { enabled: true } });
    expect(bearer.client.auth.getUser).toHaveBeenCalledOnce();
    expect(bearer.rpc).toHaveBeenCalledOnce();
    expect(cookie.rpc).not.toHaveBeenCalled();
    expect(transport.cookies).not.toHaveBeenCalled();
  });

  it("rejects a bearer verification error even if the SDK also supplies an apparent user", async () => {
    const bearer = makeClient();
    bearer.client.auth.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: { message: "private verification detail" } });
    transport.createServerClient.mockReturnValue(bearer.client);
    const response = await PUT(new Request("https://hanbang.ai/api/amora/today-one/preferences", {
      method: "PUT", headers: { authorization: "Bearer unverified-a", cookie: "sb-session=cookie-account" },
      body: JSON.stringify({ mode: "enable" }),
    }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "TODAY_ONE_AUTH_REQUIRED" });
    expect(bearer.rpc).not.toHaveBeenCalled();
    expect(bearer.from).not.toHaveBeenCalled();
    expect(transport.cookies).not.toHaveBeenCalled();
  });

  it("explains the missing browser owner contract without guessing the current cookie account", async () => {
    const cookie = makeClient();
    transport.createServerClient.mockReturnValue(cookie.client);
    const response = await PUT(new Request("https://hanbang.ai/api/amora/today-one/preferences", {
      method: "PUT", headers: { "sec-fetch-site": "same-origin", cookie: "sb-session=cookie-account" },
      body: JSON.stringify({ mode: "disable" }),
    }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ code: "TODAY_ONE_OWNER_CHANGED", reason: "owner_required" });
    expect(body.error).toContain("앱을 업데이트");
    expect(body.error).toContain("https://hanbang.ai/settings");
    expect(body.error).toContain("같은 계정");
    expect(cookie.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [null, "owner_invalid"], ["invalid-private-owner", "owner_invalid"],
    ["10000000-0000-4000-8000-000000000002", "owner_changed"],
  ])("never treats explicit owner %j as the legacy omission", async (expectedOwnerId, reason) => {
    const bearer = makeClient();
    transport.createServerClient.mockReturnValue(bearer.client);
    const response = await PUT(new Request("https://hanbang.ai/api/amora/today-one/preferences", {
      method: "PUT", headers: { authorization: "Bearer verified-a" },
      body: JSON.stringify({ mode: "enable", expectedOwnerId }),
    }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ code: "TODAY_ONE_OWNER_CHANGED", reason });
    expect(JSON.stringify(body)).not.toContain(String(expectedOwnerId));
    expect(bearer.rpc).not.toHaveBeenCalled();
  });

  it.each(["enable", "disable", "pause_24h"])("preserves the legacy bearer %s operation", async mode => {
    const enabled = mode !== "disable";
    const pausedUntil = mode === "pause_24h" ? new Date(Date.now() + 86_400_000).toISOString() : null;
    const bearer = makeClient({
      preference: { enabled: true, opted_in_at: "2026-08-01T00:00:00.000Z", paused_until: null, daily_limit: 1 },
      rpcResult: { data: { enabled, optedInAt: enabled ? "2026-08-01T00:00:00.000Z" : null, pausedUntil, dailyLimit: 1 }, error: null },
    });
    transport.createServerClient.mockReturnValue(bearer.client);
    const response = await PUT(new Request("https://hanbang.ai/api/amora/today-one/preferences", {
      method: "PUT", headers: { authorization: "bearer verified-a" }, body: JSON.stringify({ mode }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ownerId: USER_ID, preference: { enabled, pausedUntil } });
    expect(bearer.rpc).toHaveBeenCalledWith("set_amora_today_one_preference", { p_enabled: enabled, p_paused_until: pausedUntil });
    expect(transport.cookies).not.toHaveBeenCalled();
  });

  it.each(["Basic fake", "Bearer", "Bearer  fake", "Bearer fake extra", "Bearer a, Bearer b"])("never inherits cookie authority from malformed Authorization %s", async authorization => {
    const cookie = makeClient();
    transport.createServerClient.mockReturnValue(cookie.client);
    const response = await PUT(new Request("https://hanbang.ai/api/amora/today-one/preferences", {
      method: "PUT", headers: { authorization, cookie: "sb-session=cookie-account", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ mode: "enable" }),
    }));
    expect(response.status).toBe(403);
    expect(cookie.rpc).not.toHaveBeenCalled();
    expect(transport.cookies).not.toHaveBeenCalled();
  });

  it("does not accept a syntactically valid but unauthenticated bearer beside a valid cookie", async () => {
    const anonymous = makeClient({ userId: null });
    transport.createServerClient.mockReturnValue(anonymous.client);
    const response = await PUT(new Request("https://hanbang.ai/api/amora/today-one/preferences", {
      method: "PUT", headers: { authorization: "Bearer forged-token", cookie: "sb-session=cookie-account" },
      body: JSON.stringify({ mode: "disable" }),
    }));
    expect(response.status).toBe(401);
    expect(anonymous.client.auth.getUser).toHaveBeenCalledOnce();
    expect(anonymous.rpc).not.toHaveBeenCalled();
    expect(transport.cookies).not.toHaveBeenCalled();
  });

  it.each([true, false])("uses the actual Supabase SDK to verify the bearer, without inheriting cookies (accepted=%s)", async accepted => {
    const sdk = await vi.importActual<typeof import("@supabase/ssr")>("@supabase/ssr");
    transport.createServerClient.mockImplementation(sdk.createServerClient);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-auth.invalid");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-public-key");
    const requests: { path: string; authorization: string | null; cookie: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.origin !== "https://synthetic-auth.invalid") throw new Error("Unexpected test destination");
      requests.push({ path: url.pathname, authorization: request.headers.get("authorization"), cookie: request.headers.get("cookie") });
      if (url.pathname === "/auth/v1/user") {
        return Response.json(accepted
          ? { id: USER_ID, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-08-01T00:00:00.000Z" }
          : { message: "synthetic token rejected", code: "bad_jwt" }, { status: accepted ? 200 : 401 });
      }
      if (!accepted) throw new Error("Unauthenticated request reached the database");
      if (url.pathname === "/rest/v1/profiles") return Response.json({ couple_id: COUPLE_ID, role: "bride" });
      if (url.pathname === "/rest/v1/couples") return Response.json({ bride_id: USER_ID, groom_id: null });
      if (url.pathname === "/rest/v1/rpc/set_amora_today_one_preference") {
        expect(await request.json()).toEqual({ p_enabled: false, p_paused_until: null });
        return Response.json({ enabled: false, optedInAt: null, pausedUntil: null, dailyLimit: 1 });
      }
      throw new Error("Unexpected test operation");
    }));
    const response = await PUT(new Request("https://hanbang.ai/api/amora/today-one/preferences", {
      method: "PUT", headers: { authorization: "Bearer issued-token", cookie: "sb-session=other-account" },
      body: JSON.stringify({ mode: "disable" }),
    }));
    expect(response.status).toBe(accepted ? 200 : 401);
    expect(requests.map(request => request.path)).toEqual(accepted
      ? ["/auth/v1/user", "/rest/v1/profiles", "/rest/v1/couples", "/rest/v1/rpc/set_amora_today_one_preference"]
      : ["/auth/v1/user"]);
    for (const request of requests) {
      expect(request.authorization).toBe("Bearer issued-token");
      expect(request.cookie).toBeNull();
    }
    expect(transport.cookies).not.toHaveBeenCalled();
  });
});
