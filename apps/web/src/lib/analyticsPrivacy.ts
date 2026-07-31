/**
 * Routes that must not initialize product analytics or UTM persistence.
 * WeddingCode answers live in the share URL, so even a pageview URL would reveal them.
 */
const ANALYTICS_SUPPRESSED_PATH_PREFIXES = [
  "/internal/wedding-code-research",
  "/wedding-code",
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
  if (!isCommunityPath) return searchParams.toString();

  const safe = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    if (COMMUNITY_ANALYTICS_QUERY_ALLOWLIST.has(key)) safe.append(key, value);
  }
  return safe.toString();
}

type AnalyticsCapture = {
  properties?: Record<string, unknown>;
} | null;

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
