/**
 * SessionStorage 기반 TTL 캐시.
 * 페이지 navigation으로 컴포넌트가 remount돼도 같은 세션 안에선 재요청 안 함.
 *
 * 용도: 카테고리/필터/사이드바 위젯처럼 "URL은 바뀌어도 데이터는 동일"한 fetch.
 */
export async function withSessionCache<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  if (typeof window === "undefined") return fetcher();
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as { data: T; ts: number };
      if (Date.now() - parsed.ts < ttlMs) return parsed.data;
    }
  } catch {
    /* JSON 파싱 실패 — 무시하고 fresh fetch */
  }
  const fresh = await fetcher();
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({ data: fresh, ts: Date.now() })
    );
  } catch {
    /* QuotaExceeded 등 — 무시 */
  }
  return fresh;
}

/** 캐시 강제 무효화 (필요 시) */
export function invalidateSessionCache(key: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
