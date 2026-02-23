"use client";

import { motion } from "framer-motion";

const painPoints = [
  {
    num: "01",
    emoji: "😰",
    title: "정보는 넘치는데 뭐부터 해야 할지 모르겠어요",
    desc: "블로그, 카페, 인스타… 정보는 많은데 다 달라요. 누구 말을 믿어야 할지, 어떤 순서로 해야 할지 막막합니다.",
    stat: "60%",
    statLabel: "\"준비 과정이 너무 많다\" 응답 (한국리서치, 2024)",
  },
  {
    num: "02",
    emoji: "💸",
    title: "숨겨진 비용이 자꾸 나와요",
    desc: "견적에 없던 추가 비용, 수수료, 옵션 비용. 예산은 계속 늘어나는데 어디서 새는지 파악이 안 됩니다.",
    stat: "6,298만원",
    statLabel: "평균 결혼 준비 비용, 집값 제외 (가연, 2024)",
  },
  {
    num: "03",
    emoji: "⏰",
    title: "시간이 너무 많이 들어요",
    desc: "맞벌이 커플에게 주말마다 상담 다니는 건 큰 부담이에요. 드레스만 해도 5곳 이상 투어해야 마음에 드는 걸 찾습니다.",
    stat: "6개월+",
    statLabel: "평균 결혼 준비 기간 (업계 평균)",
  },
  {
    num: "04",
    emoji: "😤",
    title: "커플 간에 의견 조율이 어려워요",
    desc: "각자 알아본 정보는 제각각, 예산 감각도 다르고, 카톡으로 공유하다 보면 어디까지 결정한 건지 헷갈립니다.",
    stat: "35%",
    statLabel: "결혼 준비 중 다툼 빈도 증가 (듀오·엠브레인, 2022)",
  },
];

export default function CustomerPainPoints() {
  return (
    <section className="bg-noir-800 py-[140px] px-[60px] relative overflow-hidden max-md:py-20 max-md:px-5">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="absolute inset-0">
        <div className="absolute top-[20%] right-[-10%] w-[400px] h-[400px] bg-[radial-gradient(circle,rgba(196,150,126,0.06),transparent)] rounded-full" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
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
          결혼 준비,
          <br />
          이런 고민 하고 계시죠?
        </h2>
        <p className="text-[16px] leading-relaxed text-white/50 font-light mx-auto max-w-[520px]">
          대부분의 예비부부가 같은 고민을 합니다.
          <br className="hidden md:block" />
          이런 고민들, 한방에 해결해드리겠습니다.
        </p>
      </motion.div>

      <div className="max-w-[1100px] mx-auto grid grid-cols-2 gap-6 relative z-10 max-md:grid-cols-1">
        {painPoints.map((pain, i) => (
          <motion.div
            key={pain.num}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-30px" }}
            transition={{ duration: 0.5, delay: i * 0.06 }}
            className="group bg-white/[0.04] backdrop-blur-sm border border-white/[0.06] rounded-3xl p-8 hover:bg-white/[0.07] hover:border-white/[0.1] transition-all duration-500 max-md:p-6"
          >
            <div className="flex items-start justify-between mb-5">
              <div className="w-12 h-12 rounded-2xl bg-white/[0.06] flex items-center justify-center text-[22px]">
                {pain.emoji}
              </div>
              <span className="font-display text-[13px] text-white/20 font-medium">{pain.num}</span>
            </div>

            <h3 className="font-serif-kr text-[20px] font-normal text-white leading-snug mb-3 tracking-tight max-md:text-[18px]">
              {pain.title}
            </h3>
            <p className="text-[13px] text-white/50 font-light leading-relaxed mb-6">
              {pain.desc}
            </p>

            <div className="pt-5 border-t border-white/[0.06] flex items-center gap-3">
              <span className="font-display text-[24px] font-light bg-gradient-to-r from-rose-500 to-gold bg-clip-text text-transparent">
                {pain.stat}
              </span>
              <span className="text-[12px] text-white/30 font-light">{pain.statLabel}</span>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
