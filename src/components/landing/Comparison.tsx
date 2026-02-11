"use client";

import { motion } from "framer-motion";

const rows = [
  { label: "상담 가능 시간", old: "영업시간 내 전화/방문", new: "24시간 AI 즉시 상담" },
  { label: "드레스 선택", old: "10곳 방문 · 하루종일 소요", new: "AI 가상 피팅 · 10분" },
  { label: "비용 투명성", old: "숨겨진 커미션 20~30%", new: "100% 투명한 가격" },
  { label: "플래너 비용", old: "50만원~200만원", new: "월 구독 · 합리적 가격" },
  { label: "추가 비용 관리", old: "결제 후에야 알게 됨", new: "AI가 사전 경고" },
  { label: "커플 공유", old: "카톡으로 사진 주고받기", new: "실시간 자동 동기화" },
];

export default function Comparison() {
  return (
    <section className="relative bg-white px-5 py-[100px] md:px-[60px] md:py-[140px]">
      <div className="absolute top-0 right-0 left-0 h-px bg-gradient-to-r from-transparent via-platinum to-transparent" />

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className="mx-auto mb-20 max-w-[600px] text-center"
      >
        <div className="mb-5 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-rose-500">
          <span className="h-px w-5 bg-rose-500" />
          Comparison
        </div>
        <h2 className="mb-5 font-serif text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-[-0.02em]">
          기존 방식 vs 웨딩한방
        </h2>
        <p className="mx-auto max-w-[520px] text-base font-light leading-[1.75] text-charcoal">
          웨딩 플래너에게 맡기거나, 직접 발품을 파는 것이 전부였던 시대는 끝났습니다.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className="mx-auto max-w-[900px] overflow-hidden overflow-x-auto rounded-3xl border border-platinum"
      >
        {/* 헤더 */}
        <div className="grid min-w-[600px] grid-cols-[200px_1fr_1fr] bg-noir-800 text-white">
          <div className="p-5 text-[13px] font-medium tracking-[0.02em]" />
          <div className="p-5 text-[13px] font-medium tracking-[0.02em]">기존 방식</div>
          <div className="p-5 text-[13px] font-medium tracking-[0.02em]">웨딩한방</div>
        </div>

        {/* 행 */}
        {rows.map((row, i) => (
          <div
            key={row.label}
            className={`grid min-w-[600px] grid-cols-[200px_1fr_1fr] ${
              i < rows.length - 1 ? "border-b border-black/[0.04]" : ""
            }`}
          >
            <div className="flex items-center bg-ivory-warm p-5 text-[13px] font-medium text-charcoal">
              {row.label}
            </div>
            <div className="flex items-center p-5 text-[13px] font-light text-taupe-500">
              {row.old}
            </div>
            <div className="flex items-center bg-rose-500/[0.04] p-5 text-[13px] font-normal text-noir-800">
              <span className="mr-2 font-semibold text-rose-500">✓</span>
              {row.new}
            </div>
          </div>
        ))}
      </motion.div>
    </section>
  );
}
