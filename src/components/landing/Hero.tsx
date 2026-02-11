"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

export default function Hero() {
  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-b from-ivory-50 via-ivory-warm to-ivory-deep">
      {/* 배경 오브 */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-[10%] -right-[5%] h-[500px] w-[500px] animate-[orbFloat_20s_ease-in-out_infinite] rounded-full bg-[radial-gradient(circle,_var(--color-rose-pale),_transparent)] opacity-40 blur-[80px]" />
        <div className="absolute -bottom-[15%] -left-[5%] h-[400px] w-[400px] animate-[orbFloat_20s_ease-in-out_infinite_-7s] rounded-full bg-[radial-gradient(circle,_var(--color-gold-light),_transparent)] opacity-40 blur-[80px]" />
        <div className="absolute top-[40%] left-[30%] h-[300px] w-[300px] animate-[orbFloat_20s_ease-in-out_infinite_-14s] rounded-full bg-[radial-gradient(circle,_rgba(196,150,126,0.3),_transparent)] opacity-40 blur-[80px]" />
      </div>

      <div className="relative z-[2] px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.2 }}
          className="mb-10 inline-flex items-center gap-2 rounded-full border border-rose-500/20 bg-white/70 px-5 py-2 text-[13px] tracking-[0.02em] text-charcoal backdrop-blur-[10px]"
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />
          AI 웨딩 플래너 — 지금 바로 시작하세요
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.4 }}
          className="mb-7 font-serif text-[clamp(40px,6vw,72px)] font-light leading-[1.25] tracking-[-0.03em]"
        >
          결혼 준비,
          <br />
          이제{" "}
          <em className="bg-gradient-to-br from-rose-500 to-gold bg-clip-text not-italic font-medium text-transparent">
            AI 한 방
          </em>
          이면 됩니다
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.6 }}
          className="mx-auto mb-12 max-w-[560px] text-[17px] font-light leading-[1.7] tracking-[-0.01em] text-charcoal"
        >
          24시간 맞춤 상담, AI 드레스 가상 피팅, 스마트 예산 관리까지.
          <br />
          웨딩 플래너 없이도 완벽한 결혼 준비를 시작하세요.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.8 }}
          className="flex flex-wrap justify-center gap-4"
        >
          <Link
            href="/login"
            className="group inline-flex items-center gap-2.5 rounded-full bg-noir-800 px-9 py-4 text-[15px] font-medium tracking-[-0.01em] text-white transition-all duration-400 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(26,26,31,0.2)]"
          >
            무료로 시작하기
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a
            href="#features"
            className="inline-flex items-center gap-2.5 rounded-full border-[1.5px] border-platinum px-9 py-4 text-[15px] font-normal tracking-[-0.01em] text-noir-800 transition-all duration-400 hover:-translate-y-0.5 hover:border-rose-500 hover:text-rose-500"
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
        className="absolute bottom-10 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2"
      >
        <span className="text-[11px] uppercase tracking-[0.15em] text-taupe-500">
          Scroll
        </span>
        <div className="h-10 w-px animate-[scrollLine_2s_ease-in-out_infinite] bg-gradient-to-b from-taupe-light to-transparent" />
      </motion.div>
    </section>
  );
}
