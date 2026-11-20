"use client";

// 모바일 OAuth 콜백 중간 페이지
// Supabase가 여기로 리다이렉트 → 일회용 PKCE code만 앱으로 전달
//
// 플로우:
// 1. Supabase redirects to: https://hanbang.ai/auth/mobile-callback?code=xxx
// 2. 이 페이지가 재사용 가능한 세션 토큰 없이 code만 앱으로 전달
// 3. 앱이 처음 로그인을 시작한 기기에 저장된 verifier로 code를 교환

import { useEffect, useState } from "react";
import { buildMobileOAuthAppCallbackUrl } from "@hanbang/shared/utils";

import InvitationAuthShell from "@/components/auth/InvitationAuthShell";

export default function MobileCallbackPage() {
  const [status, setStatus] = useState("앱으로 돌아가는 중...");

  useEffect(() => {
    const callbackUrl = window.location.href;
    const devExpoCallback = process.env.NEXT_PUBLIC_EXPO_AUTH_CALLBACK_URL;

    let appUrl: string;
    let devAppUrl: string | undefined;

    try {
      appUrl = buildMobileOAuthAppCallbackUrl(callbackUrl);
      if (process.env.NODE_ENV !== "production" && devExpoCallback) {
        devAppUrl = buildMobileOAuthAppCallbackUrl(callbackUrl, devExpoCallback);
      }
    } catch {
      const timer = window.setTimeout(() => {
        setStatus("안전한 로그인 코드를 받지 못했습니다. 다시 로그인해주세요.");
      }, 0);
      return () => window.clearTimeout(timer);
    }

    // Remove the one-time code from browser history before opening the app.
    window.history.replaceState(null, "", window.location.pathname);

    let devFallbackTimer: number | undefined;
    window.location.replace(appUrl);

    if (devAppUrl) {
      devFallbackTimer = window.setTimeout(() => {
        window.location.replace(devAppUrl);
      }, 500);
    }

    const statusTimer = window.setTimeout(() => {
      setStatus("앱이 열리지 않으면 앱으로 직접 돌아가주세요.");
    }, 2000);

    return () => {
      if (devFallbackTimer !== undefined) window.clearTimeout(devFallbackTimer);
      window.clearTimeout(statusTimer);
    };
  }, []);

  // 2026-11-20 파운더 "로그인 페이지도 다 바꿔야": 로그인과 같은 틀(시작 화면 모양)에 상태 문장만 둔다.
  // 위의 코드 넘기기는 그대로다. "웨딩한방" 글자는 틀의 amora 가 대신한다.
  return (
    <InvitationAuthShell labelledBy="callback-status">
      <p id="callback-status" role="status" className="m-0 text-center text-[15px] leading-[1.7] text-inv-body">
        {status}
      </p>
    </InvitationAuthShell>
  );
}
