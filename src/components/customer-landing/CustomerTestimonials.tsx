"use client";

import { motion } from "framer-motion";

const scenarios = [
  {
    text: "새벽에 갑자기 스튜디오 고민이 생겨도 AI가 바로 상담해줍니다. 실제 웨딩 플래너처럼 자세하게 알려드려요.",
    avatar: "💬",
    label: "AI 상담",
    situation: "새벽 2시, 갑자기 떠오른 고민",
    feature: "AI 상담",
  },
  {
    text: "집에서 편하게 드레스를 입어보고 마음에 드는 것만 직접 가서 확인하세요. 드레스 투어 시간을 크게 줄여드립니다.",
    avatar: "👗",
    label: "가상 피팅",
    situation: "퇴근 후 집에서 드레스 고르기",
    feature: "가상 피팅",
  },
  {
    text: "커플이 함께 사용하면 따로 카톡으로 공유할 필요 없이 예산 관리가 한눈에 됩니다. 의견 조율도 쉬워져요.",
    avatar: "💑",
    label: "예산 관리",
    situation: "커플이 함께 보는 예산 현황",
    feature: "예산 관리",
  },
  {
    text: "D-day 기준으로 뭘 먼저 해야 하는지 AI가 알려줍니다. 체크리스트로 체계적으로 관리하니 빠뜨릴 걱정이 없어요.",
    avatar: "📋",
    label: "일정 관리",
    situation: "D-120, 오늘 할 일 알림",
    feature: "일정 관리",
  },
  {
    text: "업체별 패키지 가격을 한눈에 비교할 수 있어요. 숨겨진 추가 비용도 미리 확인해서 예산 계획이 쉬워집니다.",
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
    <section id="reviews" className="bg-white py-[140px] px-[60px] relative max-md:py-20 max-md:px-5">
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
          이런 경험을 드립니다
        </h2>
        <p className="text-[16px] leading-relaxed text-charcoal font-light mx-auto max-w-[520px]">
          웨딩한방과 함께라면 결혼 준비의
          <br className="hidden md:block" />
          모든 순간이 달라집니다.
        </p>
      </motion.div>

      <div className="max-w-[1100px] mx-auto grid grid-cols-3 gap-6 max-lg:grid-cols-2 max-lg:max-w-[720px] max-md:grid-cols-1 max-md:max-w-[480px]">
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
            <p className="text-[14px] leading-[1.8] text-charcoal font-light mb-6 min-h-[80px]">
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
