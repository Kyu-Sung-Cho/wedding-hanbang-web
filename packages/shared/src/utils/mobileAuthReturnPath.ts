export const MOBILE_AUTH_RETURN_PATHS = [
  "/community/post/write",
  "/community/quick-review",
  "/community/my-posts",
  "/community/my-bookmarks",
] as const;

export type MobileAuthReturnPath = (typeof MOBILE_AUTH_RETURN_PATHS)[number];

const MOBILE_AUTH_RETURN_PATH_SET = new Set<string>(MOBILE_AUTH_RETURN_PATHS);

/**
 * Mobile post-login navigation is intentionally allowlisted. It accepts no
 * scheme, host, query, fragment, backslash, or encoded alternative path.
 */
export function sanitizeMobileAuthReturnPath(value: unknown): MobileAuthReturnPath | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 96) return null;
  if (value !== value.trim()) return null;
  if (/[:\\?#\u0000-\u001f\u007f]/.test(value)) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;

  return MOBILE_AUTH_RETURN_PATH_SET.has(value)
    ? (value as MobileAuthReturnPath)
    : null;
}
