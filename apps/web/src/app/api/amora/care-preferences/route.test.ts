import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { GET, PUT } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "amora-care-preferences:test"),
}));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

const USER_ID = "10000000-0000-4000-8000-000000000001";
const PARTNER_ID = "10000000-0000-4000-8000-000000000002";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const CONSENTED_AT = "2026-11-13T01:00:00.000Z";

type Row = Record<string, unknown>;

const DEFAULT_COUPLE_CADENCE_ROW = {
  intensity: "normal",
  daily_limit: 1,
  window_start_hour: 9,
  window_end_hour: 20,
  window_open: true,
};
const DEFAULT_CADENCE = { intensity: "normal", windowStartHour: 9, windowEndHour: 20 };
const DEFAULT_COUPLE = { ...DEFAULT_CADENCE, dailyLimit: 1, windowOpen: true };

function ownRow(overrides: Row = {}): Row {
  return {
    couple_id: COUPLE_ID,
    care_notifications_enabled: false,
    care_notifications_consented_at: null,
    care_email_enabled: false,
    care_email_consented_at: null,
    care_prompt_answered_at: null,
    ...overrides,
  };
}

function setup(options: {
  user?: Row | null;
  own?: Row;
  partner?: Row | null;
  couple?: Row;
  rpcError?: Row | null;
  coupleCadence?: Row;
  cadenceError?: Row | null;
} = {}) {
  const profileRows = new Map<string, Row | null>([
    [USER_ID, options.own ?? ownRow()],
    [PARTNER_ID, options.partner === undefined ? ownRow() : options.partner],
  ]);
  const reads: string[] = [];
  const from = vi.fn((table: string) => {
    let id: string | null = null;
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((_column: string, value: string) => {
        id = value;
        return builder;
      }),
      maybeSingle: vi.fn(async () => {
        reads.push(`${table}:${id}`);
        if (table === "couples") {
          return {
            data: options.couple ?? { bride_id: USER_ID, groom_id: PARTNER_ID },
            error: null,
          };
        }
        return { data: profileRows.get(id ?? "") ?? null, error: null };
      }),
    };
    return builder;
  });
  const rpc = vi.fn(async (name: string, args: Row) => {
    if (name === "amora_care_couple_cadence") {
      return { data: options.coupleCadence ?? DEFAULT_COUPLE_CADENCE_ROW, error: null };
    }
    if (name === "set_amora_care_cadence") {
      return options.cadenceError
        ? { data: null, error: options.cadenceError }
        : { data: { intensity: args.p_intensity ?? "normal" }, error: null };
    }
    if (options.rpcError) return { data: null, error: options.rpcError };
    if (typeof args.p_care_notifications_enabled === "boolean") {
      const enabled = args.p_care_notifications_enabled;
      profileRows.set(USER_ID, {
        ...profileRows.get(USER_ID),
        care_notifications_enabled: enabled,
        care_notifications_consented_at: enabled ? CONSENTED_AT : null,
        ...(enabled ? {} : { care_email_enabled: false, care_email_consented_at: null }),
      });
    }
    if (typeof args.p_care_email_enabled === "boolean") {
      const enabled = args.p_care_email_enabled;
      profileRows.set(USER_ID, {
        ...profileRows.get(USER_ID),
        care_email_enabled: enabled,
        care_email_consented_at: enabled ? CONSENTED_AT : null,
      });
    }
    if (args.p_care_prompt_answered === true) {
      profileRows.set(USER_ID, {
        ...profileRows.get(USER_ID),
        care_prompt_answered_at: CONSENTED_AT,
      });
    }
    return { data: { profile: {} }, error: null };
  });
  vi.mocked(createAdminClient).mockReturnValue({ from, rpc } as never);
  const user = options.user === undefined
    ? { id: USER_ID, email: "amora@example.com", email_confirmed_at: CONSENTED_AT }
    : options.user;
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
  } as never);
  return { from, rpc, reads };
}

function get() {
  return new Request("http://localhost/api/amora/care-preferences");
}

