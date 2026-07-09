"use client";

// 모바일 OAuth 콜백 중간 페이지
// Supabase가 여기로 리다이렉트 → 토큰 추출 → 앱으로 딥링크 전달
//
// 플로우:
// 1. Supabase redirects to: https://hanbang.ai/auth/mobile-callback#access_token=xxx&refresh_token=xxx
// 2. 이 페이지가 hash fragment에서 토큰 추출
// 3. hanbang:// deep link receives the token fragment
// 4. 앱이 토큰으로 세션 생성

import { useEffect, useState } from "react";

const palette = {
  bg: "#FBF8F2",
  ink: "#36534E",
  text: "#263832",
  muted: "#5F5B52",
  champagne: "#E2D3C8",
};

export default function MobileCallbackPage() {
  const [status, setStatus] = useState("앱으로 돌아가는 중...");

  useEffect(() => {
    // URL의 hash fragment 또는 query params에서 토큰 추출
    const hash = window.location.hash.substring(1); // # 제거
    const query = window.location.search.substring(1); // ? 제거
    const params = new URLSearchParams(hash || query);

    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (accessToken && refreshToken) {
      // 앱으로 딥링크 전달
      const tokenFragment = new URLSearchParams({
        access_token: accessToken,
        refresh_token: refreshToken,
      }).toString();
      const appUrl = `hanbang://auth/callback#${tokenFragment}`;
      const devExpoCallback = process.env.NEXT_PUBLIC_EXPO_AUTH_CALLBACK_URL;

      // Expo Go용 (개발 환경)
      let devFallbackTimer: number | undefined;

      // Production only attempts the app scheme. Dev fallback is opt-in by env.
      window.location.href = appUrl;

      // 0.5초 후 아직 이 페이지에 있으면 Expo Go URL 시도
      if (process.env.NODE_ENV !== "production" && devExpoCallback) {
        devFallbackTimer = window.setTimeout(() => {
          window.location.href = `${devExpoCallback}#${tokenFragment}`;
        }, 500);
      }

      // 2초 후에도 이 페이지에 있으면 수동 안내
      const statusTimer = window.setTimeout(() => {
        setStatus("앱이 열리지 않으면 Expo Go 앱으로 직접 돌아가주세요.");
      }, 2000);

      return () => {
        if (devFallbackTimer) window.clearTimeout(devFallbackTimer);
        window.clearTimeout(statusTimer);
      };
    } else {
      const timer = window.setTimeout(() => {
        setStatus("토큰을 받지 못했습니다. 다시 로그인해주세요.");
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      background: palette.bg,
      fontFamily: "'Paperlogy', sans-serif",
      padding: "20px",
    }}>
      <div style={{
        width: 64,
        height: 64,
        borderRadius: 20,
        background: palette.ink,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 24,
        color: palette.champagne,
        fontSize: 28,
      }}>
        ✦
      </div>
      <p style={{ color: palette.text, fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
        웨딩한방
      </p>
      <p style={{ color: palette.muted, fontSize: 14 }}>
        {status}
      </p>
    </div>
  );
}
