"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function VendorServicePage() {
  return (
    <div className="min-h-screen bg-noir-800 flex flex-col">
      {/* 헤더 */}
      <nav className="px-[clamp(20px,5vw,60px)] h-[72px] flex items-center">
        <Link
          href="/business"
          className="flex items-center gap-2 text-[25px] text-white/50 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          메인페이지로
        </Link>
      </nav>

      {/* 준비중 콘텐츠 */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center max-w-[480px]">
          <div className="inline-flex items-center gap-2 text-[38px] tracking-[0.18em] uppercase text-rose-light font-medium mb-8">
            <span className="w-5 h-px bg-rose-light" />
            Coming Soon
            <span className="w-5 h-px bg-rose-light" />
          </div>

          <h1 className="font-serif-kr text-[clamp(28px,4vw,44px)] font-light leading-[1.35] tracking-tight text-white mb-6">
            서비스 안내 페이지
            <br />
            준비 중입니다
          </h1>

          <p className="text-[clamp(14px,1.8vw,16px)] leading-relaxed text-white/50 font-light mb-12">
            파트너 서비스 안내 페이지를 준비하고 있습니다.
            <br />
            빠른 시일 내에 찾아뵙겠습니다.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-10">
            <Link
              href="/business"
              className="px-10 py-4 rounded-full bg-gradient-to-r from-rose-500 to-gold text-white text-[38px] font-medium hover:shadow-[0_8px_32px_rgba(196,150,126,0.3)] hover:-translate-y-0.5 transition-all text-center"
            >
              메인페이지로 돌아가기
            </Link>
          </div>

          <a
            href="mailto:partner@hanbang.ai"
            className="text-[25px] text-white/40 hover:text-white/60 transition-colors underline underline-offset-4"
          >
            문의: partner@hanbang.ai
          </a>
        </div>
      </div>
    </div>
  );
}
