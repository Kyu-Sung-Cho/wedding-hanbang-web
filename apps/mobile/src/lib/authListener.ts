// 세션 만료 감지 + React Native 앱 상태에 맞춘 Supabase 토큰 자동 갱신
import { supabase } from "./supabase";
import { router } from "expo-router";
import { AppState } from "react-native";
import type { AppStateStatus, NativeEventSubscription } from "react-native";

let initialized = false;
let appStateSubscription: NativeEventSubscription | null = null;
let authStateSubscription: { unsubscribe: () => void } | null = null;

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
