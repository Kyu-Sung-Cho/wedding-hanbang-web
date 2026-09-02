import { describe, expect, it } from "vitest";
import { stringFromBase64URL } from "@supabase/ssr";

import {
  cookieHeaderHasReadableAuthCookie,
  corruptAuthCookieNames,
  isReadableAuthCookieValue,
  parseCookieHeader,
  withoutCorruptAuthCookies,
} from "../authCookieRepair";

// 2026-09-02 운영 실측: 망가진 세션 쿠키 하나를 든 사람은 로그인한 모든 화면에서
// 복구할 수 없는 500 을 받았다.
//
//     GET /wedding/lounge  → 500   (프록시가 던진다 — React 에러 경계 밖이다)
//     GET /api/auth/me     → 500
//     GET /api/health      → 503   database:"down" (DB 는 멀쩡했다)
//
// 쿠키가 아예 없으면 깔끔하게 307 /login 이었다. 그래서 "로그인한 사람만 깨진다"로
// 보였다. 원인은 `@supabase/ssr` 의 base64url 디코더가 던지는 예외가 `AuthError` 가
// 아니어서 `getUser()` 밖으로 그대로 나오는 것이었다.

const KEY = "sb-abcdefghijklmnopqrst-auth-token";

function base64Session(overrides: Record<string, unknown> = {}) {
  const session = JSON.stringify({
    access_token: "a".repeat(24),
    refresh_token: "r".repeat(24),
    token_type: "bearer",
    expires_at: 9_999_999_999,
    user: { id: "11111111-1111-4111-8111-111111111111" },
    ...overrides,
  });
  return `base64-${Buffer.from(session, "utf8").toString("base64url")}`;
}

describe("세션 쿠키를 읽을 수 있는가", () => {
  it("정상 세션은 통과한다", () => {
    expect(isReadableAuthCookieValue(base64Session())).toBe(true);
  });

  it("base64- 접두사가 없으면 손대지 않는다", () => {
    // 접두사가 없는 값은 디코딩을 거치지 않으므로 던질 일이 없다. 실제로 운영에서도
    // 이 경우는 500 이 아니라 깔끔한 307 이었다.
    expect(isReadableAuthCookieValue("garbage")).toBe(true);
    expect(isReadableAuthCookieValue("")).toBe(true);
  });

  it("base64url 알파벳이 아닌 문자가 섞이면 읽을 수 없다", () => {
    expect(isReadableAuthCookieValue("base64-!!!not-base64!!!")).toBe(false);
  });

  it("UTF-8 로 디코딩되지 않는 바이트는 읽을 수 없다", () => {
    const invalidUtf8 = Buffer.from([0xff, 0xfe, 0xfd]).toString("base64url");
    expect(isReadableAuthCookieValue(`base64-${invalidUtf8}`)).toBe(false);
  });

  // 아래 둘은 2026-09-02 QA 재검증에서 운영 500 을 추가로 낸 모양이다. 처음 찾은
  // 세 모양만 막고 끝냈다면 실제 프로필이 들고 있던 쿠키가 그대로 남았을 수 있다.
  it("퍼센트 인코딩된 값은 읽을 수 없다", () => {
    // 쿠키가 한 번 더 인코딩돼 저장되면 이 모양이 된다. `%` 는 base64url 알파벳이 아니다.
    expect(isReadableAuthCookieValue("base64-%7B%22a%22%3A1%7D")).toBe(false);
  });

  it("단독 continuation 바이트는 읽을 수 없다", () => {
    const loneContinuation = Buffer.from([0x80]).toString("base64url");
    expect(isReadableAuthCookieValue(`base64-${loneContinuation}`)).toBe(false);
  });

  it("접두사만 있는 값은 빈 문자열로 읽힌다", () => {
    expect(isReadableAuthCookieValue("base64-")).toBe(true);
  });

  /**
   * 판정을 직접 구현하면 라이브러리와 갈라진다. 갈라지는 순간 이 관문은 통과시키면
   * 안 되는 것을 통과시키고, 500 이 돌아온다. 그래서 같은 값에 대해 두 판정이 늘
   * 일치하는지 본다 — 라이브러리를 올릴 때 규칙이 바뀌면 여기서 걸린다.
   */
  it("판정이 라이브러리 디코더와 어긋나지 않는다", () => {
    const samples = [
      base64Session(),
      "base64-",
      "base64-!!!",
      "base64-a",
      "base64-ab",
      "base64-abc",
      "base64-abcd",
      `base64-${Buffer.from([0xff]).toString("base64url")}`,
      `base64-${Buffer.from([0xc3, 0x28]).toString("base64url")}`,
      `base64-${Buffer.from("한글도 된다", "utf8").toString("base64url")}`,
      "base64-with=padding==",
      "base64-with spaces",
    ];

    for (const sample of samples) {
      let libraryReadable = true;
      try {
        stringFromBase64URL(sample.slice("base64-".length));
      } catch {
        libraryReadable = false;
      }
      expect(isReadableAuthCookieValue(sample), sample).toBe(libraryReadable);
    }
  });
});

