"use client";

// 모바일 OAuth 콜백 중간 페이지
// Supabase가 여기로 리다이렉트 → 토큰 추출 → 앱으로 딥링크 전달
//
// 플로우:
// 1. Supabase redirects to: https://hanbang.ai/auth/mobile-callback#access_token=xxx&refresh_token=xxx
// 2. 이 페이지가 hash fragment에서 토큰 추출
// 3. exp:// 또는 hanbang:// 딥링크로 앱에 토큰 전달
// 4. 앱이 토큰으로 세션 생성

import { useEffect, useState } from "react";

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
      const appUrl = `hanbang://auth/callback#access_token=${accessToken}&refresh_token=${refreshToken}`;

      // Expo Go용 (개발 환경)
      const expoUrl = `exp://192.168.0.23:8081/--/auth/callback#access_token=${accessToken}&refresh_token=${refreshToken}`;

      // 먼저 hanbang:// 시도, 실패하면 exp:// 시도
      window.location.href = appUrl;

      // 0.5초 후 아직 이 페이지에 있으면 Expo Go URL 시도
      setTimeout(() => {
        window.location.href = expoUrl;
      }, 500);

      // 2초 후에도 이 페이지에 있으면 수동 안내
      setTimeout(() => {
        setStatus("앱이 열리지 않으면 Expo Go 앱으로 직접 돌아가주세요.");
      }, 2000);
    } else {
      setStatus("토큰을 받지 못했습니다. 다시 로그인해주세요.");
    }
  }, []);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      background: "#FAFAF8",
      fontFamily: "'Noto Sans KR', sans-serif",
      padding: "20px",
    }}>
      <div style={{
        width: 64,
        height: 64,
        borderRadius: 20,
        background: "#1A1A1F",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 24,
        color: "#C9A96E",
        fontSize: 28,
      }}>
        ✦
      </div>
      <p style={{ color: "#1A1A1F", fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
        웨딩한방
      </p>
      <p style={{ color: "#878680", fontSize: 14 }}>
        {status}
      </p>
    </div>
  );
}
