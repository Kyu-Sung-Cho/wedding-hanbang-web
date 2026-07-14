import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { createClientFromRequest } from "@/lib/supabase/server";

describe("request Supabase bearer boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never falls back to a browser cookie when any Bearer credential is present", async () => {
    const tokenOnlyClient = { auth: { getUser: vi.fn() } };
    mocks.createServerClient.mockReturnValue(tokenOnlyClient);
    const request = new Request("https://hanbang.ai/api/couple-court/cases", {
      headers: {
        Authorization: "Bearer explicit-native-token",
        Cookie: "sb-session=must-not-be-consumed",
      },
    });

    const client = await createClientFromRequest(request);

    expect(client).toBe(tokenOnlyClient);
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.createServerClient).toHaveBeenCalledOnce();
    const options = mocks.createServerClient.mock.calls[0]?.[2];
    expect(options.cookies.getAll()).toEqual([]);
    expect(options.global.headers.Authorization).toBe(
      "Bearer explicit-native-token",
    );
  });
});
