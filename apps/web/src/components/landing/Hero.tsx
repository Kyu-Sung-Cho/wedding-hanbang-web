"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Sparkles, ArrowUpRight } from "lucide-react";

const ROLE_CHIPS = [
  "막연함을 끌어내는",
  "파트너와 중재하는",
  "6개월 전을 기억하는",
];

export default function Hero() {
  return (
    <section className="relative pt-[112px] pb-[clamp(80px,12vw,160px)] px-[clamp(20px,5vw,60px)] bg-ivory-50 overflow-hidden">
      {/* 배경: 매우 은은한 단일 glow */}
      <div className="absolute top-[10%] right-[-10%] w-[min(640px,80vw)] h-[min(640px,80vw)] bg-[radial-gradient(circle,rgba(121,82,82,0.06),transparent_65%)] rounded-full pointer-events-none" />

      <div className="relative z-10 max-w-[1240px] mx-auto">
        {/* 에디토리얼 상단 메타 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
          className="flex items-center justify-between text-[11px] tracking-[0.22em] uppercase text-taupe-400 mb-16 md:mb-24 font-medium"
        >
          <span>Issue 01 · Spring 2026</span>
          <span className="hidden md:inline">Seoul · Korea</span>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-[clamp(40px,6vw,96px)] items-end">
          {/* 좌측 카피 */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
            className="text-center md:text-left"
          >
            {/* Display H1 */}
            <h1 className="font-serif-kr text-[clamp(36px,6.5vw,80px)] text-noir-800 leading-[1.08] tracking-[-0.01em] font-light">
              새벽 3시,
              <br />
              결혼 카페에서
              <br />
              <em className="not-italic font-serif-kr text-rose-500">50개 글</em>
              을 읽고도
              <br />
              답을 <span className="italic font-display tracking-tight">못 찾았나요</span>?
            </h1>

            {/* 구분선 */}
            <div className="w-16 h-px bg-taupe-400/60 my-10 md:my-12 mx-auto md:mx-0" aria-hidden />

            {/* Sub */}
            <p className="text-charcoal text-[15px] md:text-base leading-[1.9] font-light max-w-[540px] mx-auto md:mx-0">
              결혼 준비는 평생 한 번. 1,500개의 결정.
              <br />
              당신도 모르는 당신의 선호까지 끌어내고,
              <br />
              파트너와 합의로 가도록 중재하고,
              <br />
              <span className="text-noir-800">6개월 전 결정도 기억하는</span> AI 웨딩 플래너, 아모라.
            </p>

            {/* CTA — 플랫, 텍스트링크 위주 */}
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-8 mt-12 items-center md:items-start">
              <Link
                href="/beta"
                className="group inline-flex items-center gap-2 text-[14px] text-noir-800 font-medium border-b border-noir-800 pb-1.5 tracking-wide hover:text-rose-500 hover:border-rose-500 transition-colors"
              >
                베타 50쌍 한정 모집
                <ArrowUpRight className="w-4 h-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/chat"
                className="inline-flex items-center gap-2 text-[14px] text-charcoal font-light pb-1.5 tracking-wide hover:text-noir-800 transition-colors"
              >
                <span className="opacity-60">또는</span>
                <span className="underline underline-offset-4 decoration-taupe-400/60 hover:decoration-noir-800">
                  아모라와 먼저 대화해보기
                </span>
              </Link>
            </div>
          </motion.div>

          {/* 우측 카드 — 모바일 숨김, 더 절제된 톤 */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
            className="hidden lg:block relative"
          >
            {/* 카드 뒤 accent 프레임 */}
            <div className="absolute -top-4 -right-4 w-full h-full border border-rose-500/40 rounded-[28px] pointer-events-none" aria-hidden />

            <div className="relative bg-white rounded-[28px] p-8 shadow-[0_30px_80px_-20px_rgba(26,26,31,0.18)]">
              {/* 카드 상단 라벨 */}
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-sage-500 animate-pulse" />
                  <span className="text-[10px] tracking-[0.22em] uppercase text-taupe-400 font-medium">
                    Live · Amora
                  </span>
                </div>
                <Sparkles className="w-3.5 h-3.5 text-gold" />
              </div>

              {/* 메시지 — 단일, 여백 풍부 */}
              <p className="font-serif-kr text-[22px] md:text-[24px] text-noir-800 leading-[1.55] font-light mb-3">
                지난주에 <span className="text-rose-500">&ldquo;양가 상견례 부담&rdquo;</span> 말씀하셨죠.
              </p>
              <p className="font-serif-kr text-[18px] text-charcoal leading-[1.6] font-light">
                오늘 그 이야기, 이어가 볼까요?
              </p>

              {/* 구분선 */}
              <div className="h-px w-full bg-platinum/80 my-8" aria-hidden />

              {/* 역할 3개 — 미니멀 리스트 */}
              <ul className="space-y-2.5">
                {ROLE_CHIPS.map((role, idx) => (
                  <li key={role} className="flex items-baseline gap-3 text-[13px] text-taupe-500">
                    <span className="font-display text-rose-500/70 text-xs w-4">
                      0{idx + 1}
                    </span>
                    <span className="font-light tracking-wide">{role}</span>
                  </li>
                ))}
              </ul>

              {/* 하단 메타 */}
              <p className="mt-6 text-[10px] tracking-[0.18em] uppercase text-taupe-400/80">
                · AI Generated
              </p>
            </div>
          </motion.div>
        </div>

        {/* 하단 Trust Bar */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="mt-20 md:mt-32 pt-8 border-t border-platinum flex flex-col md:flex-row md:justify-between gap-3 text-[11px] tracking-[0.2em] uppercase text-taupe-400 font-medium"
        >
          <span>한국소비자원 · 기획재정부 데이터 기반</span>
          <span className="hidden md:inline">AI 기본법 준수 · 2026.1.22</span>
        </motion.div>
      </div>
    </section>
  );
}
