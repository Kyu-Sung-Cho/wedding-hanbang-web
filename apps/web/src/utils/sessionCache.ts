/**
 * Actor-scoped session cache.
 *
 * Community responses can contain the current member's own or under-review
 * content. A cache entry and an in-flight fetch therefore belong to exactly
 * one verified browser actor and must never survive an actor transition.
 */

type SessionCacheStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">
  & Partial<Pick<Storage, "key" | "length">>;

const SESSION_CACHE_PREFIX = "hanbang:session-cache:v2:";

let activeActorKey: string | null = null;
let sessionCacheEpoch = 0;
const inFlightControllers = new Set<AbortController>();

function browserSessionStorage(): SessionCacheStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function abortInFlightRequests(): void {
  for (const controller of inFlightControllers) controller.abort();
  inFlightControllers.clear();
}

function removeScopedEntries(storage: SessionCacheStorage | null, actorKey?: string): void {
  if (!storage || typeof storage.key !== "function" || typeof storage.length !== "number") return;
  const actorPrefix = actorKey
    ? `${SESSION_CACHE_PREFIX}${encodeURIComponent(actorKey)}:`
    : SESSION_CACHE_PREFIX;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(actorPrefix)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

export function sessionCacheStorageKey(key: string, actorKey: string): string {
  return `${SESSION_CACHE_PREFIX}${encodeURIComponent(actorKey)}:${encodeURIComponent(key)}`;
}

/**
 * Bind subsequent cache work to an actor. Changing actors invalidates every
 * pending generation before the new actor can read or write cache state.
 */
export function activateSessionCacheActor(
  actorKey: string,
  storage: SessionCacheStorage | null = browserSessionStorage(),
): number {
  if (!actorKey) throw new Error("SESSION_CACHE_ACTOR_REQUIRED");
  if (activeActorKey === actorKey) return sessionCacheEpoch;

  sessionCacheEpoch += 1;
  abortInFlightRequests();
  activeActorKey = actorKey;

  // Old releases wrote unscoped entries under the caller-provided key.
  // Callers remove their own legacy key before reading; stale v2 entries for
  // other actors remain unreadable because actor identity is in the key.
  void storage;
  return sessionCacheEpoch;
}

/** Abort pending cache fills and purge actor-scoped entries on logout/switch. */
export function clearSessionCacheClientState(
  actorKey?: string,
  storage: SessionCacheStorage | null = browserSessionStorage(),
): void {
  sessionCacheEpoch += 1;
  abortInFlightRequests();
  activeActorKey = null;
  // A logout/account switch is a privacy boundary. Purging all scoped cache
  // entries avoids retaining a previous member's private titles in this tab.
  removeScopedEntries(storage, actorKey);
  if (!actorKey) removeScopedEntries(storage);
}

export async function withSessionCache<T>(
  key: string,
  ttlMs: number,
  actorKey: string,
  fetcher: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!actorKey) throw new Error("SESSION_CACHE_ACTOR_REQUIRED");
  if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new Error("SESSION_CACHE_TTL_INVALID");
  if (typeof window === "undefined") {
    return fetcher(new AbortController().signal);
  }

  const storage = browserSessionStorage();
  const epoch = activateSessionCacheActor(actorKey, storage);
  const scopedKey = sessionCacheStorageKey(key, actorKey);

  try {
    // Never restore the legacy account-unbound cache.
    storage?.removeItem(key);
    const raw = storage?.getItem(scopedKey);
    if (raw) {
      const parsed = JSON.parse(raw) as { data: T; ts: number };
      if (Number.isFinite(parsed.ts) && Date.now() - parsed.ts < ttlMs) {
        return parsed.data;
      }
      storage?.removeItem(scopedKey);
    }
  } catch {
    storage?.removeItem(scopedKey);
  }

  const controller = new AbortController();
  inFlightControllers.add(controller);
  try {
    const fresh = await fetcher(controller.signal);
    if (
      controller.signal.aborted
      || epoch !== sessionCacheEpoch
      || activeActorKey !== actorKey
    ) {
      throw new DOMException("Actor changed while filling session cache", "AbortError");
    }
    try {
      storage?.setItem(scopedKey, JSON.stringify({ data: fresh, ts: Date.now() }));
    } catch {
      // QuotaExceeded must not break the live response.
    }
    return fresh;
  } finally {
    inFlightControllers.delete(controller);
  }
}

/** Invalidate one cache entry for the active actor. */
export function invalidateSessionCache(key: string, actorKey: string): void {
  const storage = browserSessionStorage();
  try {
    storage?.removeItem(key);
    storage?.removeItem(sessionCacheStorageKey(key, actorKey));
  } catch {
    /* ignore */
  }
}