function put(body: unknown) {
  return new Request("http://localhost/api/amora/care-preferences", {
    method: "PUT",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function scheduledCareOn() {
  vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "true");
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("AMORA_CARE_UNSUBSCRIBE_SECRET", "care-unsubscribe-test-secret-0123456789abcdef");
}

describe("/api/amora/care-preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "false");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("AMORA_PROACTIVE_CHAT_ENABLED", "false");
    vi.stubEnv("AMORA_TODAY_ONE_ENABLED", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires a signed-in person", async () => {
    setup({ user: null });
    const response = await GET(get());
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("reports nothing to turn on while every care path is off", async () => {
    setup();
    const response = await GET(get());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: false,
      emailAvailable: false,
      chat: { enabled: false, consentedAt: null },
      email: {
        enabled: false,
        consentedAt: null,
        verified: true,
        maskedAddress: "am***@example.com",
      },
      partner: { connected: true, chatEnabled: false },
      promptAnswered: false,
      cadence: DEFAULT_CADENCE,
      couple: DEFAULT_COUPLE,
    });
  });

  // 10장 P2: 강도·받는 시간
  it("shows the person's cadence and the couple value the delivery uses", async () => {
    setup({
      own: ownRow({ care_intensity: "more", care_window_start_hour: 10, care_window_end_hour: 18 }),
      coupleCadence: {
        intensity: "normal",
        daily_limit: 1,
        window_start_hour: 10,
        window_end_hour: 18,
        window_open: true,
      },
    });
    const body = await (await GET(get())).json();
    expect(body.cadence).toEqual({ intensity: "more", windowStartHour: 10, windowEndHour: 18 });
    expect(body.couple).toEqual({
      intensity: "normal",
      windowStartHour: 10,
      windowEndHour: 18,
      dailyLimit: 1,
      windowOpen: true,
    });
  });

  it("saves intensity and hours through the cadence function, never the consent one", async () => {
    const { rpc } = setup();
    const response = await PUT(put({ intensity: "light" }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("set_amora_care_cadence", {
      p_user_id: USER_ID,
      p_intensity: "light",
      p_window_start_hour: null,
      p_window_end_hour: null,
    });
    expect(rpc).not.toHaveBeenCalledWith("patch_profile_atomic", expect.anything());

    await PUT(put({ windowStartHour: 10, windowEndHour: 18 }));
    expect(rpc).toHaveBeenCalledWith("set_amora_care_cadence", {
      p_user_id: USER_ID,
      p_intensity: null,
      p_window_start_hour: 10,
      p_window_end_hour: 18,
    });
  });

  it("rejects cadence outside 9 to 20, backwards hours, and cadence mixed with consent", async () => {
    const { rpc } = setup();
    for (const body of [
      { intensity: "often" },
      { windowStartHour: 8 },
      { windowEndHour: 21 },
      { windowStartHour: 15, windowEndHour: 12 },
      { windowStartHour: 9.5 },
      { chat: true, intensity: "more" },
    ]) {
      expect((await PUT(put(body))).status, JSON.stringify(body)).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("explains a start hour that would pass the saved end hour", async () => {
    setup({ cadenceError: { code: "22023", message: "AMORA_CARE_CADENCE_WINDOW_INVALID" } });
    const response = await PUT(put({ windowStartHour: 19 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "CARE_WINDOW_INVALID" });
  });

  it("does not treat the scheduled path as runnable without the mail provider key", async () => {
    // Each condition alone must block: switch on, secret set, provider key missing ...
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "true");
    vi.stubEnv("AMORA_CARE_UNSUBSCRIBE_SECRET", "care-unsubscribe-test-secret-0123456789abcdef");
    setup();
    const body = await (await GET(get())).json();
    expect(body).toMatchObject({ available: false, emailAvailable: false });

    // ... and switch on, provider key set, unsubscribe secret missing (10장 P2.7).
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("AMORA_CARE_UNSUBSCRIBE_SECRET", "");
    const noSecret = await (await GET(get())).json();
    expect(noSecret).toMatchObject({ available: false, emailAvailable: false });

    scheduledCareOn();
    const runnable = await (await GET(get())).json();
    expect(runnable).toMatchObject({ available: true, emailAvailable: true });
  });

  it("shows the partner's shared-chat choice and never the partner's email choice", async () => {
    vi.stubEnv("AMORA_PROACTIVE_CHAT_ENABLED", "true");
    setup({
      own: ownRow({
        care_notifications_enabled: true,
        care_notifications_consented_at: CONSENTED_AT,
        care_prompt_answered_at: CONSENTED_AT,
      }),
      partner: {
        care_notifications_enabled: true,
        care_notifications_consented_at: CONSENTED_AT,
        care_email_enabled: true,
        care_email_consented_at: CONSENTED_AT,
      },
    });
    const body = await (await GET(get())).json();
    expect(body).toMatchObject({
      available: true,
      emailAvailable: false,
      chat: { enabled: true, consentedAt: CONSENTED_AT },
      partner: { connected: true, chatEnabled: true },
      promptAnswered: true,
    });
    expect(JSON.stringify(body.partner)).not.toContain("email");
  });

  it("does not read a partner when the profile points at a couple without this person", async () => {
    vi.stubEnv("AMORA_PROACTIVE_CHAT_ENABLED", "true");
    const { reads } = setup({ couple: { bride_id: PARTNER_ID, groom_id: null } });
    const response = await GET(get());
    expect(response.status).toBe(503);
    expect(reads).not.toContain(`profiles:${PARTNER_ID}`);
  });

  it("turns the shared-chat message on and records the lounge question as answered", async () => {
    vi.stubEnv("AMORA_PROACTIVE_CHAT_ENABLED", "true");
    const { rpc } = setup();
    const response = await PUT(put({ chat: true }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("patch_profile_atomic", {
      p_user_id: USER_ID,
      p_care_notifications_enabled: true,
      p_care_email_enabled: null,
      p_care_prompt_answered: true,
    });
    expect(await response.json()).toMatchObject({
      chat: { enabled: true, consentedAt: CONSENTED_AT },
      promptAnswered: true,
    });
  });

  it("records a declined lounge question without changing consent", async () => {
    vi.stubEnv("AMORA_PROACTIVE_CHAT_ENABLED", "true");
    const { rpc } = setup();
    const response = await PUT(put({ promptAnswered: true }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("patch_profile_atomic", {
      p_user_id: USER_ID,
      p_care_notifications_enabled: null,
      p_care_email_enabled: null,
      p_care_prompt_answered: true,
    });
  });

  it("refuses to turn anything on that cannot run today", async () => {
    const { rpc } = setup();
    const chat = await PUT(put({ chat: true }));
    expect(chat.status).toBe(409);
    expect(await chat.json()).toMatchObject({ code: "CARE_CHAT_UNAVAILABLE" });

    vi.stubEnv("AMORA_PROACTIVE_CHAT_ENABLED", "true");
    const email = await PUT(put({ chat: true, email: true }));
    expect(email.status).toBe(409);
    expect(await email.json()).toMatchObject({ code: "CARE_EMAIL_UNAVAILABLE" });
    expect(rpc).not.toHaveBeenCalledWith("patch_profile_atomic", expect.anything());
  });

  it("asks for a confirmed signup email and the shared-chat message before email", async () => {
    scheduledCareOn();
    const unverified = setup({ user: { id: USER_ID, email: "amora@example.com", email_confirmed_at: null } });
    const first = await PUT(put({ chat: true, email: true }));
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ code: "CARE_EMAIL_UNVERIFIED" });
    expect(unverified.rpc).not.toHaveBeenCalledWith("patch_profile_atomic", expect.anything());

    const chatOff = setup();
    const second = await PUT(put({ email: true }));
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "CARE_EMAIL_REQUIRES_CHAT" });
    expect(chatOff.rpc).not.toHaveBeenCalledWith("patch_profile_atomic", expect.anything());
  });

  it("turns email on together with the shared-chat message", async () => {
    scheduledCareOn();
    const { rpc } = setup();
    const response = await PUT(put({ chat: true, email: true }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("patch_profile_atomic", {
      p_user_id: USER_ID,
      p_care_notifications_enabled: true,
      p_care_email_enabled: true,
      p_care_prompt_answered: true,
    });
    expect(await response.json()).toMatchObject({
      chat: { enabled: true },
      email: { enabled: true, consentedAt: CONSENTED_AT },
    });
  });

  it("always lets a person turn things off, even when the paths are switched off", async () => {
    const { rpc } = setup({
      own: ownRow({
        care_notifications_enabled: true,
        care_notifications_consented_at: CONSENTED_AT,
      }),
    });
    const response = await PUT(put({ chat: false }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("patch_profile_atomic", expect.objectContaining({
      p_care_notifications_enabled: false,
    }));
  });

  it("rejects malformed and contradictory requests before touching the database", async () => {
    const { rpc } = setup();
    for (const body of [
      {},
      { chat: "yes" },
      { email: true, chat: false },
      { chat: true, extra: 1 },
      { promptAnswered: false },
      "not json",
    ]) {
      const response = await PUT(put(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a cross-site write", async () => {
    vi.mocked(isTrustedMutationRequest).mockReturnValue(false);
    const { rpc } = setup();
    const response = await PUT(put({ chat: false }));
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps the database's email rule to the same message instead of a generic failure", async () => {
    scheduledCareOn();
    setup({
      own: ownRow({
        care_notifications_enabled: true,
        care_notifications_consented_at: CONSENTED_AT,
      }),
      rpcError: { code: "22023", message: "PROFILE_PATCH_CARE_EMAIL_REQUIRES_SHARED_CONSENT" },
    });
    const response = await PUT(put({ email: true }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CARE_EMAIL_REQUIRES_CHAT" });
  });
});
