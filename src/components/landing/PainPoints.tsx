"use client";

import { motion } from "framer-motion";

const painCards = [
  { icon: "⏰", title: "시간 부족", desc: "직장인 커플은 업체 방문할 시간이 절대적으로 부족합니다" },
  { icon: "💸", title: "불투명한 비용", desc: "숨겨진 추가 비용과 20~30% 커미션이 가격에 포함됩니다" },
  { icon: "😰", title: "정보의 바다", desc: "어디서부터 시작해야 할지, 무엇이 적정 가격인지 모릅니다" },
  { icon: "👗", title: "드레스 선택 지옥", desc: "10곳 이상 방문해도 마음에 드는 드레스를 찾기 어렵습니다" },
];

export default function PainPoints() {
  return (
    <section className="relative overflow-hidden bg-noir-800 px-5 py-[100px] text-white md:px-[60px] md:py-[140px]">
      <div className="absolute -top-[200px] -right-[200px] h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,_rgba(196,150,126,0.08),_transparent)]" />

      <div className="mx-auto grid max-w-[1200px] items-center gap-12 md:grid-cols-2 md:gap-20">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-rose-light">
            <span className="h-px w-5 bg-rose-light" />
            Problem
          </div>
          <h2 className="mb-5 font-serif text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-[-0.02em] text-white">
            결혼 준비,
            <br />
            왜 이렇게 힘들까요?
          </h2>
          <p className="max-w-[520px] text-base font-light leading-[1.75] text-white/60">
            평균 결혼 준비 기간 10개월. 그 시간 동안 수십 곳의 업체를 비교하고, 불투명한 가격에 지치고, 추가 비용에 놀라는 일의 연속입니다.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {painCards.map((card, i) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.8, delay: i * 0.1 }}
              className="group rounded-2xl border border-white/[0.06] bg-white/[0.04] p-7 transition-all duration-400 hover:-translate-y-1 hover:border-rose-500/20 hover:bg-white/[0.07]"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-[10px] bg-rose-500/15 text-lg">
                {card.icon}
              </div>
              <h4 className="mb-2 text-[15px] font-medium text-white/90">{card.title}</h4>
              <p className="text-[13px] font-light leading-[1.6] text-white/45">{card.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
