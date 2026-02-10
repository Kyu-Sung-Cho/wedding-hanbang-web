"use client";

import { motion } from "framer-motion";

const rows = [
  { label: "상담 가능 시간", old: "영업시간 내 전화/방문", new: "24시간 AI 즉시 상담" },
  { label: "드레스 선택", old: "10곳 방문 · 하루종일 소요", new: "AI 가상 피팅 · 10분" },
  { label: "비용 투명성", old: "최종 금액을 알 수 없는 구조", new: "100% 투명한 가격 공개" },
  { label: "추가 비용 관리", old: "결제 후에야 알게 됨", new: "AI가 사전 경고" },
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
          웨딩 플래너에게 맡기거나, 직접 발품을 파는 것이 전부였던 시대는 끝났습니다.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.8 }}
        className="max-w-[900px] mx-auto rounded-3xl overflow-hidden border border-platinum max-md:overflow-x-auto"
      >
        <div className="max-md:min-w-[600px]">
          {/* 헤더 */}
          <div className="grid grid-cols-[200px_1fr_1fr] max-lg:grid-cols-[120px_1fr_1fr] bg-noir-800 text-white">
            <div className="p-5 px-7 text-[13px] font-medium tracking-wide" />
            <div className="p-5 px-7 text-[13px] font-medium tracking-wide">기존 방식</div>
            <div className="p-5 px-7 text-[13px] font-medium tracking-wide">웨딩한방</div>
          </div>

          {/* 행 */}
          {rows.map((row, i) => (
            <div
              key={row.label}
              className={`grid grid-cols-[200px_1fr_1fr] max-lg:grid-cols-[120px_1fr_1fr] ${i < rows.length - 1 ? "border-b border-black/[0.04]" : ""}`}
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
        </div>
      </motion.div>
    </section>
  );
}
