"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Logo from "@/components/ui/Logo";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [loading, setLoading] = useState<string | null>(null);

  const handleOAuth = async (provider: "kakao" | "google") => {
    setLoading(provider);
    try {
      const supabase = createClient();
      await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback`,
        },
      });
    } catch {
      setLoading(null);
    }
  };

  const handleDemo = () => {
    document.cookie = "demo_mode=true; path=/; max-age=86400";
    window.location.href = "/dashboard";
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-ivory-50 via-ivory-warm to-ivory-deep flex items-center justify-center px-5">
      {/* 배경 장식 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -right-[5%] w-[500px] h-[500px] rounded-full bg-[radial-gradient(circle,var(--rose-pale),transparent)] blur-[100px] opacity-25" />
        <div className="absolute -bottom-[10%] -left-[5%] w-[400px] h-[400px] rounded-full bg-[radial-gradient(circle,var(--gold-light),transparent)] blur-[100px] opacity-25" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="relative z-10 w-full max-w-[420px]"
      >
        {/* 로고 */}
        <div className="text-center mb-10">
          <a href="/">
            <Logo size="md" />
          </a>
          <p className="text-[14px] text-taupe-500 font-light mt-3">
            AI 웨딩 플래너와 함께하는 결혼 준비
          </p>
        </div>

        {/* 로그인 카드 */}
        <div className="bg-white/80 backdrop-blur-[20px] rounded-3xl border border-black/[0.04] p-8 shadow-[0_8px_40px_rgba(0,0,0,0.04)]">
          <h1 className="font-serif-kr text-[24px] font-light text-noir-800 text-center mb-2">
            로그인
          </h1>
          <p className="text-[13px] text-taupe-400 text-center mb-8">
            소셜 계정으로 간편하게 시작하세요
          </p>

          <div className="space-y-3">
            {/* 카카오 로그인 */}
            <button
              onClick={() => handleOAuth("kakao")}
              disabled={loading !== null}
              className="w-full flex items-center justify-center gap-3 py-3.5 px-6 rounded-2xl text-[14px] font-medium transition-all hover:-translate-y-0.5 bg-[#FEE500] text-[#191919] hover:shadow-[0_4px_16px_rgba(254,229,0,0.3)]"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M9 1C4.58 1 1 3.79 1 7.21c0 2.17 1.45 4.08 3.63 5.18l-.93 3.44c-.08.3.26.54.52.37l4.1-2.72c.22.02.44.03.68.03 4.42 0 8-2.79 8-6.3C17 3.79 13.42 1 9 1z" fill="#191919"/>
              </svg>
              {loading === "kakao" ? "연결 중..." : "카카오로 시작하기"}
            </button>

            {/* 구글 로그인 */}
            <button
              onClick={() => handleOAuth("google")}
              disabled={loading !== null}
              className="w-full flex items-center justify-center gap-3 py-3.5 px-6 rounded-2xl text-[14px] font-medium transition-all hover:-translate-y-0.5 bg-white border border-black/[0.08] text-noir-800 hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92a8.78 8.78 0 002.68-6.62z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 009 18z" fill="#34A853"/>
                <path d="M3.97 10.71A5.41 5.41 0 013.68 9c0-.6.1-1.17.28-1.71V4.96H.96A9 9 0 000 9c0 1.45.35 2.83.96 4.04l3.01-2.33z" fill="#FBBC05"/>
                <path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 00.96 4.96l3.01 2.33C4.68 5.17 6.66 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              {loading === "google" ? "연결 중..." : "Google로 시작하기"}
            </button>
          </div>

          {/* 구분선 */}
          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-platinum" />
            <span className="text-[11px] text-taupe-400">또는</span>
            <div className="flex-1 h-px bg-platinum" />
          </div>

          {/* 데모 체험 */}
          <button
            onClick={handleDemo}
            className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-2xl text-[14px] font-medium transition-all hover:-translate-y-0.5 bg-noir-800 text-white hover:bg-noir-soft hover:shadow-[0_4px_16px_rgba(26,26,31,0.15)]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>
            </svg>
            로그인 없이 체험하기
          </button>

          <p className="text-[11px] text-taupe-400 text-center mt-4 font-light">
            체험 모드에서는 모든 기능을 미리 둘러볼 수 있습니다
          </p>
        </div>

        {/* 하단 링크 */}
        <div className="text-center mt-6">
          <a href="/" className="text-[13px] text-taupe-400 hover:text-rose-500 transition-colors">
            ← 홈으로 돌아가기
          </a>
        </div>
      </motion.div>
    </div>
  );
}
