import { afterEach, describe, expect, it } from "vitest";

import {
  MOBILE_WEB_REQUIRED_CAPABILITIES,
  MOBILE_WEB_RUNTIME_CONTRACT_VERSION,
} from "@hanbang/shared";

import { GET } from "./route";

const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

afterEach(() => {
  if (originalSupabaseUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
  }
});

describe("GET /api/mobile/runtime-contract", () => {
  it("publishes only the public destination identity and supported bridge capabilities", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=60");
    expect(await response.json()).toEqual({
      version: MOBILE_WEB_RUNTIME_CONTRACT_VERSION,
      supabaseProjectRef: "abcdefghijklmnopqrst",
      capabilities: [...MOBILE_WEB_REQUIRED_CAPABILITIES],
    });
  });

  it("fails closed instead of advertising an unknown backend", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unexpected.example.com";

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "모바일 연결 설정을 확인하지 못했습니다.",
    });
  });
});
