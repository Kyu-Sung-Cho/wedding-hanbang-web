"use client";

import { motion } from "framer-motion";

const rows = [
  { label: "수수료", old: "높은 고정 수수료", new: "합리적이고 투명한 수수료" },
  { label: "고객 품질", old: "예산·취향 무관 무작위 연결", new: "AI가 매칭한 맞춤 고객" },
  { label: "사전 정보", old: "상담 시 직접 파악", new: "예산·선호·의향 사전 제공" },
  { label: "데이터", old: "기본 통계만 (또는 없음)", new: "업종 평균 분석·트렌드 리포트" },
  { label: "예약 시스템", old: "전화/카톡 수동 관리", new: "실시간 온라인 예약" },
  { label: "고객 응대", old: "영업시간 내 수동 응대", new: "24시간 AI 자동 응대" },
];

export default function B2BComparison() {
  return (
    <section className="bg-white py-[clamp(80px,10vw,140px)] px-[clamp(20px,5vw,60px)] relative">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-platinum to-transparent" />

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.8 }}
        className="text-center max-w-[600px] mx-auto mb-20"
      >
        <div className="inline-flex items-center gap-2 text-[23px] tracking-[0.18em] uppercase text-rose-500 font-medium mb-5">
          <span className="w-5 h-px bg-rose-500" />
          Comparison
        </div>
        <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight mb-5">
          기존 플랫폼 vs 웨딩한방
        </h2>
        <p className="text-[clamp(14px,1.8vw,16px)] leading-relaxed text-charcoal font-light mx-auto max-w-[520px]">
          같은 비용으로 더 높은 가치를 제공합니다.
        </p>
      </motion.div>

      {/* 데스크톱 테이블 */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.8 }}
        className="max-w-[1015px] mx-auto rounded-3xl overflow-hidden border border-platinum hidden md:block"
      >
        <div className="grid grid-cols-[180px_1fr_1fr] bg-noir-800 text-white">
          <div className="p-5 px-7 text-[21px] font-medium tracking-wide" />
          <div className="p-5 px-7 text-[21px] font-medium tracking-wide">기존 플랫폼</div>
          <div className="p-5 px-7 text-[21px] font-medium tracking-wide">웨딩한방</div>
        </div>
        {rows.map((row, i) => (
          <div
            key={row.label}
            className={`grid grid-cols-[180px_1fr_1fr] ${i < rows.length - 1 ? "border-b border-black/[0.04]" : ""}`}
          >
            <div className="p-5 px-7 text-[21px] font-medium text-charcoal bg-ivory-warm flex items-center">
              {row.label}
            </div>
            <div className="p-5 px-7 text-[21px] text-taupe-500 font-light flex items-center">
              {row.old}
            </div>
            <div className="p-5 px-7 text-[21px] text-noir-800 font-normal flex items-center bg-rose-500/[0.04]">
              <span className="text-rose-500 font-semibold mr-2">&#x2713;</span>
              {row.new}
            </div>
          </div>
        ))}
      </motion.div>

      {/* 모바일 카드 */}
      <div className="md:hidden flex flex-col gap-4 max-w-[540px] mx-auto">
        {rows.map((row, i) => (
          <motion.div
            key={row.label}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-30px" }}
            transition={{ duration: 0.6, delay: i * 0.06 }}
            className="rounded-2xl border border-platinum overflow-hidden"
          >
            <div className="bg-ivory-warm px-5 py-3 text-[21px] font-medium text-charcoal">
              {row.label}
            </div>
            <div className="px-5 py-3 text-[21px] text-taupe-500 font-light border-b border-black/[0.04]">
              <span className="text-[23px] text-taupe-400 block mb-1">기존 플랫폼</span>
              {row.old}
            </div>
            <div className="px-5 py-3 text-[21px] text-noir-800 font-normal bg-rose-500/[0.04]">
              <span className="text-[23px] text-rose-500 block mb-1">웨딩한방</span>
              <span className="text-rose-500 font-semibold mr-1.5">&#x2713;</span>
              {row.new}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
