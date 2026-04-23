"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";

export default function Hero() {
  return (
    <section className="relative min-h-[100vh] flex flex-col justify-center pt-[96px] pb-[clamp(80px,10vw,120px)] px-[clamp(20px,5vw,60px)] bg-ivory-50 overflow-hidden">
      {/* 단일 은은한 glow */}
      <div
        className="absolute top-[18%] right-[-8%] w-[min(720px,85vw)] h-[min(720px,85vw)] bg-[radial-gradient(circle,rgba(121,82,82,0.07),transparent_65%)] rounded-full pointer-events-none"
        aria-hidden
      />

      <div className="relative z-10 max-w-[1240px] w-full mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-[clamp(48px,7vw,112px)] items-center">
          {/* 좌측 카피 */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
            className="text-center md:text-left"
          >
            {/* Display H1 */}
            <h1 className="font-serif-kr text-[clamp(36px,6.5vw,76px)] text-noir-800 leading-[1.1] tracking-[-0.015em] font-light">
              당신만의
              <br />
              AI 웨딩 플래너,
              <br />
              <em className="not-italic text-rose-500">아모라.</em>
            </h1>

            {/* 얇은 rose 구분선 */}
            <div className="w-12 h-px bg-rose-500 my-10 md:my-14 mx-auto md:mx-0" aria-hidden />

            {/* Sub */}
            <p className="text-charcoal text-[15px] md:text-[17px] leading-[2] font-light max-w-[520px] mx-auto md:mx-0">
              당신도 모르는 당신의 선호를 끌어내고,
              <br />
              파트너와 합의로 가도록 중재하고,
              <br />
              6개월 전 결정까지 기억합니다.
            </p>

            {/* CTA — 단일 primary + 부드러운 secondary */}
            <div className="flex flex-col sm:flex-row gap-5 sm:gap-10 mt-14 items-center md:items-start">
              <Link
                href="/beta"
                className="group inline-flex items-center gap-2 text-[14px] text-noir-800 font-medium border-b border-noir-800 pb-2 tracking-[0.02em] hover:text-rose-500 hover:border-rose-500 transition-colors"
              >
                베타 50쌍 한정 모집
                <ArrowUpRight className="w-4 h-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/chat"
                className="inline-flex items-center text-[14px] text-taupe-500 font-light tracking-[0.02em] hover:text-noir-800 transition-colors"
              >
                아모라와 먼저 대화해보기
              </Link>
            </div>
          </motion.div>

          {/* 우측 대화 카드 — 절제, 폰 스크린 느낌 */}
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.1, ease: "easeOut", delay: 0.25 }}
            className="hidden lg:block relative"
          >
            {/* 배경 레이어 1 */}
            <div
              className="absolute -top-6 -right-6 w-full h-full rounded-[32px] bg-rose-pale/25 pointer-events-none"
              aria-hidden
            />
            {/* 배경 레이어 2 */}
            <div
              className="absolute -bottom-6 -left-6 w-full h-full rounded-[32px] border border-rose-500/25 pointer-events-none"
              aria-hidden
            />

            {/* 실제 카드 */}
            <div className="relative bg-white rounded-[32px] px-8 py-10 shadow-[0_40px_80px_-30px_rgba(26,26,31,0.2)]">
              {/* 시그니처 상단 */}
              <div className="flex items-center gap-2.5 mb-10">
                <span className="w-6 h-6 rounded-full bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center text-white text-[10px] font-display leading-none">
                  A
                </span>
                <span className="font-serif-kr text-sm text-noir-800 font-medium">아모라</span>
                <span className="text-[10px] text-taupe-400 tracking-[0.15em] ml-auto">
                  · 24시간
                </span>
              </div>

              {/* 메시지 — 길고 여유롭게 */}
              <p className="font-serif-kr text-[22px] md:text-[26px] text-noir-800 leading-[1.55] font-light mb-3">
                지난주에
                <br />
                <em className="not-italic text-rose-500">&ldquo;양가 상견례 부담&rdquo;</em>
                <br />
                말씀하셨죠.
              </p>

              <p className="font-serif-kr text-[17px] md:text-[18px] text-charcoal leading-[1.7] font-light">
                오늘 그 이야기,
                <br />
                이어가 볼까요?
              </p>

              {/* 시그니처 하단 */}
              <p className="mt-10 pt-6 border-t border-platinum/60 text-[10px] tracking-[0.22em] text-taupe-400 font-medium">
                AI 생성
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
