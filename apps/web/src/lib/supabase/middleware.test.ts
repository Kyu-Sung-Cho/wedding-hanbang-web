import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

import { updateSession } from "./middleware";
import { createDemoSessionToken } from "../demoSession";

describe("vendor admin-preview onboarding boundary", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv(
      "DEMO_SESSION_SECRET",
      "demo-session-2026-A7z!Q9v#N4k@R8m$T2x",
    );
    mocks.getUser.mockReset().mockResolvedValue({
      data: { user: { id: "signed-in-user" } },
    });
    mocks.maybeSingle.mockReset().mockResolvedValue({
      data: { onboarding_completed: false },
      error: null,
    });
    mocks.eq.mockReset().mockReturnValue({ maybeSingle: mocks.maybeSingle });
    mocks.select.mockReset().mockReturnValue({ eq: mocks.eq });
    mocks.from.mockReset().mockReturnValue({ select: mocks.select });
    mocks.createServerClient.mockReset().mockReturnValue({
      auth: { getUser: mocks.getUser },
      from: mocks.from,
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([
    "/wedding/vendors?preview=1",
    "/wedding/vendors/vendor-1?preview=1",
  ])("keeps authentication but bypasses onboarding for vendor preview %s", async (path) => {
    const response = await updateSession(
      new NextRequest(`https://hanbang.ai${path}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it("still redirects an ordinary vendor request when onboarding is incomplete", async () => {
    const response = await updateSession(
      new NextRequest("https://hanbang.ai/wedding/vendors"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://hanbang.ai/wedding/onboarding");
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith("profiles");
    expect(mocks.select).toHaveBeenCalledWith("onboarding_completed");
    expect(mocks.eq).toHaveBeenCalledWith("id", "signed-in-user");
  });

  it("does not trust a forged onboarding cookie", async () => {
    const response = await updateSession(
      new NextRequest("https://hanbang.ai/wedding/chat", {
        headers: { cookie: "onboarding_complete=true" },
      }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://hanbang.ai/wedding/onboarding");
    expect(mocks.maybeSingle).toHaveBeenCalledOnce();
  });

  it("allows a canonically completed profile without a client marker", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({
      data: { onboarding_completed: true },
      error: null,
    });

    const response = await updateSession(
      new NextRequest("https://hanbang.ai/wedding/chat"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("fails closed when the canonical onboarding lookup fails", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "08006" },
    });

    const response = await updateSession(
      new NextRequest("https://hanbang.ai/wedding/chat", {
        headers: { cookie: "onboarding_complete=true" },
      }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://hanbang.ai/wedding/onboarding");
  });

  it("still requires authentication for preview mode", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });

    const response = await updateSession(
      new NextRequest("https://hanbang.ai/wedding/vendors?preview=1"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://hanbang.ai/login?preview=1");
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it("does not trust the unsigned demo marker on a protected customer path", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    const request = new NextRequest("https://hanbang.ai/wedding/chat", {
      headers: { cookie: "demo_mode=true" },
    });

    const response = await updateSession(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://hanbang.ai/login");
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it("allows a protected customer path only with the signed demo cookie pair", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    const token = createDemoSessionToken();
    expect(token).toBeTruthy();
    const request = new NextRequest("https://hanbang.ai/wedding/chat", {
      headers: { cookie: `demo_mode=true; demo_session=${token}` },
    });

    const response = await updateSession(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
});
