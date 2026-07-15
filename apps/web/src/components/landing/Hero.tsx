"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { weddingPath } from "@/lib/weddingPaths";

export default function Hero() {
  return (
    <section className="relative min-h-[88vh] lg:min-h-[100vh] flex flex-col justify-center pt-[96px] pb-[clamp(60px,8vw,100px)] px-[clamp(20px,5vw,60px)] bg-ivory-50 overflow-hidden">
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
            className="flex flex-col items-center text-center md:items-start md:text-left"
          >
            {/* Display H1 */}
            <h1 className="font-serif-kr text-[clamp(34px,6vw,68px)] text-noir-800 leading-[1.2] tracking-[-0.015em] font-light">
              당신만의
              <br />
              AI 웨딩 플래너,
              <br />
              <em className="not-italic text-rose-500">아모라.</em>
            </h1>

            {/* 얇은 rose 구분선 */}
            <div className="w-12 h-px bg-rose-500 my-10 md:my-14 mx-auto md:mx-0" aria-hidden />

            {/* Sub */}
            <p className="text-charcoal text-[15px] md:text-[17px] leading-[1.85] font-light max-w-[520px] mx-auto md:mx-0">
              말해주신 취향과 조건을 차분히 정리하고,
              <br />
              파트너와 합의로 가도록 중재하고,
              <br />
              기억을 켜면 확정한 선택을 다음 상담에도 이어갑니다.
            </p>

            {/* CTA */}
            <div className="flex flex-col sm:flex-row gap-5 sm:gap-10 mt-12 items-center md:items-start">
              <Link
                href="/beta"
                className="group inline-flex items-center gap-2 text-[14px] md:text-[15px] text-noir-800 font-medium border-b border-noir-800 pb-2 tracking-[0.02em] hover:text-rose-500 hover:border-rose-500 transition-colors"
              >
                베타 50쌍 한정 모집
                <ArrowUpRight className="w-4 h-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
              <Link
                href={weddingPath("/chat")}
                className="inline-flex items-center text-[14px] md:text-[15px] text-taupe-500 font-light tracking-[0.02em] hover:text-noir-800 transition-colors"
              >
                아모라와 먼저 대화해보기
              </Link>
            </div>
          </motion.div>

          {/* 우측 대화 카드 */}
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

            <div className="relative bg-white rounded-[32px] px-8 py-10 shadow-[0_40px_80px_-30px_rgba(26,26,31,0.2)]">
              <div className="flex items-center gap-2.5 mb-10">
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center text-white text-[12px] font-display leading-none">
                  A
                </span>
                <span className="font-serif-kr text-[15px] text-noir-800 font-medium">아모라</span>
                <span className="text-[12px] text-taupe-400 tracking-[0.15em] ml-auto">
                  · 24시간
                </span>
              </div>

              <p className="font-serif-kr text-[20px] md:text-[24px] text-noir-800 leading-[1.55] font-light mb-3">
                지난주에
                <br />
                <em className="not-italic text-rose-500">&ldquo;양가 상견례 부담&rdquo;</em>
                <br />
                말씀하셨죠.
              </p>

              <p className="font-serif-kr text-[16px] md:text-[18px] text-charcoal leading-[1.7] font-light">
                오늘 그 이야기,
                <br />
                이어가 볼까요?
              </p>

              <p className="mt-10 pt-6 border-t border-platinum/60 text-[11px] md:text-[12px] tracking-[0.22em] text-taupe-400 font-medium">
                AI 생성
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
