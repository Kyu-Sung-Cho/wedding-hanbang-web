"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Sparkles, ArrowRight } from "lucide-react";

// 5 Roles chips (미리보기 카드 하단)
const ROLE_CHIPS = [
  { emoji: "🔍", label: "막연한 것 끌어내기" },
  { emoji: "🤝", label: "파트너 중재" },
  { emoji: "📚", label: "6개월 기억" },
];

export default function Hero() {
  return (
    <section className="relative pt-[96px] pb-[clamp(60px,10vw,120px)] px-[clamp(20px,5vw,60px)] bg-gradient-to-b from-ivory-50 to-white overflow-hidden">
      {/* 배경 장식 */}
      <div className="absolute -top-[200px] left-1/2 -translate-x-1/2 w-[min(900px,95vw)] h-[min(900px,95vw)] bg-[radial-gradient(circle,rgba(121,82,82,0.08),transparent_60%)] rounded-full pointer-events-none" />

      <div className="relative z-10 max-w-[1200px] mx-auto grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-[clamp(32px,5vw,80px)] items-center">
        {/* 좌측 카피 */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="flex flex-col items-center text-center md:items-start md:text-left"
        >
          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2 bg-rose-500/10 text-rose-500 text-xs tracking-widest uppercase px-3 py-1.5 rounded-full font-medium mb-6">
            당신만을 위한 AI 웨딩 플래너
          </div>

          {/* H1 */}
          <h1 className="font-serif-kr text-[clamp(28px,5vw,56px)] text-noir-800 leading-[1.25] tracking-tight font-light mb-7">
            새벽 3시, 결혼 카페에서
            <br />
            <span className="font-medium">50개 글 읽고도</span>
            <br />
            답을 못 찾았던 적 있나요?
          </h1>

          {/* Sub 1 */}
          <p className="text-charcoal text-base md:text-lg leading-relaxed mb-5 font-light max-w-[560px]">
            결혼 준비는 평생 한 번. 1,500개의 결정.<br />
            정보는 넘치는데 내게 맞는 건 모르겠고,<br />
            파트너와 작은 일로 자꾸 부딪히고,<br />
            부모님 기대까지 신경 써야 하는 그 무게.
          </p>

          {/* Sub 2 */}
          <p className="text-noir-800 text-base md:text-lg leading-relaxed mb-10 max-w-[560px]">
            당신도 모르는 당신의 선호까지 끌어내고,
            파트너와 합의로 가도록 중재하고,
            6개월 전 결정도 기억하는
            <br />
            <span className="font-medium">당신만의 AI 웨딩 플래너, 아모라.</span>
          </p>

          {/* CTA Group */}
          <div className="flex flex-wrap gap-3 mb-6 justify-center md:justify-start">
            <Link
              href="/beta"
              className="group inline-flex items-center gap-2 px-7 py-3.5 bg-gradient-to-r from-rose-500 to-rose-600 text-white rounded-xl text-[15px] font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.25)] hover:shadow-[0_10px_30px_rgba(121,82,82,0.35)] hover:-translate-y-0.5 transition-all"
            >
              베타 50쌍 한정 모집
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/chat"
              className="inline-flex items-center gap-2 px-7 py-3.5 border border-taupe-400/50 text-charcoal rounded-xl text-[15px] font-medium hover:bg-ivory-warm hover:border-taupe-400 transition-all"
            >
              아모라와 먼저 대화해보기
            </Link>
          </div>

          {/* Trust Bar */}
          <p className="text-charcoal/60 text-xs tracking-wide">
            한국소비자원·기획재정부 데이터 기반 · AI 기본법 준수
          </p>
        </motion.div>

        {/* 우측 아모라 채팅 미리보기 카드 — 모바일 숨김 */}
        <motion.div
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.9, ease: "easeOut", delay: 0.15 }}
          className="hidden lg:block"
        >
          <div className="bg-white rounded-3xl shadow-[0_24px_60px_-12px_rgba(26,26,31,0.18)] overflow-hidden border border-platinum/60">
            {/* 카드 헤더 */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-platinum/60">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center text-white font-serif-kr font-medium shrink-0">
                A
              </div>
              <div className="min-w-0">
                <p className="font-medium text-noir-800 text-sm truncate">아모라</p>
                <p className="text-xs text-taupe-400">AI 웨딩 플래너 · 24시간</p>
              </div>
              <Sparkles className="w-4 h-4 text-gold ml-auto shrink-0" />
            </div>

            {/* 대화 내용 */}
            <div className="p-5 space-y-4">
              <p className="text-[15px] text-noir-800 leading-relaxed">
                안녕하세요 지현님 <span className="inline-block">😊</span>
                <br />
                D-172일이네요.
              </p>

              <div className="bg-ivory-warm rounded-2xl rounded-tl-sm px-4 py-3.5">
                <p className="text-sm text-charcoal leading-relaxed">
                  지난주에 <span className="text-noir-800 font-medium">&ldquo;양가 상견례 부담스럽다&rdquo;</span> 하셨죠.
                  오늘 그 얘기 더 할까요?
                </p>
              </div>

              {/* AI 생성 배지 */}
              <div className="inline-flex items-center gap-1.5 text-[11px] text-taupe-400">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500/40" />
                AI 생성
              </div>
            </div>

            {/* 하단 칩 3개 */}
            <div className="flex flex-wrap gap-2 px-5 pb-5">
              {ROLE_CHIPS.map((chip) => (
                <span
                  key={chip.label}
                  className="inline-flex items-center gap-1.5 bg-sage-500/10 text-sage-500 text-[11px] font-medium px-3 py-1.5 rounded-full"
                >
                  <span aria-hidden>{chip.emoji}</span>
                  {chip.label}
                </span>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
