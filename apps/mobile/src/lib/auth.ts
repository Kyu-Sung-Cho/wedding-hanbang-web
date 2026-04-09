// Supabase 공식 Expo OAuth 플로우
// https://supabase.com/docs/guides/auth/social-login/auth-kakao?queryGroups=framework&framework=expo
//
// 핵심: makeRedirectUri() + openAuthSessionAsync + setSession
// PKCE/implicit 관계없이 URL에서 토큰을 직접 파싱하는 방식

import { makeRedirectUri } from "expo-auth-session";
import * as QueryParams from "expo-auth-session/build/QueryParams";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "./supabase";
import type { Provider } from "@supabase/supabase-js";

// iOS: 브라우저 인증 세션 완료 감지
WebBrowser.maybeCompleteAuthSession();

// Expo Go에서는 Expo 프록시 URL, 프로덕션에서는 hanbang:// 스킴
const redirectTo = makeRedirectUri();

/**
 * URL에서 세션 토큰 추출 → Supabase 세션 설정
 */
async function createSessionFromUrl(url: string) {
  // access_token, refresh_token 이 URL의 hash fragment 또는 query param에 있음
  const { params, errorCode } = QueryParams.getQueryParams(url);

  if (errorCode) {
    throw new Error(`OAuth 에러: ${errorCode}`);
  }

  const { access_token, refresh_token } = params;

  if (!access_token || !refresh_token) {
    throw new Error("토큰을 받지 못했습니다. 다시 시도해주세요.");
  }

  const { data, error } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });

  if (error) throw error;
  return data.session;
}

/**
 * OAuth 로그인
 */
export async function signInWithOAuth(provider: Provider) {
  // 카카오: account_email scope 제거 (비즈앱 아니라 권한 없음)
  const scopes = provider === "kakao"
    ? "profile_nickname profile_image"
    : undefined;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      scopes: scopes ?? "",
    },
  });

  if (error) throw error;
  if (!data?.url) throw new Error("인증 URL을 받지 못했습니다.");

  // 카카오 URL에서 account_email scope 강제 제거 (Supabase 기본값 방어)
  let authorizeUrl = data.url;
  if (provider === "kakao") {
    try {
      const urlObj = new URL(authorizeUrl);
      const currentScopes = urlObj.searchParams.get("scope") ?? "";
      const filtered = currentScopes
        .split(/[,\s]+/)
        .filter((s) => s && s !== "account_email")
        .join(" ");
      urlObj.searchParams.set("scope", filtered);
      authorizeUrl = urlObj.toString();
    } catch {
      // URL 파싱 실패 시 원본 사용
    }
  }

  // 인앱 브라우저 열기 — redirectTo 로 시작하는 URL 감지 시 자동 닫힘
  const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, redirectTo);

  if (result.type !== "success" || !result.url) {
    if (result.type === "cancel" || result.type === "dismiss") {
      return { cancelled: true, session: null };
    }
    throw new Error(`브라우저 오류: ${result.type}`);
  }

  // 리턴된 URL에서 세션 생성
  const session = await createSessionFromUrl(result.url);
  return { cancelled: false, session };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
