"use client";

import { motion } from "framer-motion";

const isComingSoon = process.env.NEXT_PUBLIC_LAUNCH_MODE !== "full";

const scenarios = [
  {
    text: "늦은 시간 떠오른 질문도 아모라에게 남겨 비교 기준을 정리할 수 있어요. 중요한 정보는 다음 날 업체나 원문으로 다시 확인해요.",
    avatar: "💬",
    label: "AI 상담",
    situation: "새벽 2시, 갑자기 떠오른 고민",
    feature: "AI 상담",
  },
  {
    text: "공개 시세는 조사 범위와 함께 참고하고, 업체가 서면으로 확정한 금액은 직접 예산에 기록해요.",
    avatar: "💰",
    label: "예산 관리",
    situation: "예산 고민, 확인 항목을 함께 정리해요",
    feature: "예산 관리",
  },
  {
    text: "커플이 같은 화면에서 직접 입력한 계획 금액·계약 총액·낸 금액을 구분해 확인할 수 있어요. 기록이 실제 계약서나 결제 증빙을 대신하지는 않아요.",
    avatar: "💑",
    label: "함께 금액 기록",
    situation: "커플이 함께 확인하는 금액 기록",
    feature: "예산 관리",
  },
  {
    text: "일반적인 준비 순서는 참고하고, 실제로 확정한 일정과 완료 상태는 직접 등록해 커플과 공유해요.",
    avatar: "📋",
    label: "일정 관리",
    situation: "확정한 일정을 함께 기록할 때",
    feature: "일정 관리",
  },
  {
    text: "받은 견적서·계약서 원문을 바탕으로 업체에 다시 물어볼 질문을 아모라와 정리할 수 있어요.",
    avatar: "💰",
    label: "계약 질문 정리",
    situation: "상담 전, 원문 확인 질문 정리",
    feature: "계약 원문 확인",
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
          {isComingSoon ? (
            "현재 계정·앱 기능은 열려 있지 않습니다. 아래는 구현된 활용 예시입니다."
          ) : (
            <>
              현재 제공 중인 도구를 준비 상황에 맞게
              <br className="hidden md:block" />
              필요한 순서로 활용해보세요.
            </>
          )}
        </p>
        <p className="mt-4 text-[12px] text-taupe-500">
          활용 예시이며 실제 고객 후기나 효과 보장이 아닙니다
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
