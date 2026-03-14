"use client";

import { motion } from "framer-motion";
import Logo from "@/components/ui/Logo";

export default function DemoLandingPage() {
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
          <Logo size="md" />
          <p className="text-[14px] text-taupe-500 font-light mt-3">
            AI 웨딩 플래너와 함께하는 결혼 준비
          </p>
        </div>

        {/* 카드 */}
        <div className="bg-white/80 backdrop-blur-[20px] rounded-3xl border border-black/[0.04] p-8 shadow-[0_8px_40px_rgba(0,0,0,0.04)]">
          {/* 내부 개발자 배지 */}
          <div className="flex justify-center mb-5">
            <span className="text-[11px] px-3 py-1 rounded-full bg-noir-800 text-white font-medium tracking-wide">
              INTERNAL DEV
            </span>
          </div>

          <h1 className="font-serif-kr text-[24px] font-light text-noir-800 text-center mb-2">
            웨딩한방 데모
          </h1>
          <p className="text-[13px] text-taupe-500 text-center mb-8 leading-relaxed">
            내부 테스트 및 서비스 확인용 페이지입니다.
            <br />
            로그인하여 실제 서비스를 체험할 수 있습니다.
          </p>

          {/* 서비스 사용하기 (로그인) */}
          <a
            href="/demo/login"
            className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-2xl text-[14px] font-medium transition-all hover:-translate-y-0.5 bg-noir-800 text-white hover:bg-noir-soft hover:shadow-[0_4px_16px_rgba(26,26,31,0.15)]"
          >
            서비스 사용하기
          </a>

          {/* 구분선 */}
          <div className="flex items-center gap-4 my-5">
            <div className="flex-1 h-px bg-platinum" />
            <span className="text-[11px] text-taupe-400">또는</span>
            <div className="flex-1 h-px bg-platinum" />
          </div>

          {/* 로그인 없이 둘러보기 */}
          <button
            onClick={() => {
              document.cookie = "demo_mode=true; path=/; max-age=86400";
              window.location.href = "/dashboard";
            }}
            className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-2xl text-[14px] font-medium transition-all hover:-translate-y-0.5 border-[1.5px] border-rose-500 text-rose-500 hover:bg-rose-500/5"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" />
            </svg>
            로그인 없이 둘러보기
          </button>

          <p className="text-[11px] text-taupe-400 text-center mt-4 font-light">
            체험 모드에서는 샘플 데이터로 둘러볼 수 있습니다
          </p>
        </div>

        {/* 하단 링크 */}
        <div className="flex items-center justify-center gap-4 mt-6">
          <a href="/" className="text-[13px] text-taupe-400 hover:text-rose-500 transition-colors">
            ← 홈으로
          </a>
        </div>
      </motion.div>
    </div>
  );
}
