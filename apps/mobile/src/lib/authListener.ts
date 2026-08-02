// 세션 만료 감지 + React Native 앱 상태에 맞춘 Supabase 토큰 자동 갱신
import { supabase } from "./supabase";
import { router } from "expo-router";
import { AppState } from "react-native";
import type { AppStateStatus, NativeEventSubscription } from "react-native";
import { setCommunityCacheOwner } from "./communityPostCache";
import {
  beginMobileAuthIdentityTransition,
  completeMobileAuthIdentityTransition,
  failMobileAuthIdentityTransition,
  resetMobileAuthIdentityBoundary,
} from "./mobileAuthIdentity";

let initialized = false;
let appStateSubscription: NativeEventSubscription | null = null;
let authStateSubscription: { unsubscribe: () => void } | null = null;
let authEventVersion = 0;
let identityVerificationVersion = 0;

function syncAutoRefreshWithAppState(state: AppStateStatus) {
  if (state === "active") {
    supabase.auth.startAutoRefresh();
    return;
  }

  supabase.auth.stopAutoRefresh();
}

export function initAuthListener() {
  if (initialized) return;
  initialized = true;

  syncAutoRefreshWithAppState(AppState.currentState);
  appStateSubscription = AppState.addEventListener("change", syncAutoRefreshWithAppState);

  const applySessionIdentity = (
    event: string,
    session: { user: { id: string } } | null,
  ) => {
    authEventVersion += 1;
    const candidateUserId = session?.user.id ?? null;
    const transition = beginMobileAuthIdentityTransition(candidateUserId);
    setCommunityCacheOwner(candidateUserId);

    if (!__DEV__ && (event === "INITIAL_SESSION" || event === "SIGNED_IN")) {
      // Run outside the auth callback so token persistence never blocks the
      // Supabase session lock. Repeated calls are safe and refresh stale tokens.
      setTimeout(() => {
        void import("./notifications")
          .then(({ registerForPushNotifications }) => registerForPushNotifications())
          .catch(() => {
            if (__DEV__) console.warn("[Push] 등록 실패");
          });
      }, 0);
    }

    if (event === "SIGNED_OUT") {
      identityVerificationVersion += 1;
      completeMobileAuthIdentityTransition(transition.generation, null);
      router.replace("/(auth)/login");
      return;
    }

    if (!transition.changed) return;

    if (!candidateUserId) {
      identityVerificationVersion += 1;
      completeMobileAuthIdentityTransition(transition.generation, null);
      return;
    }

    const verificationVersion = ++identityVerificationVersion;
    // Supabase recommends leaving its auth callback before calling getUser.
    // The protected navigator is already synchronously gated at this point.
    setTimeout(() => {
      void supabase.auth.getUser().then(({ data: verified, error }) => {
        if (
          !initialized
          || verificationVersion !== identityVerificationVersion
          || error
          || verified.user?.id !== candidateUserId
        ) {
          if (initialized && verificationVersion === identityVerificationVersion) {
            failMobileAuthIdentityTransition(transition.generation);
          }
          return;
        }
        completeMobileAuthIdentityTransition(
          transition.generation,
          candidateUserId,
        );
      }).catch(() => {
        if (initialized && verificationVersion === identityVerificationVersion) {
          failMobileAuthIdentityTransition(transition.generation);
        }
      });
    }, 0);
  };

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    applySessionIdentity(event, session);
  });
  authStateSubscription = data.subscription;

  // onAuthStateChange normally emits INITIAL_SESSION. This fallback keeps the
  // root gate from hanging if a platform adapter misses that first callback,
  // while the version fence prevents an old getSession result from winning.
  const versionBeforeInitialRead = authEventVersion;
  void supabase.auth.getSession().then(({ data: sessionData }) => {
    if (!initialized || authEventVersion !== versionBeforeInitialRead) return;
    applySessionIdentity("INITIAL_SESSION", sessionData.session);
  }).catch(() => {
    if (!initialized || authEventVersion !== versionBeforeInitialRead) return;
    const transition = beginMobileAuthIdentityTransition(null);
    failMobileAuthIdentityTransition(transition.generation);
  });
}

export function disposeAuthListener() {
  if (!initialized) return;
  initialized = false;
  authEventVersion += 1;
  identityVerificationVersion += 1;
  authStateSubscription?.unsubscribe();
  authStateSubscription = null;
  appStateSubscription?.remove();
  appStateSubscription = null;
  setCommunityCacheOwner(null);
  resetMobileAuthIdentityBoundary();
  supabase.auth.stopAutoRefresh();
}
