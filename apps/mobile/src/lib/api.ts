// 웹 API 호출 헬퍼 — Bearer 토큰으로 인증
import { Alert } from "react-native";
import { router } from "expo-router";
import { supabase } from "./supabase";
import { signOut as signOutSession } from "./auth";
import {
  createMobileWebApiSessionRefreshGate,
  fetchMobileWebApiWithSession,
} from "./mobileWebApiBridge.mjs";
import { resolveMobileSiteOrigin } from "./siteUrl.mjs";

const API_BASE = resolveMobileSiteOrigin(
  process.env.EXPO_PUBLIC_SITE_URL,
  { isDevelopment: __DEV__ },
);
type WebBridgeSessionIdentity = { userId: string; accessToken: string };
const webBridgeSessionRefreshGate = createMobileWebApiSessionRefreshGate();

async function readCurrentWebBridgeSession(): Promise<WebBridgeSessionIdentity | null> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  const accessToken = data.session?.access_token;
  return userId && accessToken ? { userId, accessToken } : null;
}

function refreshWebBridgeSession(
  expected: WebBridgeSessionIdentity,
): Promise<WebBridgeSessionIdentity | null> {
  return webBridgeSessionRefreshGate.refresh(expected, async () => {
    try {
      // If logout/login or account switching happened while the first request
      // was in flight, do not refresh (or replay its body) under the new session.
      const current = await readCurrentWebBridgeSession();
      if (
        !current
        || current.userId !== expected.userId
        || current.accessToken !== expected.accessToken
      ) return null;

      const { data, error } = await supabase.auth.refreshSession();
      if (error) return null;
      const refreshedUserId = data.session?.user.id;
      const refreshedAccessToken = data.session?.access_token;
      if (
        !refreshedUserId
        || refreshedUserId !== expected.userId
        || !refreshedAccessToken
      ) return null;

      const afterRefresh = await readCurrentWebBridgeSession();
      if (
        !afterRefresh
        || afterRefresh.userId !== expected.userId
        || afterRefresh.accessToken !== refreshedAccessToken
      ) return null;
      return { userId: refreshedUserId, accessToken: refreshedAccessToken };
    } catch {
      return null;
    }
  });
}

/**
 * 인증된 API 호출 (웹 API Routes 경유)
 * Supabase 세션 토큰을 Authorization header에 실어서 보냄
 */
async function authenticatedApiFetch(
  path: string,
  options: RequestInit,
  handleExpiredSession: boolean,
) {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("내부 API 경로만 호출할 수 있습니다.");
  }

  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  const token = data.session?.access_token;
  const initialSession = userId && token ? { userId, accessToken: token } : null;

  const fetchWithAccessToken = (accessToken: string) => fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!handleExpiredSession) {
    return fetchMobileWebApiWithSession({
      initialSession,
      fetchWithAccessToken,
      refreshSession: () => initialSession
        ? refreshWebBridgeSession(initialSession)
        : Promise.resolve(null),
    });
  }

  if (!token) {
    throw new Error("로그인이 필요합니다.");
  }

  const res = await fetchWithAccessToken(token);

  // 세션 만료 시 로그아웃 후 로그인 화면으로 이동
  if (res.status === 401 && handleExpiredSession) {
    Alert.alert("세션 만료", "다시 로그인해주세요.", [
      {
        text: "확인",
        onPress: () => {
          void signOutSession()
            .then(() => {
              router.replace("/(auth)/login");
            })
            .catch(() => {
              Alert.alert(
                "안전한 로그아웃을 완료하지 못했어요",
                "알림 연결을 해제하려면 네트워크 연결 후 다시 시도해주세요.",
              );
            });
        },
      },
    ]);
    throw new Error("세션이 만료되었습니다.");
  }

  return res;
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  return authenticatedApiFetch(path, options, true);
}

// WebView의 허용 목록 기반 업체 API 브리지는 401 응답을 웹 화면에 그대로
// 돌려줘야 로그인 게이트를 정확히 표시할 수 있다. 토큰은 이 네이티브 계층을
// 벗어나지 않는다.
export async function apiFetchForWebBridge(path: string, options: RequestInit = {}) {
  return authenticatedApiFetch(path, options, false);
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

/**
 * 무인증 공개 API 호출 (가입·비밀번호찾기 등 로그인 이전 표면).
 * 호출자가 임의로 붙일 수 있는 헤더는 클라이언트 신원의 증거가 아니다.
 * 남용 방지가 필요한 라우트는 요청 본문의 검증 토큰을 서버에서 다시 확인한다.
 */
export async function publicApiFetch(path: string, options: RequestInit = {}) {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("내부 API 경로만 호출할 수 있습니다.");
  }
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}
