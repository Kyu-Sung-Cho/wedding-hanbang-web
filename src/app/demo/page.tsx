"use client";

import { useEffect } from "react";

export default function DemoPage() {
  useEffect(() => {
    // 데모 모드 쿠키 설정 (24시간)
    document.cookie = "demo_mode=true; path=/; max-age=86400";
    // 대시보드로 리다이렉트
    window.location.href = "/dashboard";
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FDFCFA]">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-[#C4967E] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-[#928980] text-sm">데모 모드로 진입 중...</p>
      </div>
    </div>
  );
}
