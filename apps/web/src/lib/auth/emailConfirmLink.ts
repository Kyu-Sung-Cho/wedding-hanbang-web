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

import { signEmailConfirm } from "./emailConfirmSignature";

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
 * 링크가 살아 있는 시간. **우리가 정하고 우리가 검사한다.**
 *
 * 전에는 아무것도 검사하지 않고 Supabase 의 만료 설정에 전적으로 기댔다. 그
 * 값은 대시보드에서 바뀔 수 있고 코드에서 읽을 수도 없는데, 재설정 메일은
 * "이 링크는 24시간 동안 유효합니다"라고 **단정**하고 있었다. 그 문장이 참인지
 * 아무도 확인할 수 없는 상태였다.
 *
 * 종류마다 값이 다른 이유: 재설정 링크는 그 자체로 계정 접근 수단이라 짧아야
 * 하고, 가입 확인은 위험이 낮고 사람들이 메일을 나중에 여는 일이 흔하다.
 *
 * Supabase 쪽 만료도 그대로 살아 있다 — **둘 중 짧은 쪽이 이긴다.**
 */
export const EMAIL_CONFIRM_TTL_SECONDS: Readonly<Record<EmailConfirmType, number>> = {
  recovery: 60 * 60,
  signup: 24 * 60 * 60,
  invite: 24 * 60 * 60,
  email_change: 24 * 60 * 60,
};

/** 메일 본문에 쓸 유효시간 문구. 상수에서 만들어 문구와 실제가 갈라지지 않게 한다. */
export function describeEmailConfirmTtl(type: EmailConfirmType): string {
  const seconds = EMAIL_CONFIRM_TTL_SECONDS[type];
  const hours = Math.round(seconds / 3600);
  return hours === 1 ? "1시간" : `${hours}시간`;
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
  nowMs = Date.now(),
}: {
  siteUrl: string;
  tokenHash: string;
  type: EmailConfirmType;
  redirectPath?: string | null;
  /** 테스트가 시계를 고정할 수 있게 열어 둔다. */
  nowMs?: number;
}): string {
  const url = new URL(EMAIL_CONFIRM_PATH, siteUrl);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type);
  if (redirectPath) url.searchParams.set("redirect", redirectPath);

  // 만료 시각을 싣고 서명한다. 서명이 없으면 exp 를 늘려 붙이는 것만으로
  // 링크를 영원히 살릴 수 있다.
  const expiresAt = Math.floor(nowMs / 1000) + EMAIL_CONFIRM_TTL_SECONDS[type];
  const signature = signEmailConfirm(tokenHash, type, expiresAt);
  if (signature) {
    url.searchParams.set("exp", String(expiresAt));
    url.searchParams.set("sig", signature);
  }
  return url.toString();
}
