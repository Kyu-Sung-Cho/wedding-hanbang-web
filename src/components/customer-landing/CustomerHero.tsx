"use client";

import { motion } from "framer-motion";

export default function CustomerHero() {
  return (
    <section className="min-h-screen flex items-center justify-center relative overflow-hidden bg-ivory-50">
      {/* 배경 */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,rgba(196,150,126,0.08),transparent)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_60%_at_80%_100%,rgba(201,169,110,0.06),transparent)]" />
      </div>

      {/* 상단·하단 라인 */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-platinum to-transparent" />

      <div className="relative z-10 text-center max-w-[900px] px-6 py-32">
        {/* 배지 */}
        <motion.button
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          onClick={() => document.getElementById("cta")?.scrollIntoView({ behavior: "smooth" })}
          className="inline-flex items-center gap-3 px-5 py-2.5 bg-white/80 backdrop-blur-sm border border-platinum rounded-full mb-12 cursor-pointer hover:bg-white hover:border-rose-500/30 transition-all"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
          <span className="text-[13px] text-charcoal tracking-wide font-light">
            사전등록 진행 중
          </span>
          <span className="text-[11px] text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded-full font-medium">
            무료
          </span>
        </motion.button>

        {/* 메인 헤드라인 */}
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.4 }}
          className="font-serif-kr text-[clamp(40px,7vw,76px)] font-extralight leading-[1.15] tracking-tight mb-8 text-noir-800"
        >
          결혼 준비,
          <br />
          <span className="font-medium bg-gradient-to-r from-[#C4967E] via-[#C9A96E] to-[#B8976A] bg-clip-text text-transparent">
            한방
          </span>
          에
        </motion.h1>

        {/* 서브 카피 */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.6 }}
          className="text-[clamp(15px,1.6vw,18px)] leading-[1.9] text-taupe-500 max-w-[480px] mx-auto mb-14 font-light"
        >
          AI가 딱 맞는 업체를 추천하고
          <br />
          새벽에도 답해주는 웨딩 플래너가 되어줍니다
        </motion.p>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.8 }}
          className="flex gap-4 justify-center flex-wrap mb-20"
        >
          <a
            href="/login"
            className="group inline-flex items-center gap-2.5 px-10 py-4 bg-noir-800 text-white rounded-full text-[15px] font-medium hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(26,26,31,0.15)] transition-all duration-300"
          >
            무료로 시작하기
            <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </a>
          <a
            href="#features"
            className="inline-flex items-center gap-2.5 px-10 py-4 bg-transparent text-charcoal border border-platinum rounded-full text-[15px] font-light hover:border-rose-500 hover:text-rose-500 hover:-translate-y-0.5 transition-all duration-300"
          >
            기능 둘러보기
          </a>
        </motion.div>

        {/* 하단 신뢰 지표 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 1.1 }}
          className="flex justify-center gap-12 max-md:gap-8"
        >
          {[
            { num: "24시간", label: "AI 상담" },
            { num: "커플 연동", label: "함께 준비" },
            { num: "All-in-One", label: "결혼 준비" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="font-display text-[clamp(20px,3vw,28px)] font-medium bg-gradient-to-r from-rose-500 to-gold bg-clip-text text-transparent">
                {stat.num}
              </div>
              <div className="text-[13px] text-taupe-500 mt-1.5 font-normal tracking-wide">{stat.label}</div>
            </div>
          ))}
        </motion.div>
      </div>

      {/* 스크롤 힌트 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 1.4 }}
        className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
      >
        <span className="text-[10px] tracking-[0.2em] uppercase text-taupe-400">
          Scroll
        </span>
        <div className="w-px h-8 bg-gradient-to-b from-taupe-400 to-transparent animate-[scrollLine_2s_ease-in-out_infinite]" />
      </motion.div>
    </section>
  );
}
