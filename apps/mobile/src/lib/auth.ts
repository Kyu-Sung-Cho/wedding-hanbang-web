// Supabase 공식 Expo OAuth 플로우
// https://supabase.com/docs/guides/auth/social-login/auth-kakao?queryGroups=framework&framework=expo
//
// 핵심: openAuthSessionAsync + PKCE authorization code exchange

import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { Platform } from "react-native";
import { extractMobileOAuthAuthorizationCode } from "@hanbang/shared/utils";
import { supabase } from "./supabase";
import type { Provider } from "@supabase/supabase-js";

type SupportedOAuthProvider = Extract<Provider, "kakao" | "apple" | "google">;

// 앱이 직접 쓴 안내 문장임을 표시한다. 이 이름이 붙은 오류만 화면에 그대로 올린다.
export const OAUTH_PROVIDER_UNAVAILABLE = "OAuthProviderUnavailable";

// iOS: 브라우저 인증 세션 완료 감지
WebBrowser.maybeCompleteAuthSession();

// 웹 콜백 페이지를 중간 다리로 사용한다. 재사용 가능한 세션 토큰은 전달하지 않는다.
// Supabase → https://hanbang.ai/auth/mobile-callback?code=... → 앱으로 딥링크
const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL || "https://hanbang.ai";
const redirectTo = `${SITE_URL}/auth/mobile-callback`;

// 앱으로 돌아올 때 감지할 URL (hanbang:// 또는 exp://)
const appReturnUrl = Linking.createURL("auth/callback");

export function isOAuthProviderEnabled(
  provider: SupportedOAuthProvider,
): boolean {
  // Expo Web에는 현재 same-origin HTTP callback 교환 경로가 없다.
  if (Platform.OS === "web") return false;

  if (provider === "kakao") {
    // Supabase/Kakao 양쪽 운영 설정이 끝난 빌드에서만 명시적으로 연다.
    return process.env.EXPO_PUBLIC_KAKAO_OAUTH_ENABLED === "true";
  }

  if (provider === "google") {
    // Kakao와 같은 이유로 기본은 꺼둔다. Supabase Auth의 Google provider와
    // Google Cloud Console의 client ID·redirect URI가 모두 끝난 빌드에서만 켠다.
    // 눌러도 동작하지 않는 버튼은 없는 것보다 나쁘다.
    return process.env.EXPO_PUBLIC_GOOGLE_OAUTH_ENABLED === "true";
  }

  // Apple provider가 운영에서 꺼질 때 빌드 환경으로 즉시 숨길 수 있다.
  return process.env.EXPO_PUBLIC_APPLE_OAUTH_ENABLED !== "false";
}

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
export async function signInWithOAuth(provider: SupportedOAuthProvider) {
  if (!isOAuthProviderEnabled(provider)) {
    const message = Platform.OS === "web"
      ? "소셜 로그인은 설치한 앱에서 이용할 수 있어요."
      : provider === "kakao"
        ? "카카오 로그인은 현재 준비 중이에요. 이메일 로그인을 이용해주세요."
        : provider === "google"
          ? "구글 로그인은 현재 준비 중이에요. 이메일 로그인을 이용해주세요."
          : "Apple 로그인을 현재 이용할 수 없어요. 이메일 로그인을 이용해주세요.";
    // 이 문장은 우리가 쓴 것이라 화면에 그대로 보여도 된다. Supabase가 던진 오류와
    // 구별되도록 표시해 둔다 — 그쪽 원문은 사람이 읽을 수 없고 내부 상태를 드러낸다.
    const unavailable = new Error(message);
    unavailable.name = OAUTH_PROVIDER_UNAVAILABLE;
    throw unavailable;
  }

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

export async function signOut(options: {
  continueOnDecisionPurgeFailure?: boolean;
  expectedOwnerId?: string;
  allowMissingSession?: boolean;
} = {}) {
  let decisionDataPurged = true;
  if (Platform.OS !== "web") {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const sessionOwnerId = sessionData.session?.user.id ?? null;
    if (
      options.expectedOwnerId
      && (
        (sessionOwnerId !== null && sessionOwnerId !== options.expectedOwnerId)
        || (sessionOwnerId === null && !options.allowMissingSession)
      )
    ) {
      throw new Error("AUTH_SIGN_OUT_OWNER_CHANGED");
    }
    const ownerId = options.expectedOwnerId ?? sessionOwnerId;
    if (ownerId) {
      try {
        const { purgeCommunityDecisionPendingForOwnerWithRetry } = await import(
          "./communityDecisionPending"
        );
        await purgeCommunityDecisionPendingForOwnerWithRetry(ownerId);
      } catch {
        decisionDataPurged = false;
        if (!options.continueOnDecisionPurgeFailure) {
          throw new Error("COMMUNITY_DECISION_OWNER_PURGE_UNCONFIRMED");
        }
      }
    }
    const { data: beforeRelease, error: beforeReleaseError } = await supabase.auth.getSession();
    if (beforeReleaseError) throw beforeReleaseError;
    const beforeReleaseOwnerId = beforeRelease.session?.user.id ?? null;
    if (
      options.expectedOwnerId
      && (
        (beforeReleaseOwnerId !== null && beforeReleaseOwnerId !== options.expectedOwnerId)
        || (beforeReleaseOwnerId === null && !options.allowMissingSession)
      )
    ) {
      throw new Error("AUTH_SIGN_OUT_OWNER_CHANGED");
    }
    if (beforeReleaseOwnerId !== null) {
      const { releasePushNotificationsForCurrentSession } = await import("./notifications");
      if (options.expectedOwnerId) {
        await releasePushNotificationsForCurrentSession(options.expectedOwnerId);
      } else {
        await releasePushNotificationsForCurrentSession();
      }
    }
    const { data: beforeLocalSignOut, error: beforeLocalSignOutError } =
      await supabase.auth.getSession();
    if (beforeLocalSignOutError) throw beforeLocalSignOutError;
    const finalOwnerId = beforeLocalSignOut.session?.user.id ?? null;
    if (
      options.expectedOwnerId
      && (
        (finalOwnerId !== null && finalOwnerId !== options.expectedOwnerId)
        || (finalOwnerId === null && !options.allowMissingSession)
      )
    ) {
      throw new Error("AUTH_SIGN_OUT_OWNER_CHANGED");
    }
  }
  if (options.expectedOwnerId) {
    const { data: finalSessionData, error: finalSessionError } =
      await supabase.auth.getSession();
    if (finalSessionError) throw finalSessionError;
    const finalSessionOwnerId = finalSessionData.session?.user.id ?? null;
    if (
      (finalSessionOwnerId !== null && finalSessionOwnerId !== options.expectedOwnerId)
      || (finalSessionOwnerId === null && !options.allowMissingSession)
    ) {
      throw new Error("AUTH_SIGN_OUT_OWNER_CHANGED");
    }
  }
  // 일반 기기 로그아웃은 다른 휴대폰의 준비 흐름과 알림 세션을 끊지 않는다.
  // 계정 삭제/모든 기기 로그아웃은 별도의 명시적 서버 경계를 사용한다.
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw error;
  return { decisionDataPurged };
}
