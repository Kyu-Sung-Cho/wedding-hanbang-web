import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

import { createClientFromRequest } from "./server";

const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

describe("createClientFromRequest authorization precedence", () => {
  beforeEach(() => {
    mocks.createServerClient.mockReset();
    mocks.cookies.mockReset();
    mocks.createServerClient.mockReturnValue({ client: true });
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  });

  afterEach(() => {
    if (originalSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    if (originalSupabaseAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalSupabaseAnonKey;
  });

  it("uses the shared case-insensitive Bearer parser", async () => {
    await createClientFromRequest(new Request("https://hanbang.example/api/favorites", {
      headers: { authorization: "bearer access.token-value" },
    }));

    expect(mocks.createServerClient).toHaveBeenCalledOnce();
    const options = mocks.createServerClient.mock.calls[0][2];
    expect(options.global.headers.Authorization).toBe("Bearer access.token-value");
    expect(options.cookies.getAll()).toEqual([]);
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("uses an anonymous client rather than cookies for any invalid Authorization header", async () => {
    await createClientFromRequest(new Request("https://hanbang.example/api/favorites", {
      headers: {
        authorization: "Basic attacker-controlled",
        cookie: "sb-session=ambient-cookie",
      },
    }));

    expect(mocks.createServerClient).toHaveBeenCalledOnce();
    const options = mocks.createServerClient.mock.calls[0][2];
    expect(options.global).toBeUndefined();
    expect(options.cookies.getAll()).toEqual([]);
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("inherits the current Next cookie session when a synthetic request has no Authorization header", async () => {
    const cookieRows = [{ name: "sb-session", value: "ambient-cookie" }];
    const cookieStore = {
      getAll: vi.fn(() => cookieRows),
      set: vi.fn(),
    };
    mocks.cookies.mockResolvedValue(cookieStore);

    await createClientFromRequest(new Request(
      "http://localhost/internal-admin-preview",
    ));

    expect(mocks.cookies).toHaveBeenCalledOnce();
    expect(mocks.createServerClient).toHaveBeenCalledOnce();
    const options = mocks.createServerClient.mock.calls[0][2];
    expect(options.global).toBeUndefined();
    expect(options.cookies.getAll()).toEqual(cookieRows);
  });
  it("opts into the request's bounded transport without replacing Bearer identity", async () => {
    const boundedFetch = vi.fn();
    await createClientFromRequest(new Request("https://hanbang.example/api/amora/actions/act_qa", {
      headers: { authorization: "Bearer access.token-value" },
    }), { fetch: boundedFetch });
    const options = mocks.createServerClient.mock.calls[0][2];
    expect(options.global.headers.Authorization).toBe("Bearer access.token-value");
    expect(options.global.fetch).toBe(boundedFetch);
    expect(mocks.cookies).not.toHaveBeenCalled();
  });
  it("still refuses an invalid header's cookie fallback with an opt-in transport", async () => {
    const boundedFetch = vi.fn();
    await createClientFromRequest(new Request("https://hanbang.example/api/amora/actions/act_qa", {
      headers: { authorization: "Basic invalid", cookie: "sb-session=ambient-cookie" },
    }), { fetch: boundedFetch });
    const options = mocks.createServerClient.mock.calls[0][2];
    expect(options.global.fetch).toBe(boundedFetch);
    expect(options.global.headers).toBeUndefined();
    expect(options.cookies.getAll()).toEqual([]);
    expect(mocks.cookies).not.toHaveBeenCalled();
  });
  it("retains read/write cookie behavior when a cookie client opts into bounded fetch", async () => {
    const rows = [{ name: "sb-session", value: "synthetic-cookie" }];
    const set = vi.fn(); mocks.cookies.mockResolvedValue({ getAll: () => rows, set });
    const boundedFetch = vi.fn();
    await createClientFromRequest(new Request("https://hanbang.example/api/amora/actions/act_qa"), { fetch: boundedFetch });
    const options = mocks.createServerClient.mock.calls[0][2];
    expect(options.global.fetch).toBe(boundedFetch);
    expect(options.global.headers).toBeUndefined();
    expect(options.cookies.getAll()).toEqual(rows);
    options.cookies.setAll([{ name: "sb-session", value: "next-synthetic-cookie", options: { path: "/" } }]);
    expect(set).toHaveBeenCalledWith("sb-session", "next-synthetic-cookie", { path: "/" });
  });
});
