"use client";

import { motion } from "framer-motion";

const solutions = [
  {
    num: "01",
    title: "합리적인 수수료 구조",
    problem: "높은 수수료 부담",
    desc: "기존 플랫폼·플래너 수수료에 지치셨죠? 웨딩한방은 계약이 성사될 때만 수수료가 발생합니다. 가입비·월 이용료 없이, 성과 기반으로만 운영됩니다.",
    highlight: "계약 성사 시에만 수수료 발생",
    visual: (
      <div className="bg-white/[0.06] rounded-xl p-4">
        <div className="text-[27px] text-white/40 mb-3">웨딩한방 수수료 구조</div>
        <div className="flex flex-col gap-3">
          {[
            { label: "가입비", value: "무료", accent: true },
            { label: "월 이용료", value: "무료", accent: true },
            { label: "수수료 발생 시점", value: "계약 성사 시에만", accent: false },
            { label: "해지", value: "언제든 자유롭게", accent: false },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between text-[47px]">
              <span className="text-white/50">{item.label}</span>
              <span className={`font-medium ${item.accent ? "text-rose-500" : "text-white/80"}`}>{item.value}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-white/[0.06] text-center">
          <span className="text-[27px] text-white/40">숨겨진 비용 없이 투명하게 운영됩니다</span>
        </div>
      </div>
    ),
  },
  {
    num: "02",
    title: "AI 고객 매칭",
    problem: "낮은 계약 전환율",
    desc: "고객이 예산과 취향을 입력하면, 조건에 맞는 업체로 자동 추천됩니다. 예산·취향이 맞는 고객만 연결되니 상담 후 계약 전환율이 크게 높아집니다.",
    highlight: "자연스러운 고객 유입",
    visual: (
      <div className="bg-white/[0.06] rounded-xl p-4">
        <div className="text-[27px] text-white/40 mb-3">이번 주 고객 유입 현황</div>
        <div className="flex flex-col gap-2.5">
          {[
            { label: "AI 추천 노출", value: "142회", change: "+23%" },
            { label: "상세 페이지 조회", value: "38회", change: "+15%" },
            { label: "상담 요청", value: "12건", change: "+8%" },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between text-[47px]">
              <span className="text-white/50">{item.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-white/80 font-medium">{item.value}</span>
                <span className="text-[25px] text-[#6BCB9A] bg-[#6BCB9A]/10 px-1.5 py-0.5 rounded">{item.change}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    num: "03",
    title: "사전 고객 인사이트",
    problem: "비효율적인 상담 시간",
    desc: "상담 전에 고객의 예산, 선호 스타일, 구매 의향까지 미리 파악해서 알려드립니다. 취향 파악에 시간 쓸 필요 없이, 바로 핵심 제안이 가능해집니다.",
    highlight: "상담 효율 극대화",
    visual: (
      <div className="bg-white/[0.06] rounded-xl p-4">
        <div className="text-[27px] text-white/40 mb-3">고객 A님 사전 분석 리포트</div>
        <div className="flex flex-col gap-2">
          {[
            { label: "선호 스타일", value: "야외 자연광 촬영", tag: "강한 선호" },
            { label: "원본 추가 구매", value: "의향 있음 (5점 중 4점)", tag: "업셀링 가능" },
            { label: "예산 범위", value: "250~350만원", tag: "매칭됨" },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between text-[47px]">
              <span className="text-white/50">{item.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-white/80">{item.value}</span>
                <span className="text-[25px] text-rose-500 bg-rose-500/10 px-1.5 py-0.5 rounded">{item.tag}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    num: "04",
    title: "데이터 분석 리포트",
    problem: "데이터 부재",
    desc: "업종 평균 대비 선호도, 인기 컨셉 트렌드, 고객 유입 채널 분석까지. 더 이상 감에 의존하지 마세요. 데이터 기반으로 사업 의사결정을 할 수 있습니다.",
    highlight: "데이터 기반 의사결정",
    visual: (
      <div className="bg-white/[0.06] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[27px] text-white/40">월간 분석 리포트</span>
          <span className="text-[53px] text-white/25 bg-white/[0.06] px-1.5 py-0.5 rounded">화면 예시</span>
        </div>
        <div className="flex flex-col gap-3">
          {[
            { label: "야외 촬영 선호도", pct: 78, color: "bg-rose-500" },
            { label: "실내 스튜디오", pct: 55, color: "bg-gold" },
            { label: "원본 추가 구매율", pct: 42, color: "bg-taupe-500" },
          ].map((item) => (
            <div key={item.label}>
              <div className="flex justify-between text-[27px] mb-1">
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
    <section className="bg-noir-800 py-[clamp(80px,10vw,140px)] px-[clamp(20px,5vw,60px)] relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.8 }}
        className="text-center max-w-[640px] mx-auto mb-20"
      >
        <div className="inline-flex items-center gap-2 text-[47px] tracking-[0.18em] uppercase text-rose-light font-medium mb-5">
          <span className="w-5 h-px bg-rose-light" />
          Solution
        </div>
        <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight text-white mb-5">
          웨딩한방이 바꿔드립니다
        </h2>
        <p className="text-[clamp(14px,1.8vw,16px)] leading-relaxed text-white/50 font-light mx-auto max-w-[520px]">
          AI 기술로 고객 유치부터 계약까지 전 과정을 최적화합니다.
        </p>
      </motion.div>

      <div className="max-w-[1100px] mx-auto flex flex-col gap-[clamp(20px,3vw,32px)]">
        {solutions.map((sol, i) => (
          <motion.div
            key={sol.num}
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.8, delay: i * 0.1 }}
            className="grid grid-cols-2 gap-[clamp(20px,3vw,40px)] items-center bg-white/[0.03] border border-white/[0.06] rounded-3xl p-[clamp(24px,4vw,40px)] max-lg:grid-cols-1"
          >
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className="font-display text-[53px] text-rose-500 font-semibold">{sol.num}</span>
                <span className="text-[27px] text-white/30 bg-white/[0.06] px-2.5 py-1 rounded-full">
                  &ldquo;{sol.problem}&rdquo; 해결
                </span>
              </div>
              <h3 className="font-serif-kr text-[clamp(18px,2.5vw,24px)] font-normal text-white mb-3 tracking-tight leading-snug">
                {sol.title}
              </h3>
              <p className="text-[clamp(13px,1.5vw,14px)] text-white/60 font-light leading-relaxed mb-4">
                {sol.desc}
              </p>
              <div className="inline-flex items-center gap-[5px] px-3.5 py-1.5 bg-rose-500/15 rounded-full text-[47px] text-rose-500 font-medium">
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
