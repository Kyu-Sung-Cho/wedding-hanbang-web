"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

export default function Hero() {
  return (
    <section className="min-h-screen flex items-center justify-center relative overflow-hidden bg-gradient-to-br from-ivory-50 via-ivory-warm to-ivory-deep">
      {/* 배경 오브 */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-[10%] -right-[5%] w-[500px] h-[500px] rounded-full bg-[radial-gradient(circle,var(--rose-pale),transparent)] blur-[80px] opacity-40 animate-[orbFloat_20s_ease-in-out_infinite]" />
        <div className="absolute -bottom-[15%] -left-[5%] w-[400px] h-[400px] rounded-full bg-[radial-gradient(circle,var(--gold-light),transparent)] blur-[80px] opacity-40 animate-[orbFloat_20s_ease-in-out_infinite_-7s]" />
        <div className="absolute top-[40%] left-[30%] w-[320px] h-[300px] rounded-full bg-[radial-gradient(circle,rgba(196,150,126,0.3),transparent)] blur-[80px] opacity-40 animate-[orbFloat_20s_ease-in-out_infinite_-14s]" />
      </div>

      <div className="relative z-10 text-center max-w-[955px] px-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.2 }}
          className="inline-flex items-center gap-2 px-5 py-2 bg-white/70 backdrop-blur-[10px] border border-rose-pale/20 rounded-full mb-10 text-[21px] text-charcoal tracking-wide"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
          AI 웨딩 플래너 — 지금 무료로 이용 가능
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.4 }}
          className="font-serif-kr text-[clamp(40px,6vw,72px)] font-light leading-[1.25] tracking-tight mb-7"
        >
          당신의 완벽한 결혼,
          <br />
          <em className="not-italic font-medium bg-gradient-to-br from-rose-500 to-gold bg-clip-text text-transparent">
            웨딩한방
          </em>
          이 함께합니다
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.6 }}
          className="text-[21px] leading-relaxed text-charcoal max-w-[560px] mx-auto mb-12 font-light tracking-tight"
        >
          24시간 맞춤 상담, AI 드레스 가상 피팅, 스마트 예산 관리까지.
          <br />
          웨딩 플래너 없이도 완벽한 결혼 준비를 시작하세요.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.8 }}
          className="flex gap-4 justify-center flex-wrap"
        >
          <a
            href="/login"
            className="group inline-flex items-center gap-2.5 px-9 py-4 bg-noir-800 text-white rounded-full text-[21px] font-medium hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(26,26,31,0.2)] transition-all duration-400"
          >
            무료로 시작하기
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </a>
          <a
            href="#features"
            className="inline-flex items-center gap-2.5 px-9 py-4 bg-transparent text-noir-800 border-[1.5px] border-platinum rounded-full text-[21px] font-normal hover:border-rose-500 hover:text-rose-500 hover:-translate-y-0.5 transition-all duration-400"
          >
            기능 둘러보기
          </a>
        </motion.div>
      </div>

      {/* 스크롤 힌트 */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 1.2 }}
        className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
      >
        <span className="text-[21px] tracking-[0.15em] uppercase text-taupe-500">
          Scroll
        </span>
        <div className="w-px h-10 bg-gradient-to-b from-taupe-400 to-transparent animate-[scrollLine_2s_ease-in-out_infinite]" />
      </motion.div>
    </section>
  );
}
