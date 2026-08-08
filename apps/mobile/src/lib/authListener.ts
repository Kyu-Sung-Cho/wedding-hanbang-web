// 세션 만료 감지 + 앱 상태에 맞춘 Supabase 갱신 + silent push rebind
import { supabase } from "./supabase";
import { router } from "expo-router";
import { AppState } from "react-native";
import type { AppStateStatus, NativeEventSubscription } from "react-native";
import { isPushRegistrationEnabled } from "./pushRegistrationGate.mjs";

let initialized = false;
let appStateSubscription: NativeEventSubscription | null = null;
let authStateSubscription: { unsubscribe: () => void } | null = null;
let pushTokenSubscription: { remove: () => void } | null = null;
let activeDecisionOwnerId: string | null = null;
const pushRegistrationEnabled = isPushRegistrationEnabled(
  process.env.EXPO_PUBLIC_PUSH_REGISTRATION_ENABLED,
);

function scheduleSilentPushRefresh() {
  if (__DEV__ || !pushRegistrationEnabled) return;
  setTimeout(() => {
    void import("./notifications")
      .then(({ refreshExistingPushRegistration }) => (
        refreshExistingPushRegistration()
      ))
      .catch((error: unknown) => console.warn("[Push] silent 갱신 실패:", error));
  }, 0);
}

function syncAutoRefreshWithAppState(state: AppStateStatus) {
  if (state === "active") {
    supabase.auth.startAutoRefresh();
    // 권한이 이미 granted인 경우에만 access JWT/session 만료와 Expo token
    // rotation을 현재 installation binding에 조용히 반영한다.
    scheduleSilentPushRefresh();
    return;
  }
  supabase.auth.stopAutoRefresh();
}

function scheduleDecisionOwnerPurge(ownerId: string) {
  setTimeout(() => {
    void import("./communityDecisionPending")
      .then(({ purgeCommunityDecisionPendingForOwnerWithRetry }) => (
        purgeCommunityDecisionPendingForOwnerWithRetry(ownerId)
      ))
      .catch(() => {
        if (__DEV__) {
          console.warn("COMMUNITY_DECISION_OWNER_PURGE_RETRY_EXHAUSTED");
        }
      });
  }, 0);
}

export function initAuthListener() {
  if (initialized) return;
  initialized = true;

  syncAutoRefreshWithAppState(AppState.currentState);
  appStateSubscription = AppState.addEventListener(
    "change",
    syncAutoRefreshWithAppState,
  );

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    const nextOwnerId = session?.user.id ?? null;
    const previousOwnerId = activeDecisionOwnerId;
    if (event === "INITIAL_SESSION") {
      activeDecisionOwnerId = nextOwnerId;
    } else if (event === "SIGNED_IN") {
      activeDecisionOwnerId = nextOwnerId;
      if (
        previousOwnerId
        && nextOwnerId
        && previousOwnerId !== nextOwnerId
      ) {
        scheduleDecisionOwnerPurge(previousOwnerId);
      }
    } else if (event === "SIGNED_OUT") {
      activeDecisionOwnerId = null;
      if (previousOwnerId) scheduleDecisionOwnerPurge(previousOwnerId);
    }

    if (
      event === "SIGNED_OUT"
      || event === "SIGNED_IN"
      || event === "INITIAL_SESSION"
    ) {
      void import("./notifications")
        .then(({
          invalidateCommunityPushNavigationForAuthChange,
          retryLastCommunityPushResponse,
        }) => {
          invalidateCommunityPushNavigationForAuthChange();
          if (session) return retryLastCommunityPushResponse();
          return undefined;
        })
        .catch(() => undefined);
    }

    if (event === "SIGNED_OUT" || (event === "INITIAL_SESSION" && !session)) {
      void import("./notifications")
        .then(({ unregisterPushNotificationsForSignedOutDevice }) => (
          unregisterPushNotificationsForSignedOutDevice()
        ))
        .catch((error: unknown) => {
          if (__DEV__) console.warn("[Push] signed-out cleanup failed:", error);
        });
      if (event === "SIGNED_OUT") router.replace("/(auth)/login");
    }

    if (
      session
      && (
        event === "INITIAL_SESSION"
        || event === "SIGNED_IN"
        || event === "TOKEN_REFRESHED"
      )
    ) {
      // 이 경로는 requestPermissionsAsync를 호출하지 않는다.
      scheduleSilentPushRefresh();
    }
  });
  authStateSubscription = data.subscription;

  if (!__DEV__ && pushRegistrationEnabled) {
    void import("./notifications")
      .then(({ subscribeToPushTokenChanges }) => {
        const subscription = subscribeToPushTokenChanges();
        if (!subscription) return;
        if (!initialized) {
          subscription.remove();
          return;
        }
        pushTokenSubscription = subscription;
      })
      .catch((error: unknown) => console.warn("[Push] token listener 실패:", error));
  }
}

export function disposeAuthListener() {
  if (!initialized) return;
  initialized = false;
  authStateSubscription?.unsubscribe();
  authStateSubscription = null;
  appStateSubscription?.remove();
  appStateSubscription = null;
  pushTokenSubscription?.remove();
  pushTokenSubscription = null;
  activeDecisionOwnerId = null;
  supabase.auth.stopAutoRefresh();
}
