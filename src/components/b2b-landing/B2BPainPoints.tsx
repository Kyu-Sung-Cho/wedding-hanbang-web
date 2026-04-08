"use client";

import { motion } from "framer-motion";

const painCards = [
  {
    icon: "💸",
    title: "높은 수수료 부담",
    desc: "플래너·플랫폼 수수료가 매출의 상당 부분을 차지하고 있습니다. 열심히 일해도 남는 게 적습니다.",
  },
  {
    icon: "📉",
    title: "낮은 계약 전환율",
    desc: "상담에 오지만 예산·취향이 맞지 않아 계약으로 이어지지 않는 경우가 많습니다.",
  },
  {
    icon: "⏰",
    title: "비효율적인 상담 시간",
    desc: "고객 취향 파악에만 긴 시간을 소비하고, 정작 중요한 제안을 할 시간이 부족합니다.",
  },
  {
    icon: "📊",
    title: "데이터 부재",
    desc: "고객 행동 데이터나 경쟁사 분석 없이 감에 의존하여 의사결정을 하고 있습니다.",
  },
];

const fadeInUp = {
  initial: { opacity: 0, y: 40 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-50px" },
  transition: { duration: 0.8 },
};

export default function B2BPainPoints() {
  return (
    <section className="bg-ivory-50 py-[clamp(80px,10vw,140px)] px-[clamp(20px,5vw,60px)] relative">
      <motion.div {...fadeInUp} className="text-center max-w-[640px] mx-auto mb-20">
        <div className="inline-flex items-center gap-2 text-[38px] tracking-[0.18em] uppercase text-rose-500 font-medium mb-5">
          <span className="w-5 h-px bg-rose-500" />
          Problem
        </div>
        <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight mb-5">
          웨딩 업체 대표님들의
          <br />
          공통된 고민
        </h2>
        <p className="text-[clamp(14px,1.8vw,16px)] leading-relaxed text-charcoal font-light mx-auto max-w-[520px]">
          열심히 일하지만, 구조적인 문제 때문에 성장이 어려웠습니다.
          <br />
          이제 그 구조를 바꿀 때입니다.
        </p>
      </motion.div>

      <div className="max-w-[1375px] mx-auto grid grid-cols-4 gap-[clamp(16px,2vw,20px)] max-lg:grid-cols-2 max-md:grid-cols-1">
        {painCards.map((card, i) => (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.7, delay: i * 0.1 }}
            className="bg-white rounded-2xl p-7 border border-black/[0.04] hover:-translate-y-2 hover:shadow-[0_20px_60px_rgba(0,0,0,0.06)] transition-all duration-500"
          >
            <div className="w-11 h-11 rounded-xl bg-noir-800 flex items-center justify-center mb-5 text-[23px]">
              {card.icon}
            </div>
            <h4 className="text-[clamp(14px,1.8vw,16px)] font-medium mb-2 text-noir-800">{card.title}</h4>
            <p className="text-[25px] text-taupe-500 leading-relaxed font-light">{card.desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