describe("지워야 할 쿠키 고르기", () => {
  it("정상 세션은 아무것도 지우지 않는다", () => {
    const cookies = [
      { name: KEY, value: base64Session() },
      { name: "onboarding_complete", value: "true" },
    ];
    expect(corruptAuthCookieNames(cookies)).toEqual([]);
    expect(withoutCorruptAuthCookies(cookies)).toEqual(cookies);
  });

  it("쪼개지지 않은 망가진 쿠키를 고른다", () => {
    const cookies = [{ name: KEY, value: "base64-!!!broken!!!" }];
    expect(corruptAuthCookieNames(cookies)).toEqual([KEY]);
    expect(withoutCorruptAuthCookies(cookies)).toEqual([]);
  });

  it("조각 하나가 망가지면 그 키의 조각을 전부 지운다", () => {
    // 하나만 남겨 두면 다음 요청이 또 같은 자리에서 멈춘다.
    const whole = base64Session();
    const cookies = [
      { name: `${KEY}.0`, value: whole.slice(0, 30) },
      { name: `${KEY}.1`, value: "!!!broken!!!" },
    ];
    expect(corruptAuthCookieNames(cookies).sort()).toEqual([`${KEY}.0`, `${KEY}.1`]);
    expect(withoutCorruptAuthCookies(cookies)).toEqual([]);
  });

  it("이어 붙여서 온전하면 조각을 지우지 않는다", () => {
    const whole = base64Session();
    const cookies = [
      { name: `${KEY}.0`, value: whole.slice(0, 40) },
      { name: `${KEY}.1`, value: whole.slice(40) },
    ];
    expect(corruptAuthCookieNames(cookies)).toEqual([]);
  });

  it("세션 쿠키가 아닌 것은 절대 건드리지 않는다", () => {
    // 온보딩 표식이나 체험 쿠키까지 사라지면 고치려던 것보다 큰 것을 잃는다.
    const cookies = [
      { name: KEY, value: "base64-!!!broken!!!" },
      { name: "onboarding_complete", value: "true" },
      { name: "demo_mode", value: "true" },
      { name: "sb-abcdefghijklmnopqrst-auth-token-code-verifier", value: "base64-!!!" },
    ];
    const remaining = withoutCorruptAuthCookies(cookies).map(({ name }) => name);
    expect(remaining).toEqual([
      "onboarding_complete",
      "demo_mode",
      "sb-abcdefghijklmnopqrst-auth-token-code-verifier",
    ]);
  });

  it("쪼개진 것과 안 쪼개진 것이 함께 오면 안 쪼개진 쪽이 값이다", () => {
    // 라이브러리는 쪼개지지 않은 쿠키가 있으면 그것 하나만 본다. 그쪽이 망가졌으면
    // 조각이 온전해도 읽지 못한다 — 운영에서 이 모양도 500 이었다.
    const whole = base64Session();
    const cookies = [
      { name: KEY, value: "base64-!!!broken!!!" },
      { name: `${KEY}.0`, value: whole },
    ];
    expect(corruptAuthCookieNames(cookies).sort()).toEqual([KEY, `${KEY}.0`]);
  });

  it("조각 번호가 끊긴 뒤의 조각은 값에 들어가지 않는다", () => {
    // 라이브러리는 비어 있는 번호를 만나면 멈춘다. 판정도 같은 순서를 따라야
    // "읽을 수 있다"고 본 값이 실제로 읽히는 값과 같다.
    const cookies = [
      { name: `${KEY}.1`, value: "base64-!!!broken!!!" },
    ];
    // `.0` 이 없으므로 라이브러리는 아무것도 읽지 못한다 — 지울 것도 없다.
    expect(corruptAuthCookieNames(cookies)).toEqual([]);
  });
});

