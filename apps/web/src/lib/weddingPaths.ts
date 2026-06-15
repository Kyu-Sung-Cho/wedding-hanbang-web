export const WEDDING_BASE_PATH = "/wedding";

const EXTERNAL_PATH_RE = /^(?:[a-z][a-z0-9+.-]*:|#)/i;

export function weddingPath(path = ""): string {
  if (!path || path === "/") return WEDDING_BASE_PATH;
  if (EXTERNAL_PATH_RE.test(path)) return path;
  if (path === WEDDING_BASE_PATH || path.startsWith(`${WEDDING_BASE_PATH}/`)) {
    return path;
  }
  if (path === "/community") return WEDDING_BASE_PATH;
  if (path.startsWith("/community?") || path.startsWith("/community#")) {
    return `${WEDDING_BASE_PATH}${path.slice("/community".length)}`;
  }

  return `${WEDDING_BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}

export function stripWeddingBasePath(pathname: string): string {
  if (pathname === WEDDING_BASE_PATH || pathname === `${WEDDING_BASE_PATH}/`) {
    return "/community";
  }

  if (pathname.startsWith(`${WEDDING_BASE_PATH}?`) || pathname.startsWith(`${WEDDING_BASE_PATH}#`)) {
    return `/community${pathname.slice(WEDDING_BASE_PATH.length)}`;
  }

  if (pathname.startsWith(`${WEDDING_BASE_PATH}/`)) {
    return pathname.slice(WEDDING_BASE_PATH.length) || "/community";
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

  if (legacyPath === "/community") {
    return currentPath === "/community";
  }

  return currentPath === legacyPath || currentPath.startsWith(`${legacyPath}/`);
}
