"use client";

import { motion } from "framer-motion";

const isComingSoon = process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon";

const scenarios = [
  {
    text: "늦은 시간 떠오른 질문도 아모라에게 남겨 비교 기준을 정리할 수 있어요. 중요한 정보는 다음 날 업체나 원문으로 다시 확인해요.",
    avatar: "💬",
    label: "AI 상담",
    situation: "새벽 2시, 갑자기 떠오른 고민",
    feature: "AI 상담",
  },
  {
    text: "공개 시세와 견적 체크 결과를 참고해 예상 항목을 정리하고, 확정 금액은 직접 예산에 기록해요.",
    avatar: "💰",
    label: "예산 관리",
    situation: "예산 고민, 확인 항목을 함께 정리해요",
    feature: "예산 관리",
  },
  {
    text: "커플이 함께 사용하면 따로 카톡으로 공유할 필요 없이 예산 관리가 한눈에 됩니다. 의견 조율도 쉬워져요.",
    avatar: "💑",
    label: "함께 예산 관리",
    situation: "커플이 함께 보는 예산 현황",
    feature: "예산 관리",
  },
  {
    text: "D-day 기준 체크리스트에서 지금 확인할 항목을 보고, 실제 일정은 직접 등록해 커플과 공유해요.",
    avatar: "📋",
    label: "일정 관리",
    situation: "D-120, 지금 확인할 체크리스트",
    feature: "일정 관리",
  },
  {
    text: "공개 시세와 견적의 포함 항목을 비교해 업체에 다시 물어볼 질문을 준비할 수 있어요.",
    avatar: "💰",
    label: "비용 비교",
    situation: "웨딩 박람회 전, 냉정한 비교",
    feature: "비용 비교",
  },
  {
    text: "초대 코드 한 번이면 예비 신랑도 함께 참여할 수 있어요. 같은 정보를 보면서 함께 결정하는 결혼 준비를 경험하세요.",
    avatar: "💍",
    label: "커플 연동",
    situation: "함께 준비하는 결혼",
    feature: "커플 연동",
  },
];

export default function CustomerTestimonials() {
  return (
    <section id="reviews" className="bg-ivory-100 py-[clamp(80px,10vw,140px)] px-[clamp(20px,5vw,60px)] relative">
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
          Experience
        </div>
        <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight mb-5">
          이렇게 활용할 수 있어요
        </h2>
        <p className="text-[clamp(14px,1.8vw,16px)] leading-relaxed text-charcoal font-light mx-auto max-w-[520px]">
          {isComingSoon ? "정식 베타에서 준비 중인 도구를" : "현재 제공 중인 도구를 준비 상황에 맞게"}
          <br className="hidden md:block" />
          {isComingSoon ? "활용할 수 있는 상황을 미리 살펴보세요." : "필요한 순서로 활용해보세요."}
        </p>
      </motion.div>

      <div className="max-w-[1100px] mx-auto grid grid-cols-3 gap-[clamp(16px,2vw,24px)] max-lg:grid-cols-2 max-lg:max-w-[720px] max-md:grid-cols-1 max-md:max-w-[480px]">
        {scenarios.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.8, delay: Math.min(i * 0.08, 0.3) }}
            className="bg-ivory-warm rounded-[20px] p-8 text-left border border-transparent hover:border-rose-pale md:hover:-translate-y-1.5 hover:shadow-[0_16px_48px_rgba(0,0,0,0.06)] transition-all duration-400"
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-[11px] text-taupe-500 font-light">{s.situation}</span>
              <span className="text-[11px] text-rose-500 bg-rose-500/10 px-2.5 py-1 rounded-full font-medium">
                {s.feature}
              </span>
            </div>
            <p className="text-[clamp(13px,1.5vw,14px)] leading-[1.8] text-charcoal font-light mb-6 min-h-[80px]">
              {s.text}
            </p>
            <div className="flex items-center gap-3 pt-5 border-t border-black/[0.04]">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-rose-pale to-gold-light flex items-center justify-center text-[16px]">
                {s.avatar}
              </div>
              <div className="text-[14px] font-medium text-noir-800">{s.label}</div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
