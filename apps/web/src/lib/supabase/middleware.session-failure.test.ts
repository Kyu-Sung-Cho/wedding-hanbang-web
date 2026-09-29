// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), createServerClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@/lib/auth/signupConsentAccess", () => ({ hasWebSignupConsentAccess: () => true }));
import { updateSession } from "./middleware";

function request(path = "/wedding/chat?source=synthetic") {
  return new NextRequest(`https://hanbang.ai${path}`, {
    headers: { cookie: "sb-existing-auth-token=synthetic; onboarding_complete=true" },
  });
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic");
  vi.resetAllMocks();
  mocks.createServerClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
});
afterEach(() => vi.unstubAllEnvs());

describe("protected pages distinguish unavailable authentication from logout", () => {
  it.each([
    new AuthRetryableFetchError("private transport diagnostic", 503),
    new AuthApiError("private database diagnostic", 500, "unexpected_failure"),
    new AuthApiError("private rate-limit diagnostic", 429, "over_request_rate_limit"),
  ])("returns a private 503 without login redirect or cookie deletion for $name $status", async error => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error });
    for (const path of ["/wedding/chat?source=synthetic", "/admin/customers"]) {
      const currentRequest = request(path);
      const response = await updateSession(currentRequest);
      expect(response.status).toBe(503);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("cache-control")).toContain("private, no-store");
      expect(await response.text()).not.toContain(error.message);
      expect(response.cookies.getAll()).toEqual([]);
      expect(currentRequest.cookies.get("sb-existing-auth-token")?.value).toBe("synthetic");
    }
  });

  it("handles thrown verification errors without exposing their contents", async () => {
    mocks.getUser.mockRejectedValue(new Error("private sdk diagnostic"));
    const response = await updateSession(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private sdk diagnostic");
    expect(response.headers.get("location")).toBeNull();
  });

  it("preserves a cookie already refreshed before later verification failure", async () => {
    mocks.createServerClient.mockImplementation((_url, _key, options) => ({ auth: { getUser: async () => {
      options.cookies.setAll([{ name: "sb-existing-auth-token", value: "refreshed", options: { path: "/", secure: true, sameSite: "lax" } }]);
      return { data: { user: null }, error: new AuthRetryableFetchError("unavailable", 503) };
    } } }));
    const response = await updateSession(request());
    expect(response.status).toBe(503);
    expect(response.cookies.get("sb-existing-auth-token")).toMatchObject({ value: "refreshed", secure: true, sameSite: "lax" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each([null, new AuthSessionMissingError(), new AuthApiError("expired JWT", 403, "bad_jwt")])("still redirects a confirmed absent session to login: %s", async error => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error });
    const response = await updateSession(request());
    expect(response.status).toBe(307);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("redirect")).toBe("/wedding/chat?source=synthetic");
  });

  it("keeps a verified session on its protected page", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "verified" } }, error: null });
    const response = await updateSession(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});
