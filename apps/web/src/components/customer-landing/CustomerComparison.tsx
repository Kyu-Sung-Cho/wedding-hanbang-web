"use client";

import { motion } from "framer-motion";

const rows = [
  { label: "상담 시간", old: "영업시간에 질문을 모아 문의", new: "아모라에게 필요할 때 질문하고 답변을 참고" },
  { label: "업체 확인", old: "여러 채널의 정보를 따로 정리", new: "후기·질문을 저장하고 업체에 확인할 문장을 정리" },
  { label: "가격 확인", old: "조사 통계와 개인 견적의 범위가 섞임", new: "공식 조사 범위를 확인하고 실제 조건은 업체 원문에서 확인" },
  { label: "예산 관리", old: "각자 엑셀·메모장으로 기록", new: "직접 입력한 계획 예산을 커플이 함께 확인" },
  { label: "일정 관리", old: "카톡으로 공유해 변경 내역이 흩어짐", new: "직접 등록한 확정 일정과 준비 상태 공유" },
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
        <div className="inline-flex items-center gap-2 text-[12px] tracking-[0.18em] uppercase text-rose-500 font-medium mb-5">
          <span className="w-5 h-px bg-rose-500" />
          Comparison
        </div>
        <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight mb-5">
          기존 방식 vs 웨딩한방
        </h2>
        <p className="text-[clamp(14px,1.8vw,16px)] leading-relaxed text-charcoal font-light mx-auto max-w-[520px]">
          흩어진 기록과 비교 기준을 한곳에서 확인하고,
          <br className="hidden md:block" />
          커플이 함께 준비 과정을 정리하세요.
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
          <div className="p-5 px-7 text-[13px] font-medium tracking-wide" />
          <div className="p-5 px-7 text-[13px] font-medium tracking-wide text-white/60">기존 방식</div>
          <div className="p-5 px-7 text-[13px] font-medium tracking-wide">웨딩한방</div>
        </div>
        {rows.map((row, i) => (
          <div
            key={row.label}
            className={`grid grid-cols-[160px_1fr_1fr] ${i < rows.length - 1 ? "border-b border-black/[0.04]" : ""}`}
          >
            <div className="p-5 px-7 text-[13px] font-medium text-charcoal bg-ivory-warm flex items-center">
              {row.label}
            </div>
            <div className="p-5 px-7 text-[13px] text-taupe-500 font-light flex items-center leading-relaxed">
              {row.old}
            </div>
            <div className="p-5 px-7 text-[13px] text-noir-800 font-normal flex items-center bg-rose-500/[0.04] leading-relaxed">
              <span className="text-rose-500 font-semibold mr-2 flex-shrink-0">&#x2713;</span>
              {row.new}
            </div>
          </div>
        ))}
      </motion.div>

      {/* 모바일 카드 */}
      <div className="md:hidden flex flex-col gap-4 max-w-[480px] mx-auto">
        {rows.map((row, i) => (
          <motion.div
            key={row.label}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-30px" }}
            transition={{ duration: 0.6, delay: i * 0.06 }}
            className="rounded-2xl border border-platinum overflow-hidden"
          >
            <div className="bg-ivory-warm px-5 py-3 text-[13px] font-medium text-charcoal">
              {row.label}
            </div>
            <div className="px-5 py-3 text-[13px] text-taupe-500 font-light border-b border-black/[0.04]">
              <span className="text-[11px] text-taupe-400 block mb-1">기존 방식</span>
              {row.old}
            </div>
            <div className="px-5 py-3 text-[13px] text-noir-800 font-normal bg-rose-500/[0.04]">
              <span className="text-[11px] text-rose-500 block mb-1">웨딩한방</span>
              <span className="text-rose-500 font-semibold mr-1.5">&#x2713;</span>
              {row.new}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
