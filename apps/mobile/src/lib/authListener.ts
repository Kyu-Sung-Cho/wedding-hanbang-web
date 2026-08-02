// 세션 만료 감지 + React Native 앱 상태에 맞춘 Supabase 토큰 자동 갱신
import { supabase } from "./supabase";
import { router } from "expo-router";
import { AppState } from "react-native";
import type { AppStateStatus, NativeEventSubscription } from "react-native";
import { isPushRegistrationEnabled } from "./pushRegistrationGate.mjs";

let initialized = false;
let appStateSubscription: NativeEventSubscription | null = null;
let authStateSubscription: { unsubscribe: () => void } | null = null;
const pushRegistrationEnabled = isPushRegistrationEnabled(
  process.env.EXPO_PUBLIC_PUSH_REGISTRATION_ENABLED,
);

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

  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      router.replace("/(auth)/login");
    }
    if (
      !__DEV__
      && pushRegistrationEnabled
      && (event === "INITIAL_SESSION" || event === "SIGNED_IN")
    ) {
      // Run outside the auth callback so token persistence never blocks the
      // Supabase session lock. Repeated calls are safe and refresh stale tokens.
      setTimeout(() => {
        void import("./notifications")
          .then(({ registerForPushNotifications }) => registerForPushNotifications())
          .catch((error: unknown) => console.warn("[Push] 등록 실패:", error));
      }, 0);
    }
  });
  authStateSubscription = data.subscription;
}

export function disposeAuthListener() {
  if (!initialized) return;
  initialized = false;
  authStateSubscription?.unsubscribe();
  authStateSubscription = null;
  appStateSubscription?.remove();
  appStateSubscription = null;
  supabase.auth.stopAutoRefresh();
}
