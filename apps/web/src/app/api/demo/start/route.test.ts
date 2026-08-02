import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(() => null),
  createClient: vi.fn(),
  getUser: vi.fn(),
  setDemoCookies: vi.fn(() => true),
}));

vi.mock("@/lib/demoSession", () => ({
  setDemoCookies: mocks.setDemoCookies,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitKey: vi.fn(() => "demo-start:test"),
}));

import { POST } from "./route";

describe("POST /api/demo/start", () => {
  beforeEach(() => {
    mocks.checkRateLimit.mockReturnValue(null);
    mocks.createClient.mockReturnValue({
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.setDemoCookies.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("starts a signed local-only demo without contacting Supabase in preview mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");

    const response = await POST(
      new Request("https://preview.example.test/api/demo/start", {
        method: "POST",
        headers: { Origin: "https://preview.example.test" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.setDemoCookies).toHaveBeenCalledOnce();
  });

  it("does not replace an authenticated production session with demo data", async () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "false");
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "real-user" } },
    });

    const response = await POST(
      new Request("https://hanbang.ai/api/demo/start", {
        method: "POST",
        headers: { Origin: "https://hanbang.ai" },
      }),
    );

    await expect(response.json()).resolves.toEqual({
      success: true,
      alreadySignedIn: true,
    });
    expect(mocks.createClient).toHaveBeenCalledOnce();
    expect(mocks.setDemoCookies).not.toHaveBeenCalled();
  });

  it("fails closed when the demo signing secret is unavailable", async () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");
    mocks.setDemoCookies.mockReturnValue(false);

    const response = await POST(
      new Request("https://preview.example.test/api/demo/start", {
        method: "POST",
        headers: { Origin: "https://preview.example.test" },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "데모 세션 설정을 사용할 수 없습니다.",
    });
  });

  it("rejects a streamed oversized body without Content-Length", async () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");
    const request = new Request("https://preview.example.test/api/demo/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://preview.example.test",
      },
      body: JSON.stringify({ padding: "x".repeat(2 * 1024) }),
    });
    expect(request.headers.get("content-length")).toBeNull();

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.setDemoCookies).not.toHaveBeenCalled();
  });

  it("fails closed on malformed JSON", async () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");
    const response = await POST(new Request("https://preview.example.test/api/demo/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://preview.example.test",
      },
      body: "{",
    }));

    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.setDemoCookies).not.toHaveBeenCalled();
  });

  it("rejects an untrusted mutation before rate limiting", async () => {
    const response = await POST(new Request("https://hanbang.ai/api/demo/start", {
      method: "POST",
    }));

    expect(response.status).toBe(403);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
