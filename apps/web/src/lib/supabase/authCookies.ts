import { stringFromBase64URL } from "@supabase/ssr";

/**
 * 읽을 수 없는 Supabase 인증 쿠키를 서버 경로에서 걷어낸다.
 *
 * ## 왜 필요한가
 *
 * `@supabase/ssr` 은 세션을 `base64-<base64url>` 로 쿠키에 넣는다. 그 값을 다시 읽을
 * 때(`cookies.ts` 의 storage `getItem`) 접두사를 보고 `stringFromBase64URL` 을 **아무
 * 방어 없이** 부른다. 그 함수는 base64url 알파벳에 없는 글자나 잘린 UTF-8 시퀀스를
 * 만나면 **던진다.** 던진 예외는 `auth.getUser()` 밖으로 그대로 빠져나오므로,
 * 쿠키 하나가 상한 브라우저는 서버 Supabase 호출을 **전부** 터뜨린다.
 *
 * 2026-09-02 운영 실측(`sb-<ref>-auth-token=base64-garbage` 한 줄):
 *
 *     GET /api/community/posts            → 500 {"error":"서버 오류가 발생했습니다."}
 *     GET /api/community/posts/<uuid>     → 500 (같은 문구)
 *     GET /wedding                        → 200 이지만 본문 자리가 실패 경계
 *     GET /wedding/community/post/<uuid>  → 200 이지만 본문 자리가 실패 경계
 *     GET /wedding/lounge                 → 500 (제목 없는 빈 문서)
 *
 * 화면에는 「화면을 불러오지 못했어요」가 남고 "다시 시도하기"는 낫지 않는다 — 같은
 * 쿠키가 다음 요청에도 그대로 실려 가기 때문이다. 쿠키 없이 같은 주소를 부르면 200 이
 * 나와서, curl 로만 확인하면 서버는 멀쩡해 보인다.
 *
 * ## 무엇을 버리는가
 *
 * **디코딩이 실패하는 값만** 버린다. 살아 있는 세션은 반드시 디코딩되므로 로그인 상태를
 * 잃지 않는다. 판정에는 `@supabase/ssr` 이 실제로 쓰는 함수를 그대로 부른다 — 우리가
 * 흉내 낸 디코더를 쓰면 두 판정이 갈리는 날 다시 500 이 난다.
 */

/** `@supabase/ssr` 이 base64url 로 저장한 값에 붙이는 접두사. */
const BASE64_PREFIX = "base64-";

/** Supabase 가 만드는 쿠키 이름은 모두 이 접두사를 갖는다. */
const SUPABASE_COOKIE_PREFIX = "sb-";

/** `sb-<ref>-auth-token.0` 처럼 청크로 쪼개진 쿠키의 꼬리. */
const CHUNK_SUFFIX = /\.(?:0|[1-9][0-9]*)$/u;

export type CookieLike = { name: string; value: string };

function supabaseCookieBaseName(name: string): string | null {
  if (!name.startsWith(SUPABASE_COOKIE_PREFIX)) return null;
  return name.replace(CHUNK_SUFFIX, "");
}

/**
 * `@supabase/ssr` 의 `combineChunks` 와 같은 순서로 값을 잇는다. 통짜 쿠키가 있으면
 * 그것만 쓰고, 없을 때만 `.0` 부터 끊길 때까지 이어 붙인다 — 라이브러리가 실제로 보게
 * 될 문자열과 같아야 판정이 어긋나지 않는다.
 */
function combineChunks(
  valuesByName: ReadonlyMap<string, string>,
  key: string,
): string | null {
  const whole = valuesByName.get(key);
  if (whole) return whole;

  const parts: string[] = [];
  for (let index = 0; ; index += 1) {
    const chunk = valuesByName.get(`${key}.${index}`);
    if (!chunk) break;
    parts.push(chunk);
  }
  return parts.length > 0 ? parts.join("") : null;
}

/** 이 값을 `@supabase/ssr` 이 읽으려 할 때 던지지 않는가. */
export function isReadableSupabaseCookieValue(value: string): boolean {
  if (!value.startsWith(BASE64_PREFIX)) return true;
  try {
    stringFromBase64URL(value.slice(BASE64_PREFIX.length));
    return true;
  } catch {
    return false;
  }
}

/**
 * 이어 붙였을 때 디코딩이 안 되는 Supabase 쿠키의 이름들. 청크 하나가 상하면 같은
 * 이름의 청크 전부를 버려야 한다 — 일부만 남기면 남은 조각으로 다시 이어 붙인다.
 */
