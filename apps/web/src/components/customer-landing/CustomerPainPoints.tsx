"use client";

import { motion } from "framer-motion";

const painPoints = [
  {
    emoji: "😵‍💫",
    title: "뭐부터 해야 할지 모르겠어요",
    desc: "블로그, 카페, 인스타 정보는 넘치는데 기준이 제각각이에요. 우리 일정에서 무엇을 먼저 해야 하는지 한곳에 정리하기 어렵습니다.",
    signal: "준비 순서",
    signalLabel: "우리 일정에서 지금 할 일",
  },
  {
    emoji: "🔍",
    title: "어떤 업체가 좋은지 모르겠어요",
    desc: "내 취향이 뭔지도 모르겠고, 업체마다 가격 구성도 달라요. 출처와 기준일이 확인된 정보만 같은 조건으로 비교해야 합니다.",
    signal: "검수된 공시가",
    signalLabel: "원문·기준일이 확인된 가격",
  },
  {
    emoji: "💸",
    title: "예산을 어떻게 짜야 할지 모르겠어요",
    desc: "어떤 항목에 얼마를 둘지, 기본가에 무엇이 포함되는지 감이 안 와요. 우리 예산과 실제 견적을 직접 넣어 조정할 기준이 필요합니다.",
    signal: "우리 견적",
    signalLabel: "포함·별도 항목을 직접 비교",
  },
  {
    emoji: "🕐",
    title: "시간은 없는데, 방문할 곳은 많고, 의견 조율은 어렵고",
    desc: "맞벌이 커플이 주말마다 상담 다니는 건 현실적으로 힘들어요. 각자 알아본 정보는 제각각이고, 카톡으로 공유하다 보면 뭘 결정한 건지 헷갈립니다.",
    signal: "한곳에 정리",
    signalLabel: "커플이 함께 보는 결정 기록",
  },
];

export default function CustomerPainPoints() {
  return (
    <section className="bg-noir-800 py-[clamp(80px,10vw,140px)] px-[clamp(20px,5vw,60px)] relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="absolute inset-0">
        <div className="absolute top-[20%] right-[-10%] w-[400px] h-[400px] bg-[radial-gradient(circle,rgba(121,82,82,0.06),transparent)] rounded-full" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.8 }}
        className="text-center max-w-[640px] mx-auto mb-20 relative z-10"
      >
        <div className="inline-flex items-center gap-2 text-[12px] tracking-[0.18em] uppercase text-rose-light font-medium mb-5">
          <span className="w-5 h-px bg-rose-light" />
          Problem
        </div>
        <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight text-white mb-5">
          결혼 준비, 왜 싸우고
          <br />
          지칠 수밖에 없을까요?
        </h2>
        <p className="text-[clamp(14px,1.8vw,16px)] leading-relaxed text-white/50 font-light mx-auto max-w-[520px]">
          복잡한 절차, 정확한 기준의 부재, 고무줄 예산, 소통의 어려움까지
          <br className="hidden md:block" />
          우리가 주목한 4가지 핵심 문제입니다.
        </p>
      </motion.div>

      <div className="max-w-[1100px] mx-auto grid grid-cols-2 gap-[clamp(16px,2vw,24px)] relative z-10 max-md:grid-cols-1">
        {painPoints.map((pain, i) => (
          <motion.div
            key={pain.title}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.7, delay: Math.min(i * 0.1, 0.3) }}
            className="group bg-white/[0.04] backdrop-blur-sm border border-white/[0.06] rounded-3xl p-8 hover:bg-white/[0.07] hover:border-white/[0.1] transition-all duration-500 max-md:p-6"
          >
            <div className="flex items-start justify-between mb-5">
              <div className="w-12 h-12 rounded-2xl bg-white/[0.06] flex items-center justify-center text-[22px]">
                {pain.emoji}
              </div>
            </div>

            <h3 className="font-serif-kr text-[clamp(17px,2.5vw,20px)] font-normal text-white leading-snug mb-3 tracking-tight">
              {pain.title}
            </h3>
            <p className="text-[13px] text-white/50 font-light leading-relaxed mb-6">
              {pain.desc}
            </p>

            <div className="pt-5 border-t border-white/[0.06] flex items-center gap-3">
              <span className="font-display text-[24px] font-light bg-gradient-to-r from-rose-500 to-gold bg-clip-text text-transparent">
                {pain.signal}
              </span>
              <span className="text-[12px] text-white/30 font-light">{pain.signalLabel}</span>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
