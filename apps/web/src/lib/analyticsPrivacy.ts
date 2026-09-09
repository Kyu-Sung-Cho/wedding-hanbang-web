/**
 * Routes that must not initialize product analytics or UTM persistence.
 * WeddingCode answers live in the share URL, so even a pageview URL would reveal them.
 *
 * `/invite` belongs here for the same reason, and the stake is higher: the couple
 * invite code is the key to a shared couple space, and it rides in the URL fragment
 * precisely so it never reaches a server log or a referrer header. A pageview event
 * carries the whole URL — fragment included — to a third party, which would undo
 * that design in one line. See packages/shared/src/contracts/coupleInviteLink.ts.
 */
const ANALYTICS_SUPPRESSED_PATH_PREFIXES = [
  "/internal/wedding-code-research",
  "/wedding-code",
  "/invite",
] as const;
const ADMIN_VENDOR_PREVIEW_PATH = "/wedding/vendors";
const COMMUNITY_PATH_PREFIXES = ["/wedding", "/community"] as const;
const COMMUNITY_ANALYTICS_QUERY_ALLOWLIST = new Set([
  "category",
  "feed",
  "page",
  "period",
  "sort",
  "source",
  "view",
]);
const PRIVATE_HANDOFF_QUERY_KEYS = new Set(["wcTasteChat", "wcTasteReview", "wcAmoraHandoff"]);
const MAX_NESTED_LOCATION_QUERY_DEPTH = 8;

type SearchParamsReader = Pick<URLSearchParams, "get">;

export function isAnalyticsSuppressedPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return ANALYTICS_SUPPRESSED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function isAnalyticsSuppressedLocation(
  pathname: string | null | undefined,
  searchParams?: SearchParamsReader | null,
): boolean {
  if (isAnalyticsSuppressedPath(pathname)) return true;
  if (
    !pathname
    || (pathname !== ADMIN_VENDOR_PREVIEW_PATH
      && !pathname.startsWith(`${ADMIN_VENDOR_PREVIEW_PATH}/`))
  ) {
    return false;
  }
  return searchParams?.get("preview") === "1";
}

/**
 * 커뮤니티 URL에는 검색어·견적 내용·글 초안이 들어올 수 있다. 페이지뷰에는 원문을
 * 보내지 않고 화면 분류에 필요한 값만 남긴다. 이벤트에도 제목·본문·검색어를 넣지 않는다.
 */
export function analyticsSafeSearchParams(
  pathname: string | null | undefined,
  searchParams?: Pick<URLSearchParams, "entries" | "toString"> | null,
): string {
  if (!searchParams) return "";
  const isCommunityPath = Boolean(
    pathname &&
      COMMUNITY_PATH_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
      ),
  );
  if (!isCommunityPath) return safeHandoffSearchParams(searchParams).toString();

  const safe = new URLSearchParams();
  for (const [key, value] of safeHandoffSearchParams(searchParams).entries()) {
    if (COMMUNITY_ANALYTICS_QUERY_ALLOWLIST.has(key)) safe.append(key, value);
  }
  return safe.toString();
}

type AnalyticsCapture = {
  properties?: Record<string, unknown>;
} | null;

/** 주소처럼 생긴 값인가. 경로(`/...`)와 절대 URL만 URL 속성으로 본다. */
function looksLikeLocationValue(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  return value.startsWith("/") || /^https?:\/\//i.test(value);
}

function safeHandoffSearchParams(
  params: Pick<URLSearchParams, "entries">,
  depth = 0,
): URLSearchParams {
  const safe = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (PRIVATE_HANDOFF_QUERY_KEYS.has(key)) continue;
    safe.append(key, looksLikeLocationValue(value) ? stripLocationSecrets(value, depth + 1) : value);
  }
  return safe;
}

