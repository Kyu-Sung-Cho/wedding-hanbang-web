"use client";

import { motion } from "framer-motion";
import Link from "next/link";

export default function B2BHero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-noir-800">
      {/* 배경 그라데이션 */}
      <div className="absolute inset-0">
        <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] bg-[radial-gradient(circle,rgba(196,150,126,0.12),transparent)] rounded-full" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[500px] h-[500px] bg-[radial-gradient(circle,rgba(201,169,110,0.08),transparent)] rounded-full" />
        <div className="absolute top-[40%] left-[50%] -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[radial-gradient(circle,rgba(196,150,126,0.05),transparent)] rounded-full" />
      </div>

      <div className="relative z-10 max-w-[800px] mx-auto px-5 text-center py-32">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <div className="inline-flex items-center gap-2 text-[12px] tracking-[0.2em] uppercase text-rose-light font-medium mb-8">
            <span className="w-6 h-px bg-rose-light" />
            Wedding Business Partner
            <span className="w-6 h-px bg-rose-light" />
          </div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.15 }}
          className="font-serif-kr text-[clamp(32px,5vw,56px)] font-light leading-[1.3] tracking-tight text-white mb-6"
        >
          더 많은 고객, 더 높은 수익
          <br />
          <em className="not-italic font-medium bg-gradient-to-r from-rose-500 to-gold bg-clip-text text-transparent">
            웨딩한방
          </em>
          과 함께 성장하세요
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="text-[clamp(15px,1.8vw,18px)] text-white/50 font-light leading-relaxed max-w-[560px] mx-auto mb-10"
        >
          AI가 예산과 취향이 딱 맞는 고객을 찾아 연결해드립니다.
          <br className="hidden md:block" />
          불필요한 상담은 줄이고, 계약 전환율은 높이세요.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.45 }}
          className="flex flex-col sm:flex-row gap-4 justify-center"
        >
          <Link
            href="/vendor/service"
            className="px-8 py-4 rounded-full bg-gradient-to-r from-rose-500 to-gold text-white text-[15px] font-medium hover:shadow-[0_8px_32px_rgba(196,150,126,0.3)] hover:-translate-y-0.5 transition-all"
          >
            서비스 안내 & 업체 등록
          </Link>
          <Link
            href="#partner-types"
            className="px-8 py-4 rounded-full border border-white/20 text-white/80 text-[15px] font-medium hover:border-white/40 hover:text-white transition-all"
          >
            파트너 설문 참여하기
          </Link>
        </motion.div>

        {/* 하단 통계 미니 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.7 }}
          className="flex justify-center gap-12 mt-20 max-md:gap-8 max-md:mt-14"
        >
          {[
            { num: "LOW", label: "합리적 수수료" },
            { num: "24h", label: "AI 고객 응대" },
            { num: "∞", label: "성장 가능성" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="font-display text-[clamp(24px,3vw,36px)] font-light bg-gradient-to-r from-rose-500 to-gold bg-clip-text text-transparent">
                {stat.num}
              </div>
              <div className="text-[12px] text-white/40 mt-1">{stat.label}</div>
            </div>
          ))}
        </motion.div>
      </div>

      {/* 스크롤 힌트 */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-10">
        <span className="text-[11px] text-white/30 tracking-wider">SCROLL</span>
        <div className="w-px h-8 bg-gradient-to-b from-white/30 to-transparent animate-[scrollLine_2s_ease-in-out_infinite]" />
      </div>
    </section>
  );
}
