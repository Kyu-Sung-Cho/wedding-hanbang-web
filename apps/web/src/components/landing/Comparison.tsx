"use client";

import { motion } from "framer-motion";

const rows = [
  { label: "상담 시작", old: "전화·방문 일정을 맞춰 문의", new: "원할 때 AI 대화로 정리 시작" },
  { label: "드레스 선택", old: "여러 곳을 직접 방문해 비교", new: "AI 이미지로 후보를 미리 비교" },
  { label: "비용 투명성", old: "출처와 기준일이 흩어진 정보", new: "검수·발행된 공시가만 표시" },
  { label: "추가 비용 관리", old: "포함·별도 항목을 따로 확인", new: "확인할 항목을 한곳에 정리" },
  { label: "커플 공유", old: "카톡으로 사진 주고받기", new: "실시간 자동 동기화" },
];

export default function Comparison() {
  return (
    <section className="bg-white py-[140px] px-[60px] relative max-md:py-20 max-md:px-5">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-platinum to-transparent" />

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.8 }}
        className="text-center max-w-[600px] mx-auto mb-20"
      >
        <div className="inline-flex items-center gap-2 text-[12px] tracking-[0.18em] uppercase text-rose-500 font-medium mb-5">
          <span className="w-5 h-px bg-rose-500" />
          Comparison
        </div>
        <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight mb-5">
          기존 방식 vs 웨딩한방
        </h2>
        <p className="text-[16px] leading-relaxed text-charcoal font-light mx-auto max-w-[520px]">
          직접 확인해야 할 근거는 그대로 보여주고, 흩어진 준비를 정리하는 선택지를 더합니다.
        </p>
      </motion.div>

      {/* 데스크톱 테이블 */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.8 }}
        className="max-w-[900px] mx-auto rounded-3xl overflow-hidden border border-platinum hidden md:block"
      >
        {/* 헤더 */}
        <div className="grid grid-cols-[200px_1fr_1fr] lg:grid-cols-[200px_1fr_1fr] bg-noir-800 text-white">
          <div className="p-5 px-7 text-[13px] font-medium tracking-wide" />
          <div className="p-5 px-7 text-[13px] font-medium tracking-wide">기존 방식</div>
          <div className="p-5 px-7 text-[13px] font-medium tracking-wide">웨딩한방</div>
        </div>

        {/* 행 */}
        {rows.map((row, i) => (
          <div
            key={row.label}
            className={`grid grid-cols-[200px_1fr_1fr] lg:grid-cols-[200px_1fr_1fr] ${i < rows.length - 1 ? "border-b border-black/[0.04]" : ""}`}
          >
            <div className="p-5 px-7 text-[13px] font-medium text-charcoal bg-ivory-warm flex items-center">
              {row.label}
            </div>
            <div className="p-5 px-7 text-[13px] text-taupe-500 font-light flex items-center">
              {row.old}
            </div>
            <div className="p-5 px-7 text-[13px] text-noir-800 font-normal flex items-center bg-rose-500/[0.04]">
              <span className="text-rose-500 font-semibold mr-2">✓</span>
              {row.new}
            </div>
          </div>
        ))}
      </motion.div>

      {/* 모바일 카드 레이아웃 */}
      <div className="md:hidden flex flex-col gap-4 max-w-[480px] mx-auto">
        {rows.map((row, i) => (
          <motion.div
            key={row.label}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-30px" }}
            transition={{ duration: 0.6, delay: i * 0.08 }}
            className="rounded-2xl border border-platinum overflow-hidden"
          >
            <div className="bg-ivory-warm px-5 py-3 text-[14px] md:text-[15px] font-medium text-charcoal">
              {row.label}
            </div>
            <div className="px-5 py-3 text-[14px] md:text-[15px] text-taupe-500 font-light border-b border-black/[0.04] leading-relaxed">
              <span className="text-[12px] text-taupe-400 block mb-1">기존 방식</span>
              {row.old}
            </div>
            <div className="px-5 py-3 text-[14px] md:text-[15px] text-noir-800 font-normal bg-rose-500/[0.04] leading-relaxed">
              <span className="text-[12px] text-rose-500 block mb-1">웨딩한방</span>
              <span className="text-rose-500 font-semibold mr-1.5">✓</span>
              {row.new}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
