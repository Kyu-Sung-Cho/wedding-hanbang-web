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
