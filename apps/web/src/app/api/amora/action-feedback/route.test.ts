import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import {
  HANBANG_EXPECTED_ACTOR_USER_ID_HEADER,
  HANBANG_MUTATION_CONTRACT_VERSION,
  HANBANG_MUTATION_CONTRACT_VERSION_HEADER,
} from "@hanbang/shared";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isAmoraTodayOneEnabled } from "@/lib/features/amoraCareFlags";
import { checkRateLimit } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { GET } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/features/amoraCareFlags", () => ({
  isAmoraTodayOneEnabled: vi.fn(() => true),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "amora-action-feedback:test"),
}));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ID = "10000000-0000-4000-8000-000000000002";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";

const readyResponse = {
  version: 1,
  state: "ready",
  recipientUserId: OWNER_ID,
  coupleId: COUPLE_ID,
  feedback: {
    outcomeId: "30000000-0000-4000-8000-000000000001",
    actionId: "act_guest_list_draft",
    actionTitle: "Draft the first guest list",
    sourceRevision: 3,
    actionRevision: 3,
    actionStatus: "open",
    outcome: "blocked",
    blockerCode: "partner_check",
    recordedAt: "2026-08-15T02:00:00.000Z",
    validUntil: "2026-08-16T02:00:00.000Z",
  },
};

function query(data: unknown, error: unknown = null) {
  const builder = { select: vi.fn(), eq: vi.fn(), single: vi.fn() };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.single.mockResolvedValue({ data, error });
  return builder;
}

function installClient() {
  const profile = query({ couple_id: COUPLE_ID, role: "bride" });
  const couple = query({ bride_id: OWNER_ID, groom_id: OTHER_ID });
  const rpc = vi.fn().mockResolvedValue({ data: 5, error: null });
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: OWNER_ID } } }),
    },
    from: vi.fn((name: string) => name === "profiles" ? profile : couple),
    rpc,
  };
  vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
  return client;
}

function request(actor = OWNER_ID, suffix = "") {
  return new Request(`http://localhost/api/amora/action-feedback${suffix}`, {
    headers: {
      "sec-fetch-site": "same-origin",
      [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
      [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: actor,
    },
  });
}

describe("GET /api/amora/action-feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T03:00:00.000Z"));
    vi.mocked(isAmoraTodayOneEnabled).mockReturnValue(true);
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue(null);
    installClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns only an exact owner-and-couple-bound fresh result without caching", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: readyResponse, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toContain("Authorization");
    await expect(response.json()).resolves.toEqual(readyResponse);
    expect(rpc).toHaveBeenCalledWith(
      "read_own_amora_action_outcome_feedback_v1",
      {
        p_couple_id: COUPLE_ID,
        p_recipient_user_id: OWNER_ID,
        p_expected_privacy_epoch: 5,
      },
    );
  });

  it("rejects disabled, untrusted, or parameterized reads before authentication", async () => {
    vi.mocked(isAmoraTodayOneEnabled).mockReturnValue(false);
    const disabled = await GET(request());
    expect(disabled.status).toBe(404);

    vi.mocked(isAmoraTodayOneEnabled).mockReturnValue(true);
    vi.mocked(isTrustedMutationRequest).mockReturnValue(false);
    const untrusted = await GET(request());
    expect(untrusted.status).toBe(403);

    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    const parameterized = await GET(request(OWNER_ID, "?actionId=foreign"));
    expect(parameterized.status).toBe(400);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    for (const response of [disabled, untrusted, parameterized]) {
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
  });

  it("rejects account switching before any service-role read", async () => {
    const rpc = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await GET(request(OTHER_ID));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "MUTATION_ACTOR_CHANGED",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when authentication, roster, or privacy context is unavailable", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never);
    const unauthenticated = await GET(request());
    expect(unauthenticated.status).toBe(401);

    const profile = query({ couple_id: COUPLE_ID, role: "bride" });
    const wrongRoster = query({ bride_id: OTHER_ID, groom_id: null });
    vi.mocked(createClientFromRequest).mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: OWNER_ID } } }),
      },
      from: vi.fn((name: string) => name === "profiles" ? profile : wrongRoster),
      rpc: vi.fn(),
    } as never);
    const rosterChanged = await GET(request());
    expect(rosterChanged.status).toBe(409);

    const privacyFailure = installClient();
    privacyFailure.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST" } });
    const privacyUnavailable = await GET(request());
    expect(privacyUnavailable.status).toBe(503);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("keeps rate-limit responses private and stops before the service RPC", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(NextResponse.json(
      { code: "RATE_LIMITED" },
      { status: 429 },
    ));
    const rpc = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await GET(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toContain("Authorization");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "PGRST202", message: "function read_own_amora_action_outcome_feedback_v1 does not exist" }, 404, "AMORA_ACTION_FEEDBACK_UNAVAILABLE"],
    [{ code: "40001", message: "AMORA_ACTION_OUTCOME_FEEDBACK_PRIVACY_STALE" }, 409, "AMORA_ACTION_FEEDBACK_CONTEXT_CHANGED"],
    [{ code: "XX000", message: "internal" }, 503, "AMORA_ACTION_FEEDBACK_READ_FAILED"],
  ])("maps a bounded service RPC failure", async (error, status, code) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await GET(request());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ code });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each([
    { ...readyResponse, recipientUserId: OTHER_ID },
    { ...readyResponse, coupleId: "20000000-0000-4000-8000-000000000002" },
    { ...readyResponse, unexpected: true },
    {
      ...readyResponse,
      feedback: {
        ...readyResponse.feedback,
        validUntil: "2026-08-15T02:59:59.999Z",
      },
    },
  ])("rejects an invalid, foreign, or expired RPC response", async (data) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "AMORA_ACTION_FEEDBACK_INVALID_RESPONSE",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns the exact owner-bound none state without inventing feedback", async () => {
    const none = {
      version: 1,
      state: "none",
      recipientUserId: OWNER_ID,
      coupleId: COUPLE_ID,
    };
    const rpc = vi.fn().mockResolvedValue({ data: none, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(none);
  });
});
