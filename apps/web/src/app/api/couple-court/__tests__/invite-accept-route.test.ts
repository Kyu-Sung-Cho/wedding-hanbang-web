import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  acceptCourtInviteForUser: vi.fn(),
  rejectCourtInviteForUser: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  rateLimitKey: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/coupleCourt/repository", () => ({
  acceptCourtInviteForUser: mocks.acceptCourtInviteForUser,
  rejectCourtInviteForUser: mocks.rejectCourtInviteForUser,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

import { POST } from "../invites/accept/route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const CASE_ID = "00000000-0000-4000-8000-000000000002";
const INVITE_TOKEN = "CourtInviteToken_abcdefghijklmnopqrstuvwxyz0123456789";
const RATE_LIMIT_OPTIONS = { maxRequests: 20, windowMs: 60 * 60 * 1000 };

function setAuthUser(userId: string | null): void {
  mocks.createClientFromRequest.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  });
}

function mutationRequest(
  body: Record<string, unknown> | string,
  options: { cookie?: string; origin?: string } = {},
): Request {
  const origin = options.origin ?? "https://hanbang.ai";
  const headers = new Headers({
    "Content-Type": "application/json",
    Origin: origin,
    "Sec-Fetch-Site": origin === "https://hanbang.ai" ? "same-origin" : "cross-site",
  });
  if (options.cookie) headers.set("Cookie", options.cookie);
  return new Request("https://hanbang.ai/api/couple-court/invites/accept", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/couple-court/invites/accept", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("COUPLE_COURT_ENABLED", "true");
    vi.stubEnv(
      "COUPLE_COURT_INVITE_COOKIE_SECRET",
      "court-invite-route-test-secret-1234567890",
    );
    setAuthUser(null);
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.rateLimitKey.mockImplementation(
      (prefix: string, _request: Request, userId?: string) => (
        `${prefix}:${userId ?? "anonymous"}`
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prepares an anonymous handoff without accepting or rejecting the invite", async () => {
    const response = await POST(mutationRequest({
      token: INVITE_TOKEN,
      prepare_only: true,
      reject: true,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ prepared: true });
    expect(response.headers.get("set-cookie")).toContain("court_invite_handoff=");
    expect(response.headers.get("set-cookie")).not.toContain(INVITE_TOKEN);
    expect(mocks.acceptCourtInviteForUser).not.toHaveBeenCalled();
    expect(mocks.rejectCourtInviteForUser).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "couple-court:invite:accept:anonymous",
      RATE_LIMIT_OPTIONS,
      undefined,
    );
  });

  it("accepts a login handoff only after the user is authenticated", async () => {
    const handoff = await POST(mutationRequest({ token: INVITE_TOKEN }));

    expect(handoff.status).toBe(202);
    await expect(handoff.json()).resolves.toEqual(expect.objectContaining({
      requires_auth: true,
    }));
    expect(mocks.acceptCourtInviteForUser).not.toHaveBeenCalled();
    expect(mocks.rejectCourtInviteForUser).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "couple-court:invite:accept:anonymous",
      RATE_LIMIT_OPTIONS,
      undefined,
    );

    const cookie = handoff.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toContain("court_invite_handoff=");
    setAuthUser(USER_ID);
    mocks.acceptCourtInviteForUser.mockResolvedValue({ caseId: CASE_ID });

    const accepted = await POST(mutationRequest({}, { cookie }));

    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toEqual({ case_id: CASE_ID });
    expect(mocks.acceptCourtInviteForUser).toHaveBeenCalledWith(
      USER_ID,
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(mocks.rejectCourtInviteForUser).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      `couple-court:invite:accept:${USER_ID}`,
      RATE_LIMIT_OPTIONS,
      USER_ID,
    );
  });

  it("rejects a login handoff only after the user is authenticated", async () => {
    const handoff = await POST(mutationRequest({
      token: INVITE_TOKEN,
      reject: true,
    }));

    expect(handoff.status).toBe(202);
    expect(mocks.acceptCourtInviteForUser).not.toHaveBeenCalled();
    expect(mocks.rejectCourtInviteForUser).not.toHaveBeenCalled();

    const cookie = handoff.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toContain("court_invite_handoff=");
    setAuthUser(USER_ID);
    mocks.rejectCourtInviteForUser.mockResolvedValue(undefined);

    const rejected = await POST(mutationRequest({ reject: true }, { cookie }));

    expect(rejected.status).toBe(200);
    await expect(rejected.json()).resolves.toEqual({ rejected: true });
    expect(mocks.rejectCourtInviteForUser).toHaveBeenCalledWith(
      USER_ID,
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(mocks.acceptCourtInviteForUser).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "couple-court:invite:accept:anonymous",
      RATE_LIMIT_OPTIONS,
      undefined,
    );
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      `couple-court:invite:accept:${USER_ID}`,
      RATE_LIMIT_OPTIONS,
      USER_ID,
    );
  });

  it.each([
    { label: "anonymous", userId: null },
    { label: "authenticated", userId: USER_ID },
  ])("enforces the persistent limiter for a $label invite mutation", async ({ userId }) => {
    setAuthUser(userId);
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(Response.json(
      { code: "RATE_LIMITED" },
      { status: 429 },
    ));

    const response = await POST(mutationRequest({ token: INVITE_TOKEN }));

    expect(response.status).toBe(429);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      `couple-court:invite:accept:${userId ?? "anonymous"}`,
      RATE_LIMIT_OPTIONS,
      userId ?? undefined,
    );
    expect(mocks.acceptCourtInviteForUser).not.toHaveBeenCalled();
    expect(mocks.rejectCourtInviteForUser).not.toHaveBeenCalled();
  });

  it("blocks a cross-site browser mutation before accepting or rejecting", async () => {
    setAuthUser(USER_ID);

    const response = await POST(mutationRequest(
      { token: INVITE_TOKEN },
      { origin: "https://attacker.example" },
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "CROSS_SITE_REQUEST_BLOCKED",
    }));
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.acceptCourtInviteForUser).not.toHaveBeenCalled();
    expect(mocks.rejectCourtInviteForUser).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON before accepting or rejecting", async () => {
    setAuthUser(USER_ID);

    const response = await POST(mutationRequest("{"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "INVALID_JSON",
    }));
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.acceptCourtInviteForUser).not.toHaveBeenCalled();
    expect(mocks.rejectCourtInviteForUser).not.toHaveBeenCalled();
  });
});
