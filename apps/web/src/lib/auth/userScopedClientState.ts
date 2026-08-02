"use client";

import { clearChatFeedbackStorage } from "@/lib/chat/feedbackStorage";
import { resetVendorEventIdentity } from "@/lib/analytics/track";
import { resetAnalyticsIdentityBoundary } from "@/lib/analytics";
import { resetLegacyEventTrackerState } from "@/hooks/useEventTracker";
import { clearNotificationClientState } from "@/hooks/useNotifications";
import { clearOneTimeHandoffs } from "@/lib/privacy/oneTimeHandoff";
import { clearPriceComboClientState } from "@/lib/price/comboStore";
import { clearPriceImpressionClientState } from "@/lib/price/impressionStorage";
import { activateSessionCacheActor, clearSessionCacheClientState } from "@/utils/sessionCache";
import { useChatStore } from "@/stores/chatStore";
import { useCommunityStore } from "@/stores/communityStore";
import { useMoneyStore } from "@/stores/moneyStore";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { clearRetiredWeddingCodeStorage } from "@/lib/weddingCode/retiredStorage";

/**
 * Clear every client-side container that can carry data from one signed-in
 * identity into the next one. This function is intentionally idempotent.
 */
export const USER_SCOPED_ACTOR_STORAGE_KEY = "hanbang:user-scoped-actor:v1";

type ActorStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function isValidUserScopedActorKey(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 180
    && (
      value === "guest"
      || value === "demo"
      || /^user:[A-Za-z0-9-]{1,128}$/.test(value)
      || /^native:[A-Fa-f0-9-]{36}$/.test(value)
    );
}

export function userScopedActorKeyForUser(userId: string): string {
  if (!/^[A-Za-z0-9-]{1,128}$/.test(userId)) throw new Error("USER_SCOPED_ACTOR_INVALID");
  return `user:${userId}`;
}

export function clearUserScopedClientState(actorKey?: string): void {
  const purges: Array<() => void> = [
    () => useChatStore.getState().reset(),
    () => useCommunityStore.getState().reset(),
    () => useMoneyStore.getState().reset(),
    () => useOnboardingStore.getState().reset(),
    clearChatFeedbackStorage,
    resetVendorEventIdentity,
    resetAnalyticsIdentityBoundary,
    resetLegacyEventTrackerState,
    clearNotificationClientState,
    clearOneTimeHandoffs,
    clearRetiredWeddingCodeStorage,
    () => clearPriceComboClientState(undefined, actorKey),
    () => clearPriceImpressionClientState(actorKey),
    () => clearSessionCacheClientState(actorKey),
  ];
  // One unavailable browser storage or third-party SDK must never prevent the
  // remaining privacy containers from being blanked at an identity boundary.
  for (const purge of purges) {
    try {
      purge();
    } catch {
      // Every purge is idempotent and independently best effort.
    }
  }
}

/**
 * Commit a verified actor to this tab. A missing/legacy marker is treated as
 * untrusted so old account-unbound caches are purged before first use.
 */
export function reconcileUserScopedClientActor(
  nextActorKey: string,
  storage: ActorStorage | null = browserSessionStorage(),
): { changed: boolean; previousActorKey: string | null } {
  if (!isValidUserScopedActorKey(nextActorKey)) throw new Error("USER_SCOPED_ACTOR_INVALID");

  let previousActorKey: string | null = null;
  try {
    const stored = storage?.getItem(USER_SCOPED_ACTOR_STORAGE_KEY) ?? null;
    if (isValidUserScopedActorKey(stored)) previousActorKey = stored;
    else if (stored !== null) storage?.removeItem(USER_SCOPED_ACTOR_STORAGE_KEY);
  } catch {
    previousActorKey = null;
  }

  const changed = previousActorKey !== nextActorKey;
  if (changed) clearUserScopedClientState(previousActorKey ?? undefined);

  try {
    storage?.setItem(USER_SCOPED_ACTOR_STORAGE_KEY, nextActorKey);
  } catch {
    // In-memory clearing and actor gates still fail closed without storage.
  }
  activateSessionCacheActor(nextActorKey);
  return { changed, previousActorKey };
}
