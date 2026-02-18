"use client";

import { motion } from "framer-motion";

const testimonials = [
  {
    text: "새벽에 갑자기 스튜디오 고민이 생겼는데 AI가 바로 상담해줘서 감동이었어요. 실제 플래너보다 더 자세하게 알려줬어요.",
    avatar: "👰",
    name: "김지은 예비신부",
    detail: "2025년 10월 결혼 예정",
    feature: "AI 상담",
  },
  {
    text: "AI 드레스 피팅이 진짜 신기해요. 집에서 편하게 입어보고 마음에 드는 것만 직접 가서 확인했더니 시간이 엄청 절약됐어요.",
    avatar: "💍",
    name: "박서연 예비신부",
    detail: "2025년 6월 결혼 예정",
    feature: "가상 피팅",
  },
  {
    text: "남편이랑 같이 앱 쓰니까 따로 카톡으로 공유 안 해도 되고, 예산 관리가 한눈에 되니까 싸울 일이 줄었어요 ㅋㅋ",
    avatar: "💒",
    name: "이수민 신부",
    detail: "2025년 3월 결혼 완료",
    feature: "예산 관리",
  },
  {
    text: "D-day 체크리스트가 정말 꼼꼼해요. 뭘 먼저 해야 하는지 알려주니까 마음이 편해졌어요. 일정 빠뜨린 적이 없어요.",
    avatar: "🌸",
    name: "최유나 예비신부",
    detail: "2025년 9월 결혼 예정",
    feature: "일정 관리",
  },
  {
    text: "웨딩 박람회 가서 충동적으로 계약할 뻔했는데 앱에서 평균가 비교해보고 냉정해졌어요. 200만원은 아꼈을 듯!",
    avatar: "💐",
    name: "한소영 예비신부",
    detail: "2025년 11월 결혼 예정",
    feature: "비용 비교",
  },
  {
    text: "예비신랑도 앱 열심히 쓰고 있어요. 원래 관심 없던 사람인데 같이 할 수 있으니까 참여율이 올라갔어요.",
    avatar: "🤵",
    name: "정다은 예비신부",
    detail: "2025년 8월 결혼 예정",
    feature: "커플 연동",
  },
];

export default function CustomerTestimonials() {
  return (
    <section id="reviews" className="bg-white py-[140px] px-[60px] relative max-md:py-20 max-md:px-5">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-platinum to-transparent" />

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.8 }}
        className="text-center max-w-[640px] mx-auto mb-20"
      >
        <div className="inline-flex items-center gap-2 text-[12px] tracking-[0.18em] uppercase text-rose-500 font-medium mb-5">
          <span className="w-5 h-px bg-rose-500" />
          Reviews
        </div>
        <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight mb-5">
          예비 신부님들의 이야기
        </h2>
        <p className="text-[16px] leading-relaxed text-charcoal font-light mx-auto max-w-[520px]">
          이미 많은 분들이 웨딩한방으로
          <br className="hidden md:block" />
          결혼 준비를 시작하셨습니다.
        </p>
      </motion.div>

      <div className="max-w-[1100px] mx-auto grid grid-cols-3 gap-6 max-lg:grid-cols-2 max-lg:max-w-[720px] max-md:grid-cols-1 max-md:max-w-[480px]">
        {testimonials.map((t, i) => (
          <motion.div
            key={t.name}
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.8, delay: i * 0.08 }}
            className="bg-ivory-warm rounded-[20px] p-8 text-left border border-transparent hover:border-rose-pale hover:-translate-y-1.5 hover:shadow-[0_16px_48px_rgba(0,0,0,0.06)] transition-all duration-400"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="text-gold text-[14px] tracking-[2px]">★★★★★</div>
              <span className="text-[11px] text-rose-500 bg-rose-500/10 px-2.5 py-1 rounded-full font-medium">
                {t.feature}
              </span>
            </div>
            <p className="text-[14px] leading-[1.8] text-charcoal font-light mb-6 min-h-[80px]">
              &ldquo;{t.text}&rdquo;
            </p>
            <div className="flex items-center gap-3 pt-5 border-t border-black/[0.04]">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-rose-pale to-gold-light flex items-center justify-center text-[16px]">
                {t.avatar}
              </div>
              <div>
                <div className="text-[14px] font-medium text-noir-800">{t.name}</div>
                <div className="text-[12px] text-taupe-500">{t.detail}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
