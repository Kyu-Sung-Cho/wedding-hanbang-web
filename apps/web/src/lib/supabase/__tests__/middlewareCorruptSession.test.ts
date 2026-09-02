import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { updateSession } from "../middleware";

// 이 파일은 `@supabase/ssr` 를 **모킹하지 않는다.** 터진 것이 그 라이브러리의 쿠키
// 디코더였기 때문이다 — 모킹하면 재현되지 않는다.
//
// 2026-09-02 운영 실측(https://hanbang.ai/wedding/lounge):
//
//     쿠키 없음                        → 307 /login
//     sb-...-auth-token=base64-!!!    → 500  ← 복구할 수 없다
//
// 프록시는 React 에러 경계 **밖**이라, 여기서 던지면 사용자는 다시 시도할 수 있는
// 화면이 아니라 "Internal Server Error" 한 줄을 본다.
//
// 세션이 없으면 gotrue 는 네트워크를 부르지 않고 바로 "세션 없음"으로 답하므로,
// 이 검사에는 Supabase 서버가 필요하지 않다.

const PROJECT_REF = "abcdefghijklmnopqrst";
const KEY = `sb-${PROJECT_REF}-auth-token`;

function loungeRequest(cookie: string) {
  return new NextRequest("https://hanbang.ai/wedding/lounge", {
    headers: cookie ? { cookie } : {},
  });
}

/** 응답이 이 쿠키를 지우라고 말하는가. */
function clearsCookie(response: Response, name: string): boolean {
  return response.headers
    .getSetCookie()
    .some((header) => header.startsWith(`${name}=;`) || /* max-age=0 */ (
      header.startsWith(`${name}=`) && /max-age=0/i.test(header)
    ));
}

describe("망가진 세션 쿠키를 들고 보호 경로에 들어올 때", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${PROJECT_REF}.supabase.co`);
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      `sb_publishable_${"a".repeat(40)}`,
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const CORRUPT = [
    ["base64url 알파벳이 아닌 문자", `${KEY}=base64-!!!not-base64!!!`],
    [
      "UTF-8 로 디코딩되지 않는 바이트",
      `${KEY}=base64-${Buffer.from([0xff, 0xfe, 0xfd]).toString("base64url")}`,
    ],
    [
      "쪼개진 쿠키의 두 번째 조각이 깨졌다",
      `${KEY}.0=base64-eyJhY2Nlc3NfdG9rZW4iOiJhYWFh; ${KEY}.1=!!!broken!!!`,
    ],
  ] as const;

  for (const [label, cookie] of CORRUPT) {
    it(`${label} → 500 이 아니라 로그인 관문으로 보낸다`, async () => {
      const response = await updateSession(loungeRequest(cookie));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://hanbang.ai/login?redirect=%2Fwedding%2Flounge",
      );
    });

    it(`${label} → 그 쿠키를 지워서 다음 요청이 같은 자리에 걸리지 않게 한다`, async () => {
      const response = await updateSession(loungeRequest(cookie));

      // 못 본 척만 하면 다음 요청도 같은 쿠키를 들고 온다. 지워 줘야 빠져나온다.
      const cleared = response.headers.getSetCookie();
      expect(cleared.length).toBeGreaterThan(0);
      for (const name of cookie.split(";").map((part) => part.trim().split("=")[0])) {
        expect(clearsCookie(response, name), name).toBe(true);
      }
    });
  }

  it("쿠키가 아예 없을 때와 같은 곳으로 보낸다", async () => {
    const withoutCookie = await updateSession(loungeRequest(""));
    const withCorrupt = await updateSession(
      loungeRequest(`${KEY}=base64-!!!not-base64!!!`),
    );

    expect(withCorrupt.status).toBe(withoutCookie.status);
    expect(withCorrupt.headers.get("location")).toBe(
      withoutCookie.headers.get("location"),
    );
  });

  it("디코딩은 되지만 세션이 아닌 값은 그대로 로그인 관문으로 간다", async () => {
    // 이 경우는 원래도 500 이 아니었다. 고치면서 함께 망가뜨리지 않았는지 본다.
    const notASession = `base64-${Buffer.from('{"hello":"world"}').toString("base64url")}`;
    const response = await updateSession(loungeRequest(`${KEY}=${notASession}`));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("공개 경로는 망가진 쿠키가 있어도 막지 않는다", async () => {
    const response = await updateSession(
      new NextRequest("https://hanbang.ai/price", {
        headers: { cookie: `${KEY}=base64-!!!not-base64!!!` },
      }),
    );

    expect(response.status).toBe(200);
  });
});
