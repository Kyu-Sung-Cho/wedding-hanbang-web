"use client";

import { motion } from "framer-motion";

export default function CustomerHero() {
  return (
    <section className="min-h-screen flex items-center justify-center relative overflow-hidden bg-gradient-to-br from-ivory-50 via-ivory-warm to-ivory-deep">
      {/* 배경 그라데이션 오브 */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-[10%] -right-[5%] w-[600px] h-[600px] rounded-full bg-[radial-gradient(circle,var(--rose-pale),transparent)] blur-[100px] opacity-30 animate-[orbFloat_20s_ease-in-out_infinite]" />
        <div className="absolute -bottom-[15%] -left-[5%] w-[500px] h-[500px] rounded-full bg-[radial-gradient(circle,var(--gold-light),transparent)] blur-[100px] opacity-30 animate-[orbFloat_20s_ease-in-out_infinite_-7s]" />
        <div className="absolute top-[40%] left-[50%] -translate-x-1/2 w-[400px] h-[400px] rounded-full bg-[radial-gradient(circle,rgba(196,150,126,0.15),transparent)] blur-[80px] opacity-40 animate-[orbFloat_20s_ease-in-out_infinite_-14s]" />
      </div>

      {/* 장식 라인 */}
      <div className="absolute top-0 left-0 right-0 bottom-0 pointer-events-none">
        <div className="absolute top-[20%] left-[8%] w-px h-[120px] bg-gradient-to-b from-transparent via-rose-500/20 to-transparent max-md:hidden" />
        <div className="absolute top-[30%] right-[8%] w-px h-[80px] bg-gradient-to-b from-transparent via-gold/20 to-transparent max-md:hidden" />
        <div className="absolute bottom-[25%] left-[15%] w-[60px] h-px bg-gradient-to-r from-transparent via-rose-500/15 to-transparent max-md:hidden" />
      </div>

      <div className="relative z-10 text-center max-w-[900px] px-6 py-32">
        {/* 배지 */}
        <motion.button
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          onClick={() => document.getElementById("cta")?.scrollIntoView({ behavior: "smooth" })}
          className="inline-flex items-center gap-3 px-5 py-2.5 bg-white/70 backdrop-blur-[12px] border border-rose-pale/30 rounded-full mb-10 cursor-pointer hover:bg-white/90 hover:border-rose-500/30 transition-all"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
          <span className="text-[13px] text-charcoal tracking-wide font-light">
            AI 웨딩 플래너 — 사전등록 진행 중
          </span>
          <span className="text-[11px] text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded-full font-medium">
            무료
          </span>
        </motion.button>

        {/* 메인 헤드라인 */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.4 }}
          className="font-serif-kr text-[clamp(36px,6vw,72px)] font-light leading-[1.2] tracking-tight mb-7"
        >
          결혼 준비,
          <br />
          <em className="not-italic font-medium bg-gradient-to-br from-rose-500 to-gold bg-clip-text text-transparent">
            한방
          </em>
          에 해결하세요
        </motion.h1>

        {/* 서브 카피 */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.6 }}
          className="text-[clamp(15px,1.6vw,18px)] leading-[1.8] text-charcoal max-w-[540px] mx-auto mb-12 font-light"
        >
          AI가 나에게 딱 맞는 업체를 추천하고,
          <br />
          새벽에도 답해주는 웨딩 플래너가 되어주고,
          <br />
          커플이 함께 예산과 일정을 관리할 수 있어요.
        </motion.p>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.8 }}
          className="flex gap-4 justify-center flex-wrap mb-16"
        >
          <a
            href="/login"
            className="group inline-flex items-center gap-2.5 px-10 py-4 bg-noir-800 text-white rounded-full text-[15px] font-medium hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(26,26,31,0.2)] transition-all duration-400"
          >
            무료로 시작하기
            <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </a>
          <a
            href="#features"
            className="inline-flex items-center gap-2.5 px-10 py-4 bg-transparent text-noir-800 border-[1.5px] border-platinum rounded-full text-[15px] font-normal hover:border-rose-500 hover:text-rose-500 hover:-translate-y-0.5 transition-all duration-400"
          >
            기능 둘러보기
          </a>
        </motion.div>

        {/* 하단 신뢰 지표 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 1.1 }}
          className="flex justify-center gap-10 max-md:gap-6"
        >
          {[
            { num: "24시간", label: "AI 상담 가능" },
            { num: "20개", label: "웨딩 카테고리" },
            { num: "All-in-One", label: "결혼 준비 플랫폼" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="font-display text-[clamp(18px,2.5vw,26px)] font-light bg-gradient-to-r from-rose-500 to-gold bg-clip-text text-transparent">
                {stat.num}
              </div>
              <div className="text-[11px] text-taupe-500 mt-1 font-light">{stat.label}</div>
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
        <span className="text-[11px] tracking-[0.15em] uppercase text-taupe-500">
          Scroll
        </span>
        <div className="w-px h-10 bg-gradient-to-b from-taupe-400 to-transparent animate-[scrollLine_2s_ease-in-out_infinite]" />
      </motion.div>
    </section>
  );
}
