import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }));

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));

import { proxy } from "@/proxy";

import { EXAMPLE_ROUTES } from "../exampleRoutes";

/**
 * 예시 커플 화면은 로그인 없이 열려야 한다. 프록시(`proxy.ts` → 세션 갱신)의 보호 경로 목록은
 * 앞부분 일치로 판정해서, 예시 주소가 보호 경로로 시작하면 로그인으로 튕긴다
 * (예: `/chat` 으로 시작하는 주소). 그래서 진짜 프록시에 예시 주소를 넣어 본다.
 */
describe("예시 커플 화면은 로그인 없이 열린다", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    mocks.createServerClient.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each(Object.values(EXAMPLE_ROUTES))("%s 는 로그인 확인 없이 그대로 통과한다", async (pathname) => {
    const response = await proxy(new NextRequest(`https://hanbang.ai${pathname}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("같은 측정이 보호 경로는 로그인으로 보낸다(측정기가 살아 있다)", async () => {
    mocks.createServerClient.mockImplementationOnce(() => ({
      auth: { getUser: async () => ({ data: { user: null } }) },
    }));

    const response = await proxy(new NextRequest("https://hanbang.ai/lounge"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
    expect(mocks.createServerClient).toHaveBeenCalledOnce();
  });
});
