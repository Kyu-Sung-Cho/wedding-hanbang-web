// 세션 만료 감지 — SIGNED_OUT 이벤트 시 로그인 화면으로 리다이렉트
import { supabase } from "./supabase";
import { router } from "expo-router";

let initialized = false;

export function initAuthListener() {
  if (initialized) return;
  initialized = true;

  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      router.replace("/(auth)/login");
    }
  });
}
