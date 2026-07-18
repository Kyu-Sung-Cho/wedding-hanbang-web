"use client";

import { motion } from "framer-motion";

const painCards = [
  { icon: "⏰", title: "시간 부족", desc: "일과 준비를 병행하면 여러 업체를 직접 방문할 시간이 제한적입니다" },
  { icon: "💸", title: "불투명한 비용", desc: "포함·별도 항목과 중개 구조가 한눈에 보이지 않을 수 있습니다" },
  { icon: "😰", title: "정보의 바다", desc: "어디서부터 시작해야 할지, 무엇이 적정 가격인지 모릅니다" },
  { icon: "👗", title: "선택 기준의 부재", desc: "여러 곳을 둘러봐도 우리에게 중요한 조건이 정리되지 않으면 비교하기 어렵습니다" },
];

export default function PainPoints() {
  return (
    <section className="bg-noir-800 text-white py-[140px] px-[60px] relative overflow-hidden max-md:py-20 max-md:px-5">
      <div className="absolute -top-[200px] -right-[200px] w-[600px] h-[600px] bg-[radial-gradient(circle,rgba(121,82,82,0.08),transparent)] rounded-full" />

      <div className="grid grid-cols-2 gap-20 items-center max-w-[1200px] mx-auto max-lg:grid-cols-1 max-lg:gap-12">
        <div>
          <div className="inline-flex items-center gap-2 text-[12px] tracking-[0.18em] uppercase text-rose-light font-medium mb-5">
            <span className="w-5 h-px bg-rose-light" />
            Problem
          </div>
          <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight mb-5 text-white">
            결혼 준비,
            <br />
            왜 이렇게 힘들까요?
          </h2>
          <p className="text-[16px] leading-relaxed text-white/60 font-light max-w-[520px]">
            준비 일정 동안 여러 업체와 조건을 비교하고,
            흩어진 견적과 약속을 정리하는 과정이 반복됩니다.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
          {painCards.map((card, i) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.8, delay: i * 0.1 }}
              className="p-7 bg-white/[0.04] border border-white/[0.06] rounded-2xl hover:bg-white/[0.07] hover:border-rose-500/20 hover:-translate-y-1 transition-all duration-400"
            >
              <div className="w-10 h-10 rounded-[10px] bg-rose-500/15 flex items-center justify-center mb-4 text-lg">
                {card.icon}
              </div>
              <h4 className="text-[15px] font-medium mb-2 text-white/90">
                {card.title}
              </h4>
              <p className="text-[13px] text-white/45 leading-relaxed font-light">
                {card.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
