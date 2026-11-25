export const WEDDING_BASE_PATH = "/wedding";

const EXTERNAL_PATH_RE = /^(?:[a-z][a-z0-9+.-]*:|#)/i;

/*
 * 2026-11-22 커뮤니티를 닫기 전까지 `/wedding` 자체가 커뮤니티 피드였다(`next.config.ts` 가
 * `/community` 로 리라이트). 그래서 `weddingPath()` 와 `weddingPath("/community")` 가 둘 다 피드
 * 링크였고, 아래 두 함수에 `/community` 짝이 박혀 있었다.
 *
 * 지금 `/wedding` 은 로그인했으면 라운지, 아니면 랜딩으로 보내는 문이다(`app/wedding/page.tsx`).
 * 커뮤니티 주소는 다른 앱 주소처럼 `/wedding/community/…` 가 되고, 거기서 '닫았어요' 화면이 그려진다.
 */

/** 앱 화면 주소(`/lounge`)를 보이는 주소(`/wedding/lounge`)로 바꾼다. 빈 값은 `/wedding` 문이다. */
export function weddingPath(path = ""): string {
  if (!path || path === "/") return WEDDING_BASE_PATH;
  if (EXTERNAL_PATH_RE.test(path)) return path;
  if (
    path === WEDDING_BASE_PATH ||
    path.startsWith(`${WEDDING_BASE_PATH}/`) ||
    path.startsWith(`${WEDDING_BASE_PATH}?`) ||
    path.startsWith(`${WEDDING_BASE_PATH}#`)
  ) {
    return path;
  }

  return `${WEDDING_BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}

/** 보이는 주소에서 `/wedding` 을 떼어 앱 화면 주소를 얻는다. `/wedding` 문 자체는 그대로 둔다. */
export function stripWeddingBasePath(pathname: string): string {
  if (pathname === `${WEDDING_BASE_PATH}/`) return WEDDING_BASE_PATH;
  if (pathname.startsWith(`${WEDDING_BASE_PATH}/`)) {
    return pathname.slice(WEDDING_BASE_PATH.length);
  }

  return pathname;
}

export function weddingRoutePath(path = ""): string {
  const visiblePath = weddingPath(path);
  if (EXTERNAL_PATH_RE.test(visiblePath)) return visiblePath;
  return stripWeddingBasePath(visiblePath);
}

export function weddingLinkProps(path = ""): { href: string; as?: string; prefetch?: false } {
  const href = weddingRoutePath(path);
  const as = weddingPath(path);
  return href === as ? { href } : { href, as, prefetch: false };
}

export function isWeddingPathActive(currentPathname: string, legacyPath: string): boolean {
  const currentPath = stripWeddingBasePath(currentPathname);
  return currentPath === legacyPath || currentPath.startsWith(`${legacyPath}/`);
}
