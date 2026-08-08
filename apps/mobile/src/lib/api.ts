// 웹 API 호출 헬퍼 — Bearer 토큰으로 인증
import { Alert } from "react-native";
import { router } from "expo-router";
import { fetch as expoFetch, type FetchRequestInit } from "expo/fetch";
import { supabase } from "./supabase";
import { signOut } from "./auth";
import {
  createMobileWebApiSessionRefreshGate,
  fetchMobileWebApiWithSession,
} from "./mobileWebApiBridge.mjs";

const API_BASE = process.env.EXPO_PUBLIC_SITE_URL || "https://hanbang.ai";
type WebBridgeSessionIdentity = { userId: string; accessToken: string };
type OptionalAuthGetOptions = Omit<
  FetchRequestInit,
  "body" | "credentials" | "method"
> & {
  body?: never;
  credentials?: never;
  method?: "GET";
};
const webBridgeSessionRefreshGate = createMobileWebApiSessionRefreshGate();
const OPTIONAL_AUTH_FORBIDDEN_HEADERS = [
  "authorization",
  "cookie",
  "cookie2",
  "proxy-authorization",
] as const;

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

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

function resolveInternalApiUrl(path: string): string {
  if (
    typeof path !== "string"
    || !path.startsWith("/api/")
    || path.startsWith("//")
    || path.includes("\\")
    || path.includes("#")
    || hasAsciiControlCharacter(path)
  ) {
    throw new Error("내부 API 경로만 호출할 수 있습니다.");
  }

  const baseUrl = new URL(API_BASE);
  const requestUrl = new URL(path, baseUrl);
  if (
    requestUrl.origin !== baseUrl.origin
    || !requestUrl.pathname.startsWith("/api/")
    || requestUrl.username !== ""
    || requestUrl.password !== ""
  ) {
    throw new Error("내부 API 경로만 호출할 수 있습니다.");
  }
  return requestUrl.toString();
}

function buildOptionalAuthGetHeaders(input: HeadersInit | undefined): Headers {
  const headers = new Headers(input);
  for (const name of OPTIONAL_AUTH_FORBIDDEN_HEADERS) {
    if (headers.has(name)) {
      throw new Error("선택 인증 GET 헤더는 헬퍼가 관리합니다.");
    }
  }
  if (!headers.has("accept")) headers.set("Accept", "application/json");
  return headers;
}

/**
 * 인증된 API 호출 (웹 API Routes 경유)
 * Supabase 세션 토큰을 Authorization header에 실어서 보냄
 */
async function authenticatedApiFetch(
  path: string,
  options: RequestInit,
  handleExpiredSession: boolean,
  expectedUserId?: string,
) {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("내부 API 경로만 호출할 수 있습니다.");
  }

  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  const token = data.session?.access_token;
  const initialSession = userId && token ? { userId, accessToken: token } : null;
  if (
    expectedUserId !== undefined
    && (
      typeof expectedUserId !== "string"
      || expectedUserId.length === 0
      || initialSession?.userId.toLowerCase() !== expectedUserId.toLowerCase()
    )
  ) {
    throw new Error("API_SESSION_OWNER_MISMATCH");
  }

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
      expectedUserId,
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
          void signOut()
            .then(() => router.replace("/(auth)/login"))
            .catch((error: unknown) => {
              const message = error instanceof Error
                ? error.message
                : "알림 연결을 안전하게 해제하지 못했습니다.";
              Alert.alert("로그아웃 실패", message);
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

/**
 * 시작 시점 사용자와 실제 Bearer 소유자가 정확히 같을 때만 호출한다.
 * 계정 전환 중에는 네트워크 요청 자체를 보내지 않는다.
 */
export async function apiFetchForExpectedUser(
  expectedUserId: string,
  path: string,
  options: RequestInit = {},
) {
  return authenticatedApiFetch(path, options, true, expectedUserId);
}

// WebView의 허용 목록 기반 업체 API 브리지는 401 응답을 웹 화면에 그대로
// 돌려줘야 로그인 게이트를 정확히 표시할 수 있다. 토큰은 이 네이티브 계층을
// 벗어나지 않는다.
export async function apiFetchForWebBridge(path: string, options: RequestInit = {}) {
  return authenticatedApiFetch(path, options, false);
}

async function readJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API 오류 (${res.status})`);
  }
  return res.json();
}

/**
 * JSON API 호출 (스트리밍 아닌 일반 요청용)
 */
export async function apiJson<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  return readJsonOrThrow<T>(await apiFetch(path, options));
}

/**
 * 시작 시점 사용자와 실제 Bearer 소유자가 정확히 같을 때만 JSON을 주고받는다.
 * 계정 전환 중에는 요청 자체를 보내지 않으므로, 늦은 응답이 다른 계정 화면에
 * 적용될 여지를 남기지 않는다.
 */
export async function apiJsonForExpectedUser<T = unknown>(
  expectedUserId: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  return readJsonOrThrow<T>(
    await apiFetchForExpectedUser(expectedUserId, path, options),
  );
}

/**
 * 공개 GET을 읽되 현재 로그인 세션이 있으면 해당 Bearer를 함께 보낸다.
 * guest 요청은 어떤 자격 정보도 보내지 않으며, 이 헬퍼는 mutation에 사용할 수 없다.
 */
export async function optionalAuthGetFetch(
  path: string,
  options: OptionalAuthGetOptions = {},
) {
  const requestUrl = resolveInternalApiUrl(path);
  if (options.method !== undefined && options.method !== "GET") {
    throw new Error("선택 인증 요청은 GET만 허용합니다.");
  }
  if (Object.prototype.hasOwnProperty.call(options, "body")) {
    throw new Error("선택 인증 GET에는 요청 본문을 사용할 수 없습니다.");
  }
  if (Object.prototype.hasOwnProperty.call(options, "credentials")) {
    throw new Error("선택 인증 GET의 자격 정보는 헬퍼가 관리합니다.");
  }

  const baseHeaders = buildOptionalAuthGetHeaders(options.headers);
  const fetchRead = (accessToken?: string) => {
    const headers = new Headers(baseHeaders);
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    return expoFetch(requestUrl, {
      ...options,
      method: "GET",
      headers,
      credentials: "omit",
      redirect: "error",
    });
  };

  const initialSession = await readCurrentWebBridgeSession();
  if (!initialSession) return fetchRead();

  const initialResponse = await fetchRead(initialSession.accessToken);
  if (initialResponse.status !== 401) return initialResponse;

  // 계정이 바뀌었거나 로그아웃되었다면 새 계정/guest로 재전송하지 않는다.
  const refreshedSession = await refreshWebBridgeSession(initialSession);
  if (
    !refreshedSession
    || refreshedSession.userId !== initialSession.userId
  ) return initialResponse;

  // 한 번만 갱신·재시도하며 두 번째 401은 서버의 최종 응답으로 돌려준다.
  return fetchRead(refreshedSession.accessToken);
}

export async function optionalAuthGetJson<T = unknown>(
  path: string,
  options: OptionalAuthGetOptions = {},
): Promise<T> {
  const res = await optionalAuthGetFetch(path, options);
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => ({}));
    const message = body !== null
      && typeof body === "object"
      && !Array.isArray(body)
      && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : `API 오류 (${res.status})`;
    throw new Error(message);
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
