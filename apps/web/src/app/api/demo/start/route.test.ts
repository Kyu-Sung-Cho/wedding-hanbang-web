import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  createClient: vi.fn(),
  getUser: vi.fn(),
  rateLimitKey: vi.fn(() => "demo-start:test-ip"),
  setDemoCookies: vi.fn(),
}));

vi.mock("@/lib/demoSession", () => ({
  setDemoCookies: mocks.setDemoCookies,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

import { POST } from "./route";

function request() {
  return new Request("https://hanbang.ai/api/demo/start", { method: "POST" });
}

describe("POST /api/demo/start", () => {
  beforeEach(() => {
    mocks.checkRateLimit.mockReset().mockReturnValue(null);
    mocks.checkRateLimitPersistent.mockReset().mockResolvedValue(null);
    mocks.getUser.mockReset().mockResolvedValue({ data: { user: null } });
    mocks.createClient.mockReset().mockResolvedValue({
      auth: { getUser: mocks.getUser },
    });
    mocks.rateLimitKey.mockClear();
    mocks.setDemoCookies.mockReset().mockReturnValue(true);
  });

  it("uses the shared fail-closed limiter before issuing an anonymous session", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "demo-start:test-ip",
      { maxRequests: 20, windowMs: 60 * 60 * 1000 },
      { failClosed: true },
    );
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.setDemoCookies).toHaveBeenCalledOnce();
  });

  it("does not perform auth work or issue cookies after the limiter blocks", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response("limited", { status: 429 }),
    );

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.setDemoCookies).not.toHaveBeenCalled();
  });

  it("does not create a demo identity for a signed-in user", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: "user-1" } } });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, alreadySignedIn: true });
    expect(mocks.setDemoCookies).not.toHaveBeenCalled();
  });

  it("fails closed when the demo signing configuration cannot issue a token", async () => {
    mocks.setDemoCookies.mockReturnValueOnce(false);

    const response = await POST(request());

    expect(response.status).toBe(500);
  });
});
