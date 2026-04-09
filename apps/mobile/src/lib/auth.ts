// 웨딩한방 앱 OAuth 로직
// 카카오/Apple 로그인은 Supabase의 외부 OAuth 플로우를 사용합니다.
//
// 플로우:
// 1. supabase.auth.signInWithOAuth() → authorize URL 받기
// 2. expo-web-browser 로 authorize URL 열기 (인앱 브라우저)
// 3. 사용자가 카카오 로그인 완료
// 4. 카카오 → Supabase → hanbang://auth/callback 딥링크 리턴
// 5. 딥링크에서 access_token, refresh_token 파싱
// 6. supabase.auth.setSession() 호출

import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { supabase } from "./supabase";
import type { Provider } from "@supabase/supabase-js";

// iOS 웹 브라우저 인증 완료 감지
WebBrowser.maybeCompleteAuthSession();

/**
 * OAuth 로그인 공통 함수
 * @param provider 'kakao' | 'google' | 'apple' | ...
 */
export async function signInWithOAuth(provider: Provider) {
  // 앱이 돌려받을 딥링크 URL
  const redirectTo = Linking.createURL("auth/callback");
  // 결과: 예) "hanbang://auth/callback" (standalone)
  //       예) "exp://192.168.x.x:8081/--/auth/callback" (Expo Go)

  // 1. Supabase로부터 카카오 authorize URL 받기
  // scopes: account_email은 비즈앱만 가능하므로 제외 — 닉네임+프로필사진만 요청
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

  if (error) {
    console.error("[Auth] signInWithOAuth error:", error);
    throw error;
  }
  if (!data?.url) {
    throw new Error("[Auth] No authorize URL returned from Supabase");
  }

  // 2. Supabase가 기본으로 account_email scope를 넣을 수 있으므로 URL에서 직접 제거
  let authorizeUrl = data.url;
  if (provider === "kakao") {
    const urlObj = new URL(authorizeUrl);
    const currentScopes = urlObj.searchParams.get("scope") ?? "";
    const filteredScopes = currentScopes
      .split(/[,\s]+/)
      .filter((s) => s && s !== "account_email")
      .join(" ");
    urlObj.searchParams.set("scope", filteredScopes);
    authorizeUrl = urlObj.toString();
  }

  // 3. 인앱 브라우저로 authorize URL 열기
  const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, redirectTo);

  if (result.type !== "success" || !result.url) {
    // 사용자가 취소했거나 에러
    if (result.type === "cancel" || result.type === "dismiss") {
      return { cancelled: true };
    }
    throw new Error(`[Auth] WebBrowser returned: ${result.type}`);
  }

  // 3. 리턴된 URL에서 토큰 파싱
  // PKCE 플로우면 URL에 code 파라미터, implicit 플로우면 hash에 access_token
  const url = result.url;
  const parsed = Linking.parse(url);

  // code 파라미터 (PKCE)
  const code = parsed.queryParams?.code as string | undefined;
  if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      console.error("[Auth] exchangeCodeForSession error:", exchangeError);
      throw exchangeError;
    }
    return { cancelled: false };
  }

  // hash의 access_token (implicit / legacy)
  // URL fragment는 expo-linking이 파싱 안 하므로 수동 처리
  const hashIndex = url.indexOf("#");
  if (hashIndex !== -1) {
    const fragment = url.substring(hashIndex + 1);
    const params = new URLSearchParams(fragment);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (accessToken && refreshToken) {
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (sessionError) {
        console.error("[Auth] setSession error:", sessionError);
        throw sessionError;
      }
      return { cancelled: false };
    }
  }

  throw new Error("[Auth] Could not extract tokens from redirect URL");
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
