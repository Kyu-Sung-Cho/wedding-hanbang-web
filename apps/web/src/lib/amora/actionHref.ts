const LINK_BASE = "https://hanbang.ai";

export class InvalidAmoraActionHrefError extends Error {
  readonly code = "22023";
  constructor() { super("Amora action href must be a safe relative path"); }
}

export function isSafeAmoraActionHref(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")
    || /[\\\u0000-\u001f\u007f]/.test(value) || [...value].length > 180) return false;
  try { return new URL(value, LINK_BASE).origin === LINK_BASE; } catch { return false; }
}

/** 입력의 빈 값/null은 명시적 링크 해제다. 잘못된 링크는 조용히 해제하지 않는다. */
export function parseAmoraActionHref(value: unknown): { ok: true; href: string | null } | { ok: false } {
  if (value == null || value === "") return { ok: true, href: null };
  if (typeof value !== "string" || /[\\\u0000-\u001f\u007f]/.test(value)) return { ok: false };
  const href = value.trim();
  if (!href) return { ok: true, href: null };
  return isSafeAmoraActionHref(href) ? { ok: true, href } : { ok: false };
}
