// @vitest-environment node
//
// `unstable_rethrow` 는 `typeof window` 로 구현이 갈린다. 브라우저 판은
// `DynamicServerError` 를 되던지지 않으므로, 기본 jsdom 환경에서 재면 서버에서
// 실제로 도는 것과 다른 코드를 재게 된다. 이 파일만 node 로 돌린다.
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

import { createClient } from "../server";

/** Next 가 정적 생성 중 `cookies()` 에서 던지는 것과 같은 모양의 오류. */
function dynamicServerError() {
  return Object.assign(
    new Error("Dynamic server usage: Route /community/budget couldn't be rendered statically because it used `cookies`."),
    { digest: "DYNAMIC_SERVER_USAGE" },
  );
}

describe("createClient 는 정적 생성 이탈 신호를 삼키지 않는다", () => {
  beforeEach(() => {
    mocks.createServerClient.mockReset();
    mocks.cookies.mockReset();
    // 실제 @supabase/ssr 과 같이, 자격증명이 없으면 생성 자체가 실패한다.
    mocks.createServerClient.mockImplementation((url?: string, key?: string) => {
      if (!url || !key) {
        throw new Error("Your project's URL and Key are required to create a Supabase client!");
      }
      return { client: true };
    });
    // 프리뷰(스텁) 빌드와 같은 조건: 공개 Supabase 값이 없다.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("자격증명이 없는 프리렌더에서도 Supabase 생성 오류가 아니라 동적 이탈 신호를 넘긴다", async () => {
    mocks.cookies.mockRejectedValue(dynamicServerError());

    await expect(createClient()).rejects.toMatchObject({ digest: "DYNAMIC_SERVER_USAGE" });
    // 신호를 삼키고 익명 클라이언트로 내려가면 안 된다.
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("`redirect()` 같은 다른 프레임워크 제어 흐름도 그대로 통과시킨다", async () => {
    mocks.cookies.mockRejectedValue(
      Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }),
    );

    await expect(createClient()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("진짜 오류에서는 기존대로 익명 클라이언트로 되돌아간다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "placeholder_anon_key");
    mocks.cookies.mockRejectedValue(new Error("`cookies` was called outside a request scope."));

    await expect(createClient()).resolves.toEqual({ client: true });
    const options = mocks.createServerClient.mock.calls[0][2];
    expect(options.cookies.getAll()).toEqual([]);
  });
});
