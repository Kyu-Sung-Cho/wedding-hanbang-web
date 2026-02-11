"use client";

import { motion } from "framer-motion";

const testimonials = [
  {
    avatar: "👰",
    name: "김지은 예비신부",
    detail: "2025년 10월 결혼 예정",
    text: "새벽에 갑자기 스튜디오 고민이 생겼는데 AI가 바로 상담해줘서 감동이었어요. 실제 플래너보다 더 자세하게 알려줬어요.",
  },
  {
    avatar: "💍",
    name: "박서연 예비신부",
    detail: "2025년 6월 결혼 예정",
    text: "AI 드레스 피팅이 진짜 신기해요. 집에서 편하게 입어보고 마음에 드는 것만 직접 가서 확인했더니 시간이 엄청 절약됐어요.",
  },
  {
    avatar: "💒",
    name: "이수민 신부",
    detail: "2025년 3월 결혼 완료",
    text: "남편이랑 같이 앱 쓰니까 따로 카톡으로 공유 안 해도 되고, 예산 관리가 한눈에 되니까 싸울 일이 줄었어요 ㅋㅋ",
  },
];

export default function Testimonials() {
  return (
    <section id="reviews" className="bg-white px-5 py-[100px] text-center md:px-[60px] md:py-[140px]">
      <div className="mb-5 inline-flex items-center justify-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-rose-500">
        <span className="h-px w-5 bg-rose-500" />
        Reviews
      </div>
      <h2 className="mb-15 font-serif text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-[-0.02em]">
        예비 신부님들의 이야기
      </h2>

      <div className="mx-auto mt-15 grid max-w-[1100px] grid-cols-1 gap-6 md:grid-cols-3">
        {testimonials.map((t, i) => (
          <motion.div
            key={t.name}
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: i * 0.1 }}
            className="rounded-[20px] border border-transparent bg-ivory-warm p-9 text-left transition-all duration-400 hover:-translate-y-1.5 hover:border-rose-pale hover:shadow-[0_16px_48px_rgba(0,0,0,0.06)]"
          >
            <div className="mb-4 text-sm tracking-[2px] text-gold">★★★★★</div>
            <p className="mb-6 text-[15px] italic font-light leading-[1.75] text-charcoal">
              &ldquo;{t.text}&rdquo;
            </p>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-rose-pale to-gold-light text-base">
                {t.avatar}
              </div>
              <div>
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-taupe-500">{t.detail}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
