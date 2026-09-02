import { stringFromBase64URL } from "@supabase/ssr";

/**
 * 읽을 수 없는 세션 쿠키를 세션 조회 **앞에서** 걸러낸다.
 *
 * ## 무엇이 터졌나
 *
 * `@supabase/ssr` 는 세션을 `base64-` 접두사가 붙은 쿠키에 담고, 3180바이트를 넘으면
 * `sb-<ref>-auth-token.0` · `.1` 로 쪼갠다. 조각을 다시 읽을 때는 이어 붙인 뒤
 * base64url 로 디코딩하는데, 그 디코더는 **예외를 던진다**:
 *
 *     Error: Invalid Base64-URL character "!" at position 0
 *     Error: Invalid UTF-8 sequence
 *
 * 이 예외는 `AuthError` 가 아니다. 그래서 gotrue 가 감싸 주지 않고 `getUser()` 밖으로
 * 그대로 나온다. `getUser()` 를 부르는 자리는 전부 "이 함수는 던지지 않는다"고
 * 가정하고 있었다 — 그래서 망가진 쿠키 하나를 든 사람은 이렇게 됐다
 * (2026-09-02 운영 실측):
 *
 *     GET /wedding/lounge   → 500   (프록시가 던진다. React 에러 경계 밖이다)
 *     GET /api/auth/me      → 500
 *     GET /api/health       → 503   database:"down" — DB 는 멀쩡한데 그렇게 말한다
 *
 * 쿠키가 없는 사람은 깔끔하게 `/login` 으로 갔다. 그래서 밖에서 보면 "로그인한
 * 사람만 라운지가 깨진다"로 보였다.
 *
 * ## 왜 여기서 고치는가
 *
 * 부르는 자리마다 try/catch 를 두는 것은 두더지잡기다 — 프록시·앱 셸·API 라우트·
 * 상태 확인이 각각 같은 쿠키를 읽는다. 쿠키를 **건네주는 한 곳**에서 걸러내면 그
 * 전부가 한 번에 낫는다.
 *
 * ## 걸러낸 것을 어떻게 대하는가
 *
 * 디코딩되지 않는 세션은 세션이 아니다. 없는 것으로 보고 로그인으로 보낸다 —
 * 그것이 사용자가 실제로 취할 수 있는 행동이다. 다만 쿠키를 그대로 두면 다음 요청도
 * 같은 쿠키를 읽으므로, 지우는 것까지가 복구다(`corruptAuthCookieNames`).
 *
 * ## 무엇을 건드리지 않는가
 *
 * 디코딩은 되지만 내용이 세션이 아닌 경우(잘린 JSON, 배열, 엉뚱한 객체)는 여기서
 * 손대지 않는다. 그건 라이브러리가 이미 조용히 "세션 없음"으로 처리한다 — 운영에서
 * 확인했다. 이 관문은 **디코딩 자체가 실패하는 값**만 본다.
 */

const BASE64_PREFIX = "base64-";

/** `sb-<something>-auth-token`. 조각 번호(`.0`)는 이미 떼어낸 이름을 받는다. */
const AUTH_TOKEN_KEY = /^sb-.+-auth-token$/;

/** `<key>.0` 처럼 조각 번호가 붙은 이름에서 번호를 떼어낸다. */
const CHUNK_SUFFIX = /^(.*)\.(?:0|[1-9][0-9]*)$/;

export interface ReadableCookie {
  name: string;
  value: string;
}

/** 이 쿠키 이름이 어느 세션 키에 속하는가. 세션 쿠키가 아니면 null. */
function authTokenKeyOf(name: string): string | null {
  const key = CHUNK_SUFFIX.exec(name)?.[1] ?? name;
  return AUTH_TOKEN_KEY.test(key) ? key : null;
}

/**
 * 라이브러리의 `combineChunks` 와 같은 순서로 값을 잇는다.
 *
 * 쪼개지지 않은 쿠키가 있으면 그것 하나가 값이고, 없으면 `.0` 부터 번호를 올려 가며
 * **비어 있는 번호를 만나면 멈춘다.** 그 규칙까지 같아야, 여기서 "읽을 수 있다"고
 * 판정한 값이 실제로 읽히는 값과 같다.
 */
