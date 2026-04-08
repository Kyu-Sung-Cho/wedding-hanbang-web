"use client";

import { motion } from "framer-motion";

const testimonials = [
  {
    text: "새벽에 갑자기 스튜디오 고민이 생겼는데 AI가 바로 상담해줘서 감동이었어요. 실제 플래너보다 더 자세하게 알려줬어요.",
    avatar: "👰",
    name: "김지은 예비신부",
    detail: "2025년 10월 결혼 예정",
  },
  {
    text: "AI 드레스 피팅이 진짜 신기해요. 집에서 편하게 입어보고 마음에 드는 것만 직접 가서 확인했더니 시간이 엄청 절약됐어요.",
    avatar: "💍",
    name: "박서연 예비신부",
    detail: "2025년 6월 결혼 예정",
  },
  {
    text: "남편이랑 같이 앱 쓰니까 따로 카톡으로 공유 안 해도 되고, 예산 관리가 한눈에 되니까 싸울 일이 줄었어요 ㅋㅋ",
    avatar: "💒",
    name: "이수민 신부",
    detail: "2025년 3월 결혼 완료",
  },
];

export default function Testimonials() {
  return (
    <section id="reviews" className="bg-white py-[140px] px-[60px] text-center max-md:py-20 max-md:px-5">
      <div className="inline-flex items-center gap-2 text-[21px] tracking-[0.18em] uppercase text-rose-500 font-medium mb-5 justify-center">
        <span className="w-5 h-px bg-rose-500" />
        Reviews
      </div>
      <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight mb-5 text-center">
        예비 신부님들의 이야기
      </h2>

      <div className="grid grid-cols-3 gap-6 max-w-[1170px] mx-auto mt-[60px] max-lg:grid-cols-2 max-lg:max-w-[720px] max-md:grid-cols-1 max-md:max-w-[510px]">
        {testimonials.map((t, i) => (
          <motion.div
            key={t.name}
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.8, delay: i * 0.1 }}
            className="bg-ivory-warm rounded-[20px] p-9 text-left border border-transparent hover:border-rose-pale hover:-translate-y-1.5 hover:shadow-[0_16px_48px_rgba(0,0,0,0.06)] transition-all duration-400"
          >
            <div className="text-gold text-[21px] tracking-[2px] mb-4">★★★★★</div>
            <p className="text-[21px] leading-relaxed text-charcoal font-light mb-6 italic">
              &ldquo;{t.text}&rdquo;
            </p>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-rose-pale to-gold-light flex items-center justify-center text-[21px]">
                {t.avatar}
              </div>
              <div>
                <div className="text-[21px] font-medium">{t.name}</div>
                <div className="text-[21px] text-taupe-500">{t.detail}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
