import { createServerClient } from "@supabase/ssr";
import { describe, expect, it } from "vitest";

import { withoutUnreadableSupabaseCookies } from "./authCookies";

/**
 * 진짜 `createServerClient` 로 그 자리를 그대로 확인한다.
 *
 * 옆의 단위 테스트들은 우리 필터가 무엇을 버리는지만 본다. 정작 확인해야 하는 것은
 * **`auth.getUser()` 가 던지지 않느냐** 이고, 그건 `@supabase/ssr` 안에서 결정된다.
 * 그래서 이 파일만은 아무것도 mock 하지 않는다.
 *
 * 네트워크는 타지 않는다 — 문제의 예외는 세션 저장소를 읽는 단계에서 나오고, 그건
 * 요청을 보내기 전이다. 아래 URL·키는 형식만 맞는 가짜다.
 *
 * 걸러내기 **전** 동작(디코딩이 던진다)은 여기서 재현하지 않는다. 상한 쿠키를 든
 * 클라이언트는 `getUser()` 뿐 아니라 생성자가 띄우는 `_emitInitialSession` 에서도
 * 던져서, 테스트 프로세스에 unhandled rejection 을 남긴다 — 그 자체가 이 버그의
 * 크기지만 테스트 신호로는 쓸 수 없다. 던진다는 사실은 `authCookies.test.ts` 가
 * `stringFromBase64URL` 을 직접 불러 붙잡는다.
 */

const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const ANON_KEY = "anon-key-for-storage-only";
const AUTH_TOKEN = "sb-abcdefghijklmnopqrst-auth-token";

type Cookie = { name: string; value: string };

function sanitizedClient(cookies: Cookie[]) {
  return createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => withoutUnreadableSupabaseCookies(cookies),
      setAll: () => {},
    },
  });
}

describe("상한 인증 쿠키를 든 요청의 auth.getUser()", () => {
  const brokenCookies: Cookie[] = [
    { name: AUTH_TOKEN, value: "base64-garbage" },
    { name: "onboarding_complete", value: "true" },
  ];

  it("던지지 않고 '세션 없음'으로 끝난다", async () => {
    const { data, error } = await sanitizedClient(brokenCookies).auth.getUser();

    expect(data.user).toBeNull();
    // 로그아웃 방문자에게 늘 오는 그 오류다. 공개 화면은 이 상태에서 정상으로 그려진다.
    expect(error?.name).toBe("AuthSessionMissingError");
  });

  it("쿠키가 아예 없을 때와 같은 결과를 준다", async () => {
    const withBroken = await sanitizedClient(brokenCookies).auth.getUser();
    const withNone = await sanitizedClient([]).auth.getUser();

    expect(withBroken.data).toEqual(withNone.data);
    expect(withBroken.error?.name).toBe(withNone.error?.name);
  });

  it("같은 요청의 다른 쿠키는 Supabase 가 그대로 본다", () => {
    // 인증 쿠키 하나가 상했다고 온보딩 표식까지 사라지면 안 된다.
    expect(withoutUnreadableSupabaseCookies(brokenCookies)).toEqual([
      { name: "onboarding_complete", value: "true" },
    ]);
  });
});