/** 로그인 redirect 안의 URL도 정리하되 실제 이동 주소는 변경하지 않는다. */
function stripLocationSecrets(value: string, depth = 0): string {
  const hashIndex = value.indexOf("#");
  const withoutFragment = hashIndex < 0 ? value : value.slice(0, hashIndex);
  const queryIndex = withoutFragment.indexOf("?");
  if (queryIndex < 0) return withoutFragment;
  const prefix = withoutFragment.slice(0, queryIndex);
  // 비정상적으로 깊게 중첩된 URL은 그 지점의 경로만 분석에 남긴다.
  if (depth >= MAX_NESTED_LOCATION_QUERY_DEPTH) return prefix;
  const original = new URLSearchParams(withoutFragment.slice(queryIndex + 1));
  const safe = safeHandoffSearchParams(original, depth);
  if (safe.toString() === original.toString()) return withoutFragment;
  return prefix + (safe.size ? `?${safe.toString()}` : "");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * 주소처럼 생긴 값이면 `#` 뒤를 잘라낸다. 아니면 받은 값을 그대로 돌려준다.
 *
 * 중첩까지 훑는 이유: posthog는 첫 방문 주소를 `$set_once.$initial_current_url`처럼
 * **한 겹 안쪽**에 실어 보낸다. 겉만 훑으면 그 자리에 프래그먼트가 그대로 남는다.
 * 바뀐 것이 없으면 같은 객체를 그대로 돌려준다 — 필요 없는 복사를 만들지 않는다.
 */
function stripLocationFragment(value: unknown): unknown {
  if (looksLikeLocationValue(value)) return stripLocationSecrets(value);
  if (!Array.isArray(value) && !isPlainObject(value)) return value;

  type Container = Record<string, unknown> | unknown[];
  const copyOf = (source: Container): Container => Array.isArray(source) ? new Array<unknown>(source.length) : {};
  const root = copyOf(value);
  const copies = new Map<Container, Container>([[value, root]]);
  const pending: [Container, Container][] = [[value, root]];
  let changed = false;

  // 깊은 initial/referrer 속성과 순환 객체도 재귀 호출이나 깊이 우회 없이 훑는다.
  while (pending.length > 0) {
    const [source, target] = pending.pop()!;
    for (const [key, item] of Object.entries(source)) {
      let next = item;
      if (looksLikeLocationValue(item)) {
        next = stripLocationSecrets(item);
        if (next !== item) changed = true;
      } else if (Array.isArray(item) || isPlainObject(item)) {
        let copy = copies.get(item);
        if (!copy) {
          copy = copyOf(item);
          copies.set(item, copy);
          pending.push([item, copy]);
        }
        next = copy;
      }
      if (Array.isArray(target)) target[Number(key)] = next;
      else target[key] = next;
    }
  }
  return changed ? root : value;
}

function pathnameFromLocationValue(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (!value.startsWith("/") && !/^https?:\/\//i.test(value)) return null;
  try {
    return new URL(value, "https://hanbang.invalid").pathname;
  } catch {
    return null;
  }
}

/**
 * 전송되는 URL 속성에서 프래그먼트(`#` 뒤)를 잘라낸다.
 *
 * ## 왜 필요한가
 *
 * 커플 초대 코드는 `#` 뒤에 실려 다닌다 — 서버 로그·리퍼러에 남지 않게 하려는 설계다
 * (`packages/shared/src/contracts/coupleInviteLink.ts`). 그런데 posthog-js는
 * `capture_pageleave`를 켜면 `$current_url`에 `location.href`를 **자기가** 넣는다.
 * 위의 억제 목록은 경로만 비교하므로, 프래그먼트를 달고 다른 경로로 넘어간 순간
 * 열쇠가 그대로 제3자에게 실려 나간다.
 *
 * ## 왜 경로를 억제 목록에 더 넣지 않는가
 *
 * 그 길목은 `/login` — 가입 퍼널의 핵심 페이지다. 통째로 끄면 파운더가 보던 지표가
 * 사라진다. 프래그먼트만 잘라내면 어느 화면을 봤는지는 그대로 남고 열쇠만 사라진다.
 *
 * 값이 주소처럼 생겼을 때만 손댄다. 사람이 쓴 글에 들어간 `#`를 잘라내면 그건 다른
 * 데이터를 망가뜨리는 일이다.
 */
export function stripAnalyticsUrlFragments<
  T extends { properties?: Record<string, unknown> } | null,
>(capture: T): T {
  if (!capture?.properties) return capture;

  let changed = false;
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(capture.properties)) {
    const stripped = stripLocationFragment(value);
    if (stripped !== value) changed = true;
    properties[key] = stripped;
  }
  if (!changed) return capture;

  return { ...capture, properties } as T;
}

/**
 * PostHog may already be initialized before a client-side navigation reaches a suppressed route.
 * This final send boundary drops both events created on that route and delayed events whose URL
 * properties still point at it.
 */
export function analyticsCaptureTouchesSuppressedPath(
  capture: AnalyticsCapture,
  currentPathname?: string | null,
): boolean {
  if (isAnalyticsSuppressedPath(currentPathname)) return true;
  if (!capture?.properties) return false;

  for (const value of Object.values(capture.properties)) {
    const pathname = pathnameFromLocationValue(value);
    if (pathname && isAnalyticsSuppressedPath(pathname)) return true;
  }
  return false;
}
