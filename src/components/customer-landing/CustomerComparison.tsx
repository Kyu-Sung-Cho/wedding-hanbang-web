"use client";

import { motion } from "framer-motion";

const rows = [
  { label: "상담 시간", old: "영업시간 내 방문 상담만 가능", new: "24시간 AI 즉시 상담" },
  { label: "드레스 선택", old: "업체마다 가격이 달라 비교 불가", new: "AI가 예산·취향 기반 업체 비교 추천" },
  { label: "비용 투명성", old: "업체마다 다른 견적, 숨겨진 추가 비용", new: "항목별 평균가 비교, 추가비용 사전 알림" },
  { label: "예산 관리", old: "엑셀·메모장으로 수동 관리", new: "실시간 자동 추적, 커플 공유" },
  { label: "일정 관리", old: "카톡으로 공유, 뭐 했는지 기억 안남", new: "D-day 맞춤 체크리스트 자동 제안" },
  { label: "커플 소통", old: "각자 알아보고 카톡으로 공유", new: "하나의 플랫폼에서 함께 확인·결정" },
];

export default function CustomerComparison() {
  return (
    <section className="bg-white py-[clamp(80px,10vw,140px)] px-[clamp(20px,5vw,60px)] relative">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-platinum to-transparent" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.8 }}
        className="text-center max-w-[640px] mx-auto mb-20"
      >
        <div className="inline-flex items-center gap-2 text-[21px] tracking-[0.18em] uppercase text-rose-500 font-medium mb-5">
          <span className="w-5 h-px bg-rose-500" />
          Comparison
        </div>
        <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight mb-5">
          기존 방식 vs 웨딩한방
        </h2>
        <p className="text-[clamp(14px,1.8vw,16px)] leading-relaxed text-charcoal font-light mx-auto max-w-[520px]">
          같은 결혼 준비, 완전히 다른 경험.
          <br className="hidden md:block" />
          시간과 비용, 둘 다 아끼세요.
        </p>
      </motion.div>

      {/* 데스크톱 테이블 */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.8 }}
        className="max-w-[960px] mx-auto rounded-3xl overflow-hidden border border-platinum hidden md:block"
      >
        <div className="grid grid-cols-[160px_1fr_1fr] bg-noir-800 text-white">
          <div className="p-5 px-7 text-[21px] font-medium tracking-wide" />
          <div className="p-5 px-7 text-[21px] font-medium tracking-wide text-white/60">기존 방식</div>
          <div className="p-5 px-7 text-[21px] font-medium tracking-wide">웨딩한방</div>
        </div>
        {rows.map((row, i) => (
          <div
            key={row.label}
            className={`grid grid-cols-[160px_1fr_1fr] ${i < rows.length - 1 ? "border-b border-black/[0.04]" : ""}`}
          >
            <div className="p-5 px-7 text-[21px] font-medium text-charcoal bg-ivory-warm flex items-center">
              {row.label}
            </div>
            <div className="p-5 px-7 text-[21px] text-taupe-500 font-light flex items-center leading-relaxed">
              {row.old}
            </div>
            <div className="p-5 px-7 text-[21px] text-noir-800 font-normal flex items-center bg-rose-500/[0.04] leading-relaxed">
              <span className="text-rose-500 font-semibold mr-2 flex-shrink-0">&#x2713;</span>
              {row.new}
            </div>
          </div>
        ))}
      </motion.div>

      {/* 모바일 카드 */}
      <div className="md:hidden flex flex-col gap-4 max-w-[510px] mx-auto">
        {rows.map((row, i) => (
          <motion.div
            key={row.label}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-30px" }}
            transition={{ duration: 0.6, delay: i * 0.06 }}
            className="rounded-2xl border border-platinum overflow-hidden"
          >
            <div className="bg-ivory-warm px-5 py-3 text-[21px] font-medium text-charcoal">
              {row.label}
            </div>
            <div className="px-5 py-3 text-[21px] text-taupe-500 font-light border-b border-black/[0.04]">
              <span className="text-[21px] text-taupe-400 block mb-1">기존 방식</span>
              {row.old}
            </div>
            <div className="px-5 py-3 text-[21px] text-noir-800 font-normal bg-rose-500/[0.04]">
              <span className="text-[21px] text-rose-500 block mb-1">웨딩한방</span>
              <span className="text-rose-500 font-semibold mr-1.5">&#x2713;</span>
              {row.new}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
