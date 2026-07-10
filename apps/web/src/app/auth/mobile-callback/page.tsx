"use client";

// 모바일 OAuth는 verified App/Universal Link + PKCE/state 검증 전까지 중지한다.
// Raw access/refresh token을 private-use custom scheme으로 전달하면 다른 앱의
// scheme 가로채기와 session swapping 위험이 있으므로 이 페이지는 토큰을
// 즉시 URL에서 제거하고 앱으로 전달하지 않는다.

import { useEffect, useState } from "react";

export default function MobileCallbackPage() {
  const [status, setStatus] = useState("모바일 소셜 로그인을 안전하게 개선하고 있어요.");

  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
    const timer = window.setTimeout(() => {
      setStatus("앱으로 돌아가 이메일 로그인을 이용해 주세요.");
    }, 500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ivory-50 p-5 font-sans">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-[20px] bg-[#36534E] text-[28px] text-[#E2D3C8]">
        ✦
      </div>
      <p className="mb-2 text-base font-medium text-[#263832]">
        웨딩한방
      </p>
      <p className="text-center text-sm leading-relaxed text-[#5F5B52]">
        {status}
      </p>
    </div>
  );
}
