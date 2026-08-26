/**
 * 오류 리포트에 붙일 배포 환경 이름을 정한다.
 *
 * ## 왜 필요한가
 *
 * 예전에는 세 런타임 모두 `environment: process.env.NODE_ENV` 였다. 그런데
 * **Vercel 은 프리뷰도 `NODE_ENV=production` 으로 빌드하고**,
 * `NEXT_PUBLIC_SENTRY_DSN` 은 Preview·Production 양쪽에 켜져 있다(2026-08-26
 * `vercel env ls` 실측). 그래서 브랜치 배포에서 나는 오류가 운영 오류와 똑같이
 * `production` 으로 찍혔다 — 알림을 켜면 새벽에 깨워 놓고 알고 보니 방금 올린
 * 프리뷰인 상황이 된다.
 *
 * ## 왜 호스트까지 보나
 *
 * 서버에서는 `VERCEL_ENV` 를 그냥 읽으면 된다(이미 6곳이 쓴다). 브라우저에서는
 * `NEXT_PUBLIC_VERCEL_ENV` 가 필요한데, 그건 Vercel 의 "시스템 환경변수 자동 노출"
 * 설정이 켜져 있을 때만 온다. 그 설정을 저장소에서 확인할 방법이 없어서
 * **없을 때는 호스트로 한 번 더 가른다.** 둘 중 하나는 반드시 맞는다.
 *
 * 모르는 호스트는 `nodeEnv` 로 떨어뜨린다 — 옛 동작과 같으므로 최악이어도
 * 지금보다 나빠지지 않는다.
 */

/** 운영으로 서비스되는 호스트. 여기 없는 커스텀 도메인을 붙이면 함께 넣을 것. */
const PRODUCTION_HOSTS = new Set(["hanbang.ai", "www.hanbang.ai"]);

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

/** Vercel 프리뷰 배포의 기본 도메인. */
const PREVIEW_HOST_SUFFIX = ".vercel.app";

export function resolveDeploymentEnvironment(input: {
  /** 서버는 `VERCEL_ENV`, 브라우저는 `NEXT_PUBLIC_VERCEL_ENV`. */
  vercelEnv?: string | null;
  /** 브라우저에서만 있다. `window.location.hostname`. */
  hostname?: string | null;
  nodeEnv?: string | null;
}): string {
  // Vercel 이 알려주면 그게 정답이다 — production | preview | development.
  const fromVercel = input.vercelEnv?.trim();
  if (fromVercel) return fromVercel;

  const host = input.hostname?.trim().toLowerCase() ?? "";
  if (host) {
    if (PRODUCTION_HOSTS.has(host)) return "production";
    if (host.endsWith(PREVIEW_HOST_SUFFIX)) return "preview";
    if (LOCAL_HOSTS.has(host)) return "development";
  }

  return input.nodeEnv?.trim() || "unknown";
}
