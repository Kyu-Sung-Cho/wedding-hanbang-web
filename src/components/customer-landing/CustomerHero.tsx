"use client";

import { motion } from "framer-motion";

export default function CustomerHero() {
  return (
    <section className="min-h-screen flex items-center justify-center relative overflow-hidden bg-noir-800">
      {/* 배경 */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(196,150,126,0.15),transparent)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_80%_80%,rgba(201,169,110,0.08),transparent)]" />
      </div>

      {/* 미세한 그리드 패턴 */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 text-center max-w-[900px] px-6 py-32">
        {/* 배지 */}
        <motion.button
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          onClick={() => document.getElementById("cta")?.scrollIntoView({ behavior: "smooth" })}
          className="inline-flex items-center gap-3 px-5 py-2.5 bg-white/[0.06] backdrop-blur-sm border border-white/[0.08] rounded-full mb-12 cursor-pointer hover:bg-white/[0.1] hover:border-white/[0.15] transition-all"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
          <span className="text-[13px] text-white/60 tracking-wide font-light">
            사전등록 진행 중
          </span>
          <span className="text-[11px] text-rose-500 bg-rose-500/15 px-2 py-0.5 rounded-full font-medium">
            무료
          </span>
        </motion.button>

        {/* 메인 헤드라인 */}
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.4 }}
          className="font-serif-kr text-[clamp(40px,7vw,80px)] font-extralight leading-[1.15] tracking-tight mb-8 text-white"
        >
          결혼 준비,
          <br />
          <span className="font-light bg-gradient-to-r from-[#D4AFA0] via-[#C9A96E] to-[#DCC9A0] bg-clip-text text-transparent">
            한방
          </span>
          <span className="text-white/90">에</span>
        </motion.h1>

        {/* 서브 카피 */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.6 }}
          className="text-[clamp(15px,1.6vw,18px)] leading-[1.9] text-white/50 max-w-[480px] mx-auto mb-14 font-light"
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
            className="group inline-flex items-center gap-2.5 px-10 py-4 bg-gradient-to-r from-rose-500 to-gold text-white rounded-full text-[15px] font-medium hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(196,150,126,0.25)] transition-all duration-300"
          >
            무료로 시작하기
            <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </a>
          <a
            href="#features"
            className="inline-flex items-center gap-2.5 px-10 py-4 bg-transparent text-white/70 border border-white/[0.12] rounded-full text-[15px] font-light hover:border-white/30 hover:text-white hover:-translate-y-0.5 transition-all duration-300"
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
            { num: "20+", label: "웨딩 카테고리" },
            { num: "All-in-One", label: "결혼 준비" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="font-display text-[clamp(18px,2.5vw,24px)] font-light bg-gradient-to-r from-[#D4AFA0] to-[#C9A96E] bg-clip-text text-transparent">
                {stat.num}
              </div>
              <div className="text-[11px] text-white/30 mt-1.5 font-light tracking-wide">{stat.label}</div>
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
        <span className="text-[10px] tracking-[0.2em] uppercase text-white/20">
          Scroll
        </span>
        <div className="w-px h-8 bg-gradient-to-b from-white/20 to-transparent animate-[scrollLine_2s_ease-in-out_infinite]" />
      </motion.div>
    </section>
  );
}
