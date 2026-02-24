"use client";

import { motion } from "framer-motion";

const solutions = [
  {
    num: "01",
    title: "AI 고객 매칭",
    desc: "고객이 예산과 취향을 입력하면, 조건에 맞는 업체로 자동 추천됩니다. 관심 있는 고객이 자연스럽게 찾아옵니다.",
    highlight: "자연스러운 고객 유입",
    visual: (
      <div className="bg-white/[0.06] rounded-xl p-4">
        <div className="text-[11px] text-white/40 mb-3">이번 주 고객 유입 현황</div>
        <div className="flex flex-col gap-2.5">
          {[
            { label: "AI 추천 노출", value: "142회", change: "+23%" },
            { label: "상세 페이지 조회", value: "38회", change: "+15%" },
            { label: "상담 요청", value: "12건", change: "+8%" },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between text-[12px]">
              <span className="text-white/50">{item.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-white/80 font-medium">{item.value}</span>
                <span className="text-[10px] text-[#6BCB9A] bg-[#6BCB9A]/10 px-1.5 py-0.5 rounded">{item.change}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    num: "02",
    title: "사전 고객 인사이트",
    desc: "상담 전에 고객의 예산, 선호 스타일, 구매 의향까지 미리 파악해서 알려드립니다. 불필요한 질문 없이 바로 핵심 제안이 가능해집니다.",
    highlight: "상담 효율 극대화",
    visual: (
      <div className="bg-white/[0.06] rounded-xl p-4">
        <div className="text-[11px] text-white/40 mb-3">고객 A님 사전 분석 리포트</div>
        <div className="flex flex-col gap-2">
          {[
            { label: "선호 스타일", value: "야외 자연광 촬영", tag: "강한 선호" },
            { label: "원본 추가 구매", value: "의향 있음 (5점 중 4점)", tag: "업셀링 가능" },
            { label: "예산 범위", value: "250~350만원", tag: "매칭됨" },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between text-[12px]">
              <span className="text-white/50">{item.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-white/80">{item.value}</span>
                <span className="text-[10px] text-rose-500 bg-rose-500/10 px-1.5 py-0.5 rounded">{item.tag}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    num: "03",
    title: "데이터 분석 리포트",
    desc: "업종 평균 대비 선호도, 인기 컨셉 트렌드, 고객 유입 채널 분석까지. 데이터 기반으로 사업 의사결정을 하세요.",
    highlight: "데이터 기반 의사결정",
    visual: (
      <div className="bg-white/[0.06] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] text-white/40">월간 분석 리포트</span>
          <span className="text-[9px] text-white/25 bg-white/[0.06] px-1.5 py-0.5 rounded">화면 예시</span>
        </div>
        <div className="flex flex-col gap-3">
          {[
            { label: "야외 촬영 선호도", pct: 78, color: "bg-rose-500" },
            { label: "실내 스튜디오", pct: 55, color: "bg-gold" },
            { label: "원본 추가 구매율", pct: 42, color: "bg-taupe-500" },
          ].map((item) => (
            <div key={item.label}>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-white/60">{item.label}</span>
                <span className="text-white/80">{item.pct}%</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
];

export default function B2BSolutions() {
  return (
    <section className="bg-noir-800 py-[140px] px-[60px] relative overflow-hidden max-md:py-20 max-md:px-5">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.8 }}
        className="text-center max-w-[640px] mx-auto mb-20"
      >
        <div className="inline-flex items-center gap-2 text-[12px] tracking-[0.18em] uppercase text-rose-light font-medium mb-5">
          <span className="w-5 h-px bg-rose-light" />
          Solution
        </div>
        <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight text-white mb-5">
          웨딩한방이 바꿔드립니다
        </h2>
        <p className="text-[16px] leading-relaxed text-white/50 font-light mx-auto max-w-[520px]">
          AI 기술로 고객 유치부터 계약까지 전 과정을 최적화합니다.
        </p>
      </motion.div>

      <div className="max-w-[1100px] mx-auto flex flex-col gap-8">
        {solutions.map((sol, i) => (
          <motion.div
            key={sol.num}
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.8, delay: i * 0.1 }}
            className="grid grid-cols-2 gap-10 items-center bg-white/[0.03] border border-white/[0.06] rounded-3xl p-10 max-lg:grid-cols-1 max-md:p-6"
          >
            <div>
              <span className="font-display text-[14px] text-rose-500 font-semibold">{sol.num}</span>
              <h3 className="font-serif-kr text-[24px] font-normal text-white mt-3 mb-3 tracking-tight leading-snug max-md:text-[20px]">
                {sol.title}
              </h3>
              <p className="text-[14px] text-white/60 font-light leading-relaxed mb-4">
                {sol.desc}
              </p>
              <div className="inline-flex items-center gap-[5px] px-3.5 py-1.5 bg-rose-500/15 rounded-full text-[12px] text-rose-500 font-medium">
                ✦ {sol.highlight}
              </div>
            </div>
            <div className="max-lg:order-first">{sol.visual}</div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
