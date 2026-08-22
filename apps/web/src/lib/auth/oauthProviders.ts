/**
 * 웹에서 어떤 소셜 로그인 버튼을 보여줄지.
 *
 * ## 왜 필요한가
 *
 * 2026-08-22 운영 실측: Supabase 의 authorize 엔드포인트가 provider 별로 이렇게
 * 답한다.
 *
 *   kakao  -> 400  {"msg":"Unsupported provider: provider is not enabled"}
 *   google -> 302
 *   apple  -> 302
 *
 * 그런데 웹 로그인 화면은 셋을 **조건 없이** 렌더했고, 카카오가 첫 자리였다.
 * 한국 사용자가 가장 먼저 손이 가는 버튼에서 "소셜 로그인 오류"를 받는다.
 *
 * 모바일은 이미 같은 문제를 `isOAuthProviderEnabled`(src/lib/auth.ts)로 풀어 뒀고
 * 그 주석이 이유를 적어 놨다 — **"눌러도 동작하지 않는 버튼은 없는 것보다 나쁘다."**
 * 웹만 그 규칙을 안 따르고 있었다. 새 정책이 아니라 있는 규칙을 옮기는 것이다.
 *
 * ## 기본값을 provider 마다 다르게 두는 이유
 *
 * "전부 기본 꺼짐"으로 하면 환경변수를 안 넣은 순간 **지금 잘 되는 Google·Apple
 * 까지 사라진다.** 그건 고치려던 문제보다 큰 회귀다. 그래서 운영에서 실제로
 * 동작이 확인된 것은 기본 켜짐, 꺼져 있는 것으로 확인된 카카오만 기본 꺼짐이다.
 *
 * 카카오를 켜는 날 바꿀 값은 `NEXT_PUBLIC_KAKAO_OAUTH_ENABLED=true` 하나지만,
 * **값만 바꿔서는 반영되지 않는다.** 아래 readFlag() 주석처럼 이 값은 빌드
 * 시점에 번들로 박히고, 이 프로젝트는 env 변경으로 재빌드가 걸리지 않는다 —
 * 새 배포가 나가야 버튼이 돌아온다. turbo 의 globalEnv/build.env 에도 등록돼
 * 있어야 빌드가 그 값을 본다(turbo.json).
 * 반대로 Google·Apple 이 운영에서 꺼지면 `=false` 로 즉시 숨길 수 있다.
 */

export type WebOAuthProvider = "kakao" | "google" | "apple";

/** 화면에 그리는 순서. 켜진 것만 남는다. */
export const WEB_OAUTH_PROVIDERS: readonly WebOAuthProvider[] = [
  "kakao",
  "google",
  "apple",
];

/**
 * 명시적으로 켜야만 보이는 provider.
 *
 * 여기 있는 것은 **운영에서 꺼져 있음이 확인된** 것이다. 추측으로 넣지 않는다 —
 * 잘 되는 버튼을 숨기면 그게 더 큰 손해다.
 */
const OFF_UNTIL_EXPLICITLY_ENABLED: ReadonlySet<WebOAuthProvider> = new Set(["kakao"]);

function readFlag(provider: WebOAuthProvider): string | undefined {
  // Next 는 빌드 시점에 이 접근을 정적 치환한다. 동적 키(`process.env[name]`)로
  // 읽으면 치환되지 않아 브라우저에서 항상 undefined 가 된다.
  switch (provider) {
    case "kakao":
      return process.env.NEXT_PUBLIC_KAKAO_OAUTH_ENABLED;
    case "google":
      return process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED;
    case "apple":
      return process.env.NEXT_PUBLIC_APPLE_OAUTH_ENABLED;
  }
}

export function isWebOAuthProviderEnabled(provider: WebOAuthProvider): boolean {
  const flag = readFlag(provider);
  if (OFF_UNTIL_EXPLICITLY_ENABLED.has(provider)) return flag === "true";
  // 운영에서 동작이 확인된 provider 는 기본 켜짐. 끄고 싶을 때만 "false".
  return flag !== "false";
}

export function enabledWebOAuthProviders(): readonly WebOAuthProvider[] {
  return WEB_OAUTH_PROVIDERS.filter(isWebOAuthProviderEnabled);
}

/** 소셜 로그인 자리를 통째로 감출지 — 켜진 provider 가 하나도 없으면 감춘다. */
export function hasAnyWebOAuthProvider(): boolean {
  return enabledWebOAuthProviders().length > 0;
}
