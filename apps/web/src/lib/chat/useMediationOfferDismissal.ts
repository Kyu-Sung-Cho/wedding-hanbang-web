"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { MEDIATION_OFFER_FRESHNESS_MS } from "@hanbang/shared/mediation-offer";

const STORAGE_PREFIX = "amora:mediation-offer-dismissal:v1";
const DISMISSAL_EVENT = "amora:mediation-offer-dismissal-change";
const EPHEMERAL_SCOPE = `${STORAGE_PREFIX}:ephemeral`;
const SERVER_SNAPSHOT = "server";
const READY_PREFIX = "ready:";

interface StoredDismissal {
  version: 1;
  offerKey: string;
  expiresAt: number;
}

// 저장소 접근이 차단된 브라우저에서도 현재 화면에서는 숨김 선택을 존중한다.
const volatileDismissals = new Map<string, StoredDismissal>();

function dismissalStorageKey(ownerUserId: string, coupleId: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(ownerUserId)}:${encodeURIComponent(coupleId)}`;
}

function validateStoredDismissal(
  value: Partial<StoredDismissal>,
  nowMs: number,
): StoredDismissal | null {
  if (
    value.version !== 1
    || typeof value.offerKey !== "string"
    || value.offerKey.length === 0
    || typeof value.expiresAt !== "number"
    || !Number.isFinite(value.expiresAt)
    || value.expiresAt <= nowMs
    || value.expiresAt > nowMs + MEDIATION_OFFER_FRESHNESS_MS
  ) return null;
  return value as StoredDismissal;
}

function readDismissedOfferKey(scopeKey: string, nowMs = Date.now()): string | null {
  const volatile = validateStoredDismissal(
    volatileDismissals.get(scopeKey) ?? {},
    nowMs,
  );
  if (volatile) return volatile.offerKey;
  if (typeof window === "undefined" || scopeKey === EPHEMERAL_SCOPE) return null;

  try {
    const raw = window.localStorage.getItem(scopeKey);
    if (!raw) return null;
    return validateStoredDismissal(
      JSON.parse(raw) as Partial<StoredDismissal>,
      nowMs,
    )?.offerKey ?? null;
  } catch {
    return null;
  }
}

function notifyDismissalChanged(scopeKey: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DISMISSAL_EVENT, {
    detail: { scopeKey },
  }));
}

function persistDismissedOfferKey(scopeKey: string, offerKey: string): void {
  const record: StoredDismissal = {
    version: 1,
    offerKey,
    expiresAt: Date.now() + MEDIATION_OFFER_FRESHNESS_MS,
  };
  volatileDismissals.set(scopeKey, record);

  if (typeof window !== "undefined" && scopeKey !== EPHEMERAL_SCOPE) {
    try {
      window.localStorage.setItem(scopeKey, JSON.stringify(record));
    } catch {
      // volatile record가 현재 화면의 선택을 계속 보존한다.
    }
  }
  notifyDismissalChanged(scopeKey);
}

/**
 * 사용자의 조율 제안 숨김은 원문이 아니라 사건 key만, 사용자+커플 범위로 보관한다.
 * TTL은 제안 자체의 freshness보다 길 수 없으며 새 사건 key에는 영향을 주지 않는다.
 */
export function useMediationOfferDismissal(
  ownerUserId: string | null | undefined,
  coupleId: string | null | undefined,
) {
  const scopeKey = useMemo(
    () => ownerUserId && coupleId
      ? dismissalStorageKey(ownerUserId, coupleId)
      : EPHEMERAL_SCOPE,
    [coupleId, ownerUserId],
  );

  const subscribe = useCallback((onStoreChange: () => void) => {
    if (typeof window === "undefined") return () => {};
    const handleCustomEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ scopeKey?: string }>).detail;
      if (detail?.scopeKey === scopeKey) onStoreChange();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === scopeKey) onStoreChange();
    };
    window.addEventListener(DISMISSAL_EVENT, handleCustomEvent);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(DISMISSAL_EVENT, handleCustomEvent);
      window.removeEventListener("storage", handleStorage);
    };
  }, [scopeKey]);

  const getSnapshot = useCallback(
    () => typeof window === "undefined"
      ? SERVER_SNAPSHOT
      : `${READY_PREFIX}${readDismissedOfferKey(scopeKey) ?? ""}`,
    [scopeKey],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => SERVER_SNAPSHOT,
  );

  const dismissOffer = useCallback((offerKey: string) => {
    persistDismissedOfferKey(scopeKey, offerKey);
  }, [scopeKey]);

  return {
    dismissedOfferKey: snapshot.startsWith(READY_PREFIX)
      ? snapshot.slice(READY_PREFIX.length) || null
      : null,
    dismissalReady: snapshot !== SERVER_SNAPSHOT,
    dismissOffer,
  };
}
