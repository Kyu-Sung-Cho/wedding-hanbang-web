// Supabase 공식 Expo OAuth 플로우
// https://supabase.com/docs/guides/auth/social-login/auth-kakao?queryGroups=framework&framework=expo
//
// 핵심: openAuthSessionAsync + PKCE authorization code exchange

import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { extractMobileOAuthAuthorizationCode } from "@hanbang/shared/utils";
import { supabase } from "./supabase";
import { setCommunityCacheOwner } from "./communityPostCache";
import { detachPushTokenForCurrentUser } from "./notifications";
import { resolveMobileSiteOrigin } from "./siteUrl.mjs";
import type { Provider } from "@supabase/supabase-js";

// iOS: 브라우저 인증 세션 완료 감지
WebBrowser.maybeCompleteAuthSession();

// 웹 콜백 페이지를 중간 다리로 사용한다. 재사용 가능한 세션 토큰은 전달하지 않는다.
// Supabase → https://hanbang.ai/auth/mobile-callback?code=... → 앱으로 딥링크
const SITE_URL = resolveMobileSiteOrigin(
  process.env.EXPO_PUBLIC_SITE_URL,
  { isDevelopment: __DEV__ },
);
const redirectTo = `${SITE_URL}/auth/mobile-callback`;

// 앱으로 돌아올 때 감지할 URL (hanbang:// 또는 exp://)
const appReturnUrl = Linking.createURL("auth/callback");

/**
 * 앱에 저장된 PKCE verifier로 일회용 authorization code를 교환한다.
 */
async function createSessionFromUrl(url: string) {
  const code = extractMobileOAuthAuthorizationCode(url);
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

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

  // 인앱 브라우저 열기
  // 웹 콜백 페이지(hanbang.ai/auth/mobile-callback)가 앱 딥링크로 리다이렉트
  // 앱 딥링크(hanbang:// 또는 exp://)를 감지하면 브라우저 자동 닫힘
  const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, appReturnUrl);

  if (result.type !== "success" || !result.url) {
    if (result.type === "cancel" || result.type === "dismiss") {
      return { cancelled: true, session: null };
    }
    throw new Error(`브라우저 오류: ${result.type}`);
  }

  // 리턴된 URL의 일회용 code를 시작 기기의 verifier로 교환한다.
  const session = await createSessionFromUrl(result.url);
  return { cancelled: false, session };
}

async function completeLocalSignOut() {
  setCommunityCacheOwner(null);
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function signOut() {
  // Fail closed: completing account A's local sign-out while its device token
  // remains attached can expose A notifications after account B signs in.
  await detachPushTokenForCurrentUser();
  await completeLocalSignOut();
}

/**
 * Complete local sign-out only after the account-deletion caller has disabled
 * push consent and the server has accepted the deletion saga. Keeping this as
 * a separate, narrowly named boundary avoids treating ordinary detach errors
 * as success after an Auth row has already been removed.
 */
export async function signOutAfterAccountDeletionRequest() {
  await completeLocalSignOut();
}
