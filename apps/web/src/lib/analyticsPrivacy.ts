import { isPreviewStubMode } from "@/lib/previewStub";

/**
 * Routes that must not initialize product analytics or UTM persistence.
 * Keep this list narrow: these pages make an explicit zero-I/O research promise.
 */
const ANALYTICS_SUPPRESSED_PATH_PREFIXES = [
  "/internal/wedding-code-research",
  // 답 16개가 공유 URL에 들어간다. 명시적 이벤트를 포함해 이 화면에서는
  // 제품 분석 SDK를 시작하지 않아야 한다.
  "/wedding-code",
] as const;
const ADMIN_VENDOR_PREVIEW_PATH = "/wedding/vendors";

// Third-party analytics stays fail-closed until the product has shown the
// current notice and the visitor has made an explicit choice. Versioning the
// key prevents a stale grant from silently surviving a materially changed
// processor/purpose disclosure.
export const THIRD_PARTY_ANALYTICS_CONSENT_VERSION = "2026-08-02" as const;
export const THIRD_PARTY_ANALYTICS_CONSENT_KEY =
  `hanbang.third-party-analytics.${THIRD_PARTY_ANALYTICS_CONSENT_VERSION}` as const;
const ANALYTICS_CONSENT_GRANTED = "granted";

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

/** Honor browser-level opt-out signals before an analytics request is queued. */
export function isBrowserTrackingOptOut(): boolean {
  if (typeof navigator === "undefined") return false;
  const privacyNavigator = navigator as Navigator & {
    globalPrivacyControl?: boolean;
    msDoNotTrack?: string;
  };
  const dnt = privacyNavigator.doNotTrack ?? privacyNavigator.msDoNotTrack;
  return dnt === "1" || dnt === "yes" || privacyNavigator.globalPrivacyControl === true;
}

/**
 * A deploy flag alone is never consent. Both an exact, intentionally enabled
 * runtime and the current browser-side grant are required before loading a
 * third-party analytics SDK or sending an event.
 */
export function hasExplicitThirdPartyAnalyticsConsent(): boolean {
  if (isPreviewStubMode()) return false;
  if (process.env.NEXT_PUBLIC_POSTHOG_ENABLED !== "true") return false;
  if (typeof window === "undefined" || isBrowserTrackingOptOut()) return false;

  try {
    return window.localStorage.getItem(THIRD_PARTY_ANALYTICS_CONSENT_KEY)
      === ANALYTICS_CONSENT_GRANTED;
  } catch {
    return false;
  }
}