export function unreadableSupabaseCookieNames(
  cookies: readonly CookieLike[],
): Set<string> {
  const unreadable = new Set<string>();
  const valuesByName = new Map<string, string>();
  const baseNames = new Set<string>();

  for (const { name, value } of cookies) {
    const baseName = supabaseCookieBaseName(name);
    if (!baseName) continue;
    valuesByName.set(name, value);
    baseNames.add(baseName);
  }
  if (baseNames.size === 0) return unreadable;

  for (const baseName of baseNames) {
    const combined = combineChunks(valuesByName, baseName);
    if (combined === null || isReadableSupabaseCookieValue(combined)) continue;

    for (const name of valuesByName.keys()) {
      if (supabaseCookieBaseName(name) === baseName) unreadable.add(name);
    }
  }
  return unreadable;
}

/**
 * `createServerClient` 의 `getAll()` 이 돌려줄 목록. 읽을 수 없는 쿠키가 빠지면
 * Supabase 는 "세션 없음"으로 판단하고, 방문자는 로그아웃 상태로 공개 화면을 본다 —
 * 500 대신.
 */
export function withoutUnreadableSupabaseCookies<T extends CookieLike>(
  cookies: readonly T[],
): T[] {
  const unreadable = unreadableSupabaseCookieNames(cookies);
  if (unreadable.size === 0) return [...cookies];
  return cookies.filter((cookie) => !unreadable.has(cookie.name));
}

/** `sb-<ref>-auth-token` 과 그 청크. `-code-verifier` 는 세션이 아니므로 뺀다. */
const AUTH_TOKEN_COOKIE_NAME = /^sb-[^=;\s]*auth-token(?:\.\d+)?$/u;

function parseCookieHeader(header: string | null | undefined): CookieLike[] {
  if (!header) return [];

  const cookies: CookieLike[] = [];
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;

    const name = pair.slice(0, separator).trim();
    if (!name) continue;

    const raw = pair.slice(separator + 1).trim();
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      // 퍼센트 인코딩이 깨진 값은 원문 그대로 본다. 어차피 아래에서 걸러진다.
    }
    cookies.push({ name, value });
  }
  return cookies;
}

/**
 * 이 요청이 **쓸 수 있는** 인증 자격 증명을 제시했는가.
 *
 * 공개 읽기 라우트는 "자격 증명을 냈는데 확인에 실패한 요청" 만 503 으로 닫는다.
 * 그 판정을 쿠키 **이름**만으로 하면, 디코딩조차 되지 않는 쿠키를 든 브라우저가
 * 공개 글에서 503 을 받는다 — 그 쿠키는 어떤 세션도 될 수 없는데도.
 *
 * 미들웨어가 이미 그런 쿠키를 떼어 내지만(`purgeUnreadableAuthCookies`), 라우트가
 * 그 사실에 **의존해서는 안 된다.** 프록시 matcher 가 바뀌거나 라우트가 다른 경로로
 * 불리면 같은 요청이 다시 503 이 된다. 그래서 라우트 쪽에서도 같은 기준을 본다.
 *
 * 판정 기준은 세 가지다.
 *
 *   - Authorization 헤더가 있으면 **제시한 것이다** — 형식이 틀렸어도 조용히 익명으로
 *     떨어뜨리지 않는다. 그건 호출자가 의도한 신원이다.
 *   - 인증 쿠키 값이 비어 있으면 자격 증명이 아니다(로그아웃·정리 직후가 그 모양이다).
 *   - 이어 붙여도 디코딩이 안 되면 자격 증명이 아니다. **살아 있는 세션은 반드시
 *     디코딩되므로** 로그인 상태를 잃지 않는다.
 *
 * 만료·폐기된 세션처럼 **형식은 멀쩡한** 쿠키는 여전히 "제시함" 이다. 그것까지 익명으로
 * 떨어뜨리면 진짜 확인 실패를 조용히 삼키게 된다.
 */
export function hasUsableSupabaseAuthCredential(request: Request): boolean {
  if (request.headers.has("authorization")) return true;

  const cookies = parseCookieHeader(request.headers.get("cookie"));
  if (cookies.length === 0) return false;

  const unreadable = unreadableSupabaseCookieNames(cookies);
  return cookies.some(
    (cookie) =>
      AUTH_TOKEN_COOKIE_NAME.test(cookie.name)
      && cookie.value !== ""
      && !unreadable.has(cookie.name),
  );
}
