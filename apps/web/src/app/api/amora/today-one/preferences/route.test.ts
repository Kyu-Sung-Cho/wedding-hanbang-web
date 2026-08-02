import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClientFromRequest } from "@/lib/supabase/server";
import { isAmoraTodayOneEnabled } from "@/lib/features/amoraCareFlags";
import { checkRateLimit } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { GET, PUT } from "./route";

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
    body: JSON.stringify({ mode }),
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
