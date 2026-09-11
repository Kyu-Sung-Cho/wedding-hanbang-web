import { type SignupConsentAccess } from "@hanbang/shared";

/**
 * 동의 관문이 **루트에만** 있어서 딥링크가 지나쳐 가던 것을 막는다.
 *
 * ## 무엇이 있었나
 *
 * 동의 판정(`rootDestination.ts`)은 `app/index.tsx` 하나에서만 돌았다. 그런데
 * 앱에 들어오는 문은 그것 말고도 둘 더 있다.
 *
 *   1. 알림 탭 — `notifications.ts` 가 `/community/post/[id]` 로 곧장 push 한다.
 *      콜드 스타트도 포함된다(`getLastNotificationResponseAsync`).
 *   2. 유니버설 링크 — `app.json` 에 `scheme`·`associatedDomains`·https
 *      `intentFilters` 가 있어 웹 주소가 앱의 해당 라우트를 직접 연다.
 *
 * 도착 화면에는 관문이 없다. `(tabs)/_layout.tsx` 는 세션만 보고 동의는 보지
 * 않으며, `community/post/[id].tsx` 는 세션을 **소유권 확인에만** 쓴다.
 *
 * 서버도 막지 않는다. 동의를 요구하는 API 는 `/api/onboarding` 하나뿐이고
 * `/api/community/comments` 는 요구하지 않는다. 그래서 **약관에 동의한 적 없는
 * 계정이 커뮤니티에 글을 쓸 수 있었다.**
 *
 * 해당 인구가 좁지 않다. 동의 수집은 2026-08-22 에 들어왔고
 * (`SIGNUP_CONSENT_INTRODUCED_AT`), 그 전에 만들어진 계정은 **전부** 동의 기록이
 * 없다.
 *
 * ## 어디까지만 막는가
 *
 * 로그인·가입·비밀번호 찾기·동의 화면 자체는 지나가야 한다. 막으면 동의할
 * 방법이 사라지고 무한 루프가 된다.
 *
 * 초대 착지(`/invite`)도 지나보낸다. 이 화면은 코드만 꺼내 기억하고 곧바로
 * 루트나 로그인으로 넘긴다 — 여기서 가로채면 초대 코드를 잃고, 어차피 다음
 * 자리인 루트에서 관문에 걸린다.
 *
 * ## 모르면 가로채지 않는다
 *
 * 세션을 아직 못 읽었으면 `null` 을 넘긴다. 그 상태에서 가로채면 켤 때마다
 * 동의 화면이 번쩍이고, 조회가 실패하는 사람은 앱에서 나갈 길이 없다.
 * 로그아웃 상태도 가로채지 않는다 — 그건 로그인 관문이 할 일이다.
 */

/**
 * 지나보낼 경로.
 *
 * `usePathname()` 은 **그룹 세그먼트를 지운 값**을 준다 — `app/(auth)/login.tsx`
 * 는 `/login` 이지 `/(auth)/login` 이 아니다(`(tabs)/_layout.tsx` 가 `/community`
 * 로 비교하는 것과 같다). 이동할 때 쓰는 `href` 는 `/(auth)/login` 형태라 서로
 * 다르니 섞지 않는다.
 */
export const CONSENT_INTERCEPTION_EXEMPT_PATHS: readonly string[] = Object.freeze([
  "/login",
  "/signup",
  "/forgot-password",
  "/consent",
  "/invite",
]);

/** 동의를 받는 화면. 가로챈 사람을 여기로 보낸다. */
export const MOBILE_CONSENT_ROUTE = "/(auth)/consent";

export type ConsentInterceptionInput = Readonly<{
  /** `usePathname()` 값. 아직 모르면 `null`. */
  pathname: string | null;
  /** 세션. 아직 못 읽었으면 `null` — 그때는 가로채지 않는다. */
  session: { user: { user_metadata?: unknown } } | null;
  consentAccess?: SignupConsentAccess;
}>;

export function shouldInterceptForConsent(input: ConsentInterceptionInput): boolean {
  // 세션을 모르는 동안에는 손대지 않는다. 로그아웃도 여기서 다루지 않는다.
  if (!input.session) return false;

  // 이미 동의한 사람은 그대로 간다.
  if ((input.consentAccess === "server_verified" || input.consentAccess === "legacy_unverified")) return false;

  // 경로를 모르면 판단하지 않는다. 잘못 가로채면 동의 화면에 갇힌다.
  if (typeof input.pathname !== "string" || input.pathname.length === 0) return false;

  // 쿼리·해시가 붙어 와도 같은 화면이다. `/invite#WH-...` 가 실제로 그렇다.
  const path = input.pathname.split(/[?#]/u)[0];
  if (CONSENT_INTERCEPTION_EXEMPT_PATHS.includes(path)) return false;

  return true;
}