/**
 * 공개 조회들은 "자격을 내놓았는데 확인에 실패한" 요청을 fail-closed 로 막는다.
 * 그 판정이 쿠키의 **존재**만 보고 있어서, 망가진 쿠키를 든 사람은 공개 목록조차
 * 503 을 받았다 — 2026-09-02 CTO 독립 검증 실측:
 *
 *     GET /api/community/posts        200 → 503
 *     GET /api/auth/me?guest_probe=1  200 → 500
 *
 * 우리가 이미 무시하기로 한 값을 "자격을 내놓았다"고 세면 안 된다.
 */
describe("쓸 수 있는 세션 쿠키를 내놓았는가", () => {
  it("쿠키가 없으면 자격이 없다", () => {
    expect(cookieHeaderHasReadableAuthCookie(null)).toBe(false);
    expect(cookieHeaderHasReadableAuthCookie("")).toBe(false);
    expect(cookieHeaderHasReadableAuthCookie("onboarding_complete=true")).toBe(false);
  });

  it("정상 세션 쿠키는 자격이다", () => {
    expect(cookieHeaderHasReadableAuthCookie(`${KEY}=${base64Session()}`)).toBe(true);
  });

  it("접두사 없는 값도 자격으로 센다", () => {
    // 디코딩을 거치지 않으므로 던지지 않는다. 세션이 아닐 수는 있어도, 그 판정은
    // 라이브러리가 한다 — 여기서 미리 손님으로 만들면 로그인한 사람이 손님이 된다.
    expect(cookieHeaderHasReadableAuthCookie(`${KEY}=whatever`)).toBe(true);
  });

  const UNREADABLE = [
    ["알파벳 밖 문자", `${KEY}=base64-!!!broken!!!`],
    ["UTF-8 아닌 바이트", `${KEY}=base64-${Buffer.from([0xff, 0xfe, 0xfd]).toString("base64url")}`],
    ["퍼센트 인코딩", `${KEY}=base64-%7B%22a%22%3A1%7D`],
  ] as const;

  for (const [label, header] of UNREADABLE) {
    it(`${label} 은 자격이 아니다 — 손님과 같게 대한다`, () => {
      expect(cookieHeaderHasReadableAuthCookie(header)).toBe(false);
      expect(cookieHeaderHasReadableAuthCookie(`${header}; onboarding_complete=true`)).toBe(false);
    });
  }

  it("조각 하나가 깨지면 그 세션은 자격이 아니다", () => {
    const whole = base64Session();
    const header = `${KEY}.0=${whole.slice(0, 30)}; ${KEY}.1=!!!broken!!!`;
    expect(cookieHeaderHasReadableAuthCookie(header)).toBe(false);
  });

  it("망가진 세션 옆에 온전한 세션이 있으면 자격이다", () => {
    // 다른 프로젝트 ref 의 쿠키가 함께 남아 있을 수 있다. 하나라도 읽히면
    // 그 사람은 자격을 내놓은 것이다.
    const header = `${KEY}=base64-!!!broken!!!; sb-otherprojectrefxyz-auth-token=${base64Session()}`;
    expect(cookieHeaderHasReadableAuthCookie(header)).toBe(true);
  });
});

describe("Cookie 헤더 가르기", () => {
  it("이름과 값을 가르고 퍼센트 인코딩을 푼다", () => {
    // 프레임워크가 쿠키를 읽을 때 하는 일과 같아야, 여기서 "읽을 수 있다"고 본
    // 값이 실제로 읽히는 값과 같다.
    expect(parseCookieHeader("a=1; b=%7B%22x%22%3A2%7D")).toEqual([
      { name: "a", value: "1" },
      { name: "b", value: '{"x":2}' },
    ]);
  });

  it("값에 = 가 들어 있어도 자르지 않는다", () => {
    expect(parseCookieHeader("t=abc=def=")).toEqual([{ name: "t", value: "abc=def=" }]);
  });

  it("깨진 퍼센트 시퀀스는 원문을 그대로 둔다", () => {
    expect(parseCookieHeader("t=%E0%A4%A")).toEqual([{ name: "t", value: "%E0%A4%A" }]);
  });

  it("빈 값과 이름 없는 조각을 버리지 않거나 터지지 않는다", () => {
    expect(parseCookieHeader("a=; ; =x; b=2")).toEqual([
      { name: "a", value: "" },
      { name: "b", value: "2" },
    ]);
  });
});
