// 웹 API 호출 헬퍼 — Bearer 토큰으로 인증
import { Alert } from "react-native";
import { router } from "expo-router";
import { supabase } from "./supabase";
import { persistActiveMobileAuthReturnPath } from "./mobileAuthIntent";

const API_BASE = process.env.EXPO_PUBLIC_SITE_URL || "https://hanbang.ai";

/**
 * 인증된 API 호출 (웹 API Routes 경유)
 * Supabase 세션 토큰을 Authorization header에 실어서 보냄
 */
export async function apiFetch(path: string, options: RequestInit = {}) {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("내부 API 경로만 호출할 수 있습니다.");
  }

  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new Error("로그인 상태를 확인하지 못했습니다. 연결을 확인하고 다시 시도해주세요.");
  }
  const token = data.session?.access_token;

  if (!token) {
    await persistActiveMobileAuthReturnPath().catch(() => false);
    router.replace("/(auth)/login");
    throw new Error("로그인이 필요합니다.");
  }

  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  // 세션 만료 시 로그아웃 후 로그인 화면으로 이동
  if (res.status === 401) {
    Alert.alert("세션 만료", "다시 로그인해주세요.", [
      {
        text: "확인",
        onPress: () => {
          void persistActiveMobileAuthReturnPath()
            .catch(() => false)
            .finally(async () => {
              await supabase.auth.signOut();
              router.replace("/(auth)/login");
            });
        },
      },
    ]);
    throw new Error("세션이 만료되었습니다.");
  }

  return res;
}

/**
 * JSON API 호출 (스트리밍 아닌 일반 요청용)
 */
export async function apiJson<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API 오류 (${res.status})`);
  }
  return res.json();
}
