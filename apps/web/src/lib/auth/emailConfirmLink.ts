/**
 * 메일로 나가는 인증 링크를 **우리 주소로** 만든다.
 *
 * ## 왜 Supabase 가 준 action_link 를 쓰지 않는가
 *
 * `admin.generateLink()` 가 돌려주는 `action_link` 는 GoTrue 의
 * `auth/v1/verify?token=…` 를 가리킨다. 그 토큰에는 PKCE 접두사(`pkce_`)가 없고,
 * GoTrue 는 접두사 없는 토큰을 **implicit 플로우**로 처리해 결과를
 * `#access_token=…` **해시**로 돌려준다. 2026-08-22 운영 실측:
 *
 *   token=notarealtoken000       -> Location: …/api/auth/callback#error=…   (해시)
 *   token=pkce_notarealtoken000  -> Location: …/api/auth/callback?error=…   (쿼리)
 *
 * **해시는 서버로 전송되지 않는다.** 그래서 서버 콜백의 `searchParams.get("code")`
 * 는 언제나 null 이었고, 가입 인증 메일을 누른 사람은 전원 `/login?error=no_code`
 * 로 떨어졌다 — 계정은 인증됐는데 화면은 붉은 오류를 보여줬다.
 *
 * 브라우저에서 그 해시를 주울 수도 없었다. `@supabase/ssr` 의 createBrowserClient 가
 * `flowType:"pkce"` 를 `...options?.auth` **뒤에** 박아 앱이 덮어쓸 수 없고
 * (createBrowserClient.js:34,38), auth-js 는 implicit 해시를 만나면 세션을 만들기
 * 전에 `Not a valid PKCE flow url.` 을 던진다. 비밀번호 재설정 화면이 "인증 확인 중"
 * 에서 영원히 멈춘 것도 같은 뿌리다.
 *
 * 그래서 링크를 우리가 만든다. `generateLink` 는 `properties.hashed_token` 을 함께
 * 주므로 그것을 우리 라우트로 넘겨 **서버에서** `verifyOtp({ token_hash, type })`
 * 로 세션을 세운다. 서버가 쿠키를 굽기 때문에 플로우 타입이 끼어들 자리가 없다.
 *
 * ⚠️ 다시 `action_link` 를 쓰고 싶어지면 위 실측을 먼저 재현해 보라. 그 링크는
 * 지금도 **성공한 인증을 실패 화면으로** 끝낸다.
 */

/** 우리가 세션을 세우는 자리. */
export const EMAIL_CONFIRM_PATH = "/api/auth/confirm";

/**
 * 이 라우트가 받아 주는 인증 종류.
 *
 * 목록을 좁게 유지한다 — 임의 문자열을 verifyOtp 에 넘기면 우리가 만들지 않은
 * 흐름까지 이 문으로 들어온다.
 */
export const EMAIL_CONFIRM_TYPES = ["signup", "recovery", "invite", "email_change"] as const;

export type EmailConfirmType = (typeof EMAIL_CONFIRM_TYPES)[number];

export function isEmailConfirmType(value: unknown): value is EmailConfirmType {
  return typeof value === "string"
    && (EMAIL_CONFIRM_TYPES as readonly string[]).includes(value);
}

/**
 * 메일 버튼에 넣을 절대 URL.
 *
 * `redirectPath` 는 여기서 검사하지 않는다 — 받는 쪽(라우트)이 경계에서 다시
 * 검사한다. 링크는 메일함을 거쳐 오므로 만든 값이 그대로 온다고 믿지 않는다.
 */
export function buildEmailConfirmUrl({
  siteUrl,
  tokenHash,
  type,
  redirectPath,
}: {
  siteUrl: string;
  tokenHash: string;
  type: EmailConfirmType;
  redirectPath?: string | null;
}): string {
  const url = new URL(EMAIL_CONFIRM_PATH, siteUrl);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type);
  if (redirectPath) url.searchParams.set("redirect", redirectPath);
  return url.toString();
}
