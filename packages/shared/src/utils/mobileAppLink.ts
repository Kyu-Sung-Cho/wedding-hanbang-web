const CANONICAL_APP_LINK_PREFIX = "https://hanbang.ai/app";
const SHARE_ROUTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const MOBILE_APP_SHARE_ROUTE_CONTRACTS = {
  communityPost: {
    expoPrefix: "/community/post/",
    source: "/app/community/post/:id",
    destination: "/wedding/community/post/:id",
  },
  vendor: {
    expoPrefix: "/vendors/",
    source: "/app/vendors/:id",
    destination: "/wedding/vendors/:id",
  },
} as const;

export const MOBILE_APP_ASSOCIATION_PATHS = [
  "/app",
  ...Object.values(MOBILE_APP_SHARE_ROUTE_CONTRACTS).map(({ source }) =>
    source.replace(":id", "*")
  ),
] as const;

export type MobileAppShareTarget = {
  [Kind in keyof typeof MOBILE_APP_SHARE_ROUTE_CONTRACTS]: {
    kind: Kind;
    id: string;
  };
}[keyof typeof MOBILE_APP_SHARE_ROUTE_CONTRACTS];

function assertShareRouteId(id: string): string {
  if (!SHARE_ROUTE_ID_PATTERN.test(id)) {
    throw new TypeError("Mobile app share route id is invalid.");
  }
  return id;
}

function shareableExpoPath(suffix: string): string | null {
  for (const contract of Object.values(MOBILE_APP_SHARE_ROUTE_CONTRACTS)) {
    if (!suffix.startsWith(contract.expoPrefix)) continue;
    const id = suffix.slice(contract.expoPrefix.length);
    if (SHARE_ROUTE_ID_PATTERN.test(id)) return suffix;
  }
  return null;
}

export function createMobileAppShareUrl(target: MobileAppShareTarget): string {
  const contract = MOBILE_APP_SHARE_ROUTE_CONTRACTS[target.kind];
  return `${CANONICAL_APP_LINK_PREFIX}${contract.expoPrefix}${assertShareRouteId(target.id)}`;
}

/**
 * Rewrites the public universal-link namespace to Expo Router's actual route
 * namespace. Unknown or malformed external URLs fail closed to the app root.
 */
export function rewriteMobileAppLink(value: string): string {
  if (
    value.length === 0 ||
    value.length > 2048 ||
    /[\\\u0000-\u001f\u007f]/.test(value) ||
    value !== value.trim()
  ) {
    return "/";
  }

  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  if (value.startsWith("hanbang:")) {
    return value;
  }

  if (!value.startsWith(CANONICAL_APP_LINK_PREFIX)) {
    return "/";
  }

  const suffix = value.slice(CANONICAL_APP_LINK_PREFIX.length);
  if (suffix === "") return "/";
  if (suffix.startsWith("?") || suffix.startsWith("#")) return `/${suffix}`;
  if (!suffix.startsWith("/") || suffix.startsWith("//")) return "/";

  const metadataStart = suffix.search(/[?#]/);
  const pathname = metadataStart === -1 ? suffix : suffix.slice(0, metadataStart);
  const metadata = metadataStart === -1 ? "" : suffix.slice(metadataStart);
  const expoPath = shareableExpoPath(pathname);
  if (!expoPath) return "/";

  return `${expoPath}${metadata}`;
}
