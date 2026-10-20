// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COUPLE_ID = "22222222-2222-4222-8222-222222222222";
const PRIVATE_TEXT = "비공개 가족 예산 고민 person@example.com 010-1234-5678";
const REASON = "AMORA_MANUAL_SCHEDULE_APPROVAL_REQUIRED";
const SCOPE = "Couple plan-change RPC failed:";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), capture: vi.fn() }));

vi.mock("@sentry/nextjs", () => ({ captureException: mocks.capture }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: table === "wedding_journeys" ? { progress: {}, state_revision: 7 } : { couple_id: COUPLE_ID }, error: null }) }),
      }),
    }),
  }),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: async () => null,
  rateLimitKey: () => "journey:test",
}));

function request() {
  return new Request("http://localhost/api/journey", {
    method: "PATCH",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({
      expected_revision: 7,
      expected_couple_id: COUPLE_ID,
      progress_patch: { __events: [{ title: PRIVATE_TEXT, date: "2026-09-14", time: "19:45" }] },
      progress_remove_keys: [],
    }),
  });
}

describe("journey RPC diagnostic privacy through the real production logger", () => {
  let consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function failure(error: unknown, sqlstate: string, reason: string) {
    mocks.rpc.mockResolvedValue({ data: null, error });
    const { PATCH } = await import("../route");
    const response = await PATCH(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "변경 요청의 저장 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.",
      code: "PLAN_CHANGE_UNAVAILABLE",
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    const captured: unknown = mocks.capture.mock.calls[0]?.[0];
    if (!(captured instanceof Error)) throw new Error("Expected a safe diagnostic Error");
    expect(captured.message).toBe(`Journey plan-change RPC failed [sqlstate=${sqlstate}; reason=${reason}]`);
    expect(consoleError.mock.calls[0]).toEqual([SCOPE, captured]);
    expect(mocks.capture.mock.calls[0]).toEqual([captured, { tags: { log_scope: SCOPE } }]);
    expect(Object.hasOwn(captured, "cause")).toBe(false);
    const recorded = `${captured.message} ${captured.stack} ${JSON.stringify(mocks.capture.mock.calls)}`;
    for (const privateValue of [PRIVATE_TEXT, USER_ID, COUPLE_ID, "secret-token", "private-hint", "private-details"]) {
      expect(recorded).not.toContain(privateValue);
    }
    return captured;
  }

  it.each([
    ["42501", REASON],
    ["55000", "AMORA_MANUAL_PLAN_REQUEST_IMMUTABLE"],
    ["22023", "AMORA_MANUAL_SCHEDULE_MIXED_DELTA_DENIED"],
    ["55000", "AMORA_MANUAL_DECISION_ACCEPTANCES_INVALID"],
    ["42501", "BOOKING_PROJECTION_WRITE_NOT_AUTHORIZED"],
    ["55000", "AMORA_SHARED_SCHEDULE_DELTA_INVALID"],
  ])("preserves fixed diagnostics %s / %s without source payload", async (code, message) => {
    await failure({ code, message, details: `private-details ${PRIVATE_TEXT}`, hint: "private-hint", user_id: USER_ID, token: "secret-token" }, code, message);
  });

  it.each(["23514", "23505", "42P01", "57014", "P0001"])("preserves SQLSTATE %s while discarding an arbitrary database message", async code => {
    await failure({ code, message: PRIVATE_TEXT, details: "private-details" }, code, "unknown");
  });

  it.each([null, 42501, "", "4250", "425010", "42p01", "42501\n", "PGRST202", "person@example.com", "secret-token"])("does not treat malformed code %s as SQLSTATE", async code => {
    await failure({ code, message: PRIVATE_TEXT }, "unknown", "unknown");
  });

  it.each([
    `${REASON}: ${PRIVATE_TEXT}`,
    `${PRIVATE_TEXT} ${REASON}`,
    `${REASON}\n`,
    "AMORA_MANUAL_SCHEDULE_NEW_UNREVIEWED_REASON",
    "PRIVATE_CUSTOMER_TEXT",
  ])("does not extract a reason from untrusted free text (%s)", async message => {
    const captured = await failure({ code: "55000", message, details: REASON, hint: REASON }, "55000", "unknown");
    expect(captured.message).not.toContain(REASON);
  });

  it("reconstructs an Error instead of forwarding its original stack, fields or cause", async () => {
    const error = Object.assign(new Error(PRIVATE_TEXT, { cause: "secret-token" }), {
      code: "55000", details: "private-details", hint: "private-hint",
      stack: `private stack ${PRIVATE_TEXT} ${USER_ID}`,
    });
    const captured = await failure(error, "55000", "unknown");
    expect(captured).not.toBe(error);
  });

  it("keeps an existing client conflict response and does not log it as infrastructure failure", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "COUPLE_PLAN_CHANGE_CONFLICT" } });
    const { PATCH } = await import("../route");
    const response = await PATCH(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "PLAN_CHANGE_CONFLICT" });
    expect(consoleError).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