function combineAuthCookie(
  key: string,
  byName: Map<string, string>,
): string | null {
  const whole = byName.get(key);
  if (whole !== undefined) return whole;

  let combined = "";
  for (let index = 0; ; index += 1) {
    const chunk = byName.get(`${key}.${index}`);
    if (chunk === undefined) break;
    combined += chunk;
  }
  return combined === "" ? null : combined;
}

/**
 * 세션 조회가 이 값을 읽다가 터지지 않는가.
 *
 * 판정을 직접 구현하지 않고 라이브러리의 디코더를 그대로 부른다. 규칙을 베껴 적으면
 * 두 곳이 갈라지고, 갈라지는 순간 이 관문은 통과시키면 안 되는 것을 통과시킨다.
 */
export function isReadableAuthCookieValue(value: string): boolean {
  if (!value.startsWith(BASE64_PREFIX)) return true;
  try {
    stringFromBase64URL(value.slice(BASE64_PREFIX.length));
    return true;
  } catch {
    return false;
  }
}

/**
 * 지워야 할 세션 쿠키 이름. 한 조각이라도 못 읽으면 그 키의 조각을 전부 지운다 —
 * 조각 하나만 남겨 두면 다음 요청이 또 같은 자리에서 멈춘다.
 */
export function corruptAuthCookieNames(cookies: readonly ReadableCookie[]): string[] {
  const byName = new Map(cookies.map(({ name, value }) => [name, value]));
  const keys = new Set<string>();
  for (const { name } of cookies) {
    const key = authTokenKeyOf(name);
    if (key) keys.add(key);
  }

  const corrupt: string[] = [];
  for (const key of keys) {
    const combined = combineAuthCookie(key, byName);
    if (combined === null || isReadableAuthCookieValue(combined)) continue;
    for (const { name } of cookies) {
      if (authTokenKeyOf(name) === key) corrupt.push(name);
    }
  }
  return corrupt;
}

/**
 * `createServerClient` 에 넘길 쿠키 목록. 읽을 수 없는 세션 쿠키는 빼고 준다.
 *
 * 다른 쿠키는 하나도 건드리지 않는다 — 온보딩 표식이나 체험 쿠키까지 사라지면
 * 고치려던 것보다 큰 것을 잃는다.
 */
export function withoutCorruptAuthCookies<T extends ReadableCookie>(
  cookies: readonly T[],
): T[] {
  const corrupt = new Set(corruptAuthCookieNames(cookies));
  if (corrupt.size === 0) return [...cookies];
  return cookies.filter(({ name }) => !corrupt.has(name));
}

/**
 * `Cookie` 헤더 문자열을 이름·값으로 가른다.
 *
 * 값은 `decodeURIComponent` 를 거친다 — 프레임워크가 쿠키를 읽을 때 하는 일과
 * 같아야, 여기서 "읽을 수 있다"고 본 값이 실제로 읽히는 값과 같다. 깨진 퍼센트
 * 시퀀스는 디코딩이 실패하므로 원문을 그대로 쓴다(그 값은 어차피 읽을 수 없다).
 */
export function parseCookieHeader(
  header: string | null | undefined,
): ReadableCookie[] {
  if (!header) return [];
  const cookies: ReadableCookie[] = [];
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name === "") continue;
    const raw = part.slice(separator + 1).trim();
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      // 깨진 퍼센트 시퀀스. 원문을 그대로 둔다.
    }
    cookies.push({ name, value });
  }
  return cookies;
}

/**
 * 이 요청이 **쓸 수 있는** 세션 쿠키를 내놓았는가.
 *
 * 공개 조회들은 "자격을 내놓았는데 확인에 실패한" 요청을 fail-closed 로 막는다
 * (비공개 글이 신원 미확인 요청에 새면 안 된다). 그 판정이 쿠키의 **존재**만
 * 보고 있어서, 망가진 쿠키를 든 사람은 공개 목록조차 503 을 받았다 —
 * 2026-09-02 실측: `/api/community/posts` 가 200 에서 503 으로 떨어졌다.
 *
 * 디코딩되지 않는 쿠키는 자격이 아니다. 손님과 똑같이 대한다.
 */
export function cookieHeaderHasReadableAuthCookie(
  header: string | null | undefined,
): boolean {
  const cookies = parseCookieHeader(header);
  const authCookies = cookies.filter(({ name }) => authTokenKeyOf(name) !== null);
  if (authCookies.length === 0) return false;
  return withoutCorruptAuthCookies(cookies)
    .some(({ name }) => authTokenKeyOf(name) !== null);
}
