"use client";

import { motion } from "framer-motion";
import { X, Check } from "lucide-react";

interface ReframeCard {
  misconception: string;
  truth: string;
  body: React.ReactNode;
  source: string;
}

const CARDS: ReframeCard[] = [
  {
    misconception: "정보가 부족해서",
    truth: "정보 과부하 + 처리 능력 부족",
    body: (
      <>
        스드메 업체 500개 중 무엇을 골라야 할지.
        <br />
        선택지가 24개를 넘으면 결정률이 3%로 급락합니다.
      </>
    ),
    source: "Schwartz, 2004",
  },
  {
    misconception: "좋은 업체를 못 찾아서",
    truth: "내 선호를 모르는 게 진짜 문제",
    body: (
      <>
        &ldquo;예쁘게 하고 싶어&rdquo;
        <br />
        &ldquo;부모님 마음에 들게&rdquo;
        <br />
        당신도 자기 선호를 정확히 모릅니다.
      </>
    ),
    source: "Introspection Illusion, Nisbett & Wilson 1977",
  },
  {
    misconception: "가격이 비싸서",
    truth: "가격을 예측 못 해서",
    body: (
      <>
        평균 추가금 174만원.
        <br />
        83.2%가 추가비용을 경험합니다.
      </>
    ),
    source: "한국소비자원 2024",
  },
];

export default function ProblemReframe() {
  return (
    <section className="py-[clamp(60px,10vw,120px)] px-[clamp(20px,5vw,60px)] bg-white">
      <div className="max-w-[1200px] mx-auto">
        {/* 헤더 */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <h2 className="font-serif-kr text-[clamp(28px,4vw,44px)] font-light text-noir-800 tracking-tight">
            결혼 준비가 진짜 힘든 이유
          </h2>
        </motion.div>

        {/* 3카드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {CARDS.map((card, idx) => (
            <motion.article
              key={card.misconception}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.6, delay: idx * 0.1 }}
              className="bg-ivory-50 rounded-2xl p-8 shadow-[0_8px_30px_rgba(26,26,31,0.04)] hover:shadow-[0_16px_48px_rgba(26,26,31,0.08)] transition-shadow"
            >
              {/* 오해 (strikethrough 스타일) */}
              <div className="flex items-start gap-2 mb-3">
                <X className="w-4 h-4 text-red-400 shrink-0 mt-0.5" aria-hidden />
                <p className="text-sm text-taupe-500 line-through decoration-red-400/50">
                  {card.misconception}
                </p>
              </div>

              {/* 진실 */}
              <div className="flex items-start gap-2.5 mb-5">
                <Check className="w-5 h-5 text-sage-500 shrink-0 mt-0.5" aria-hidden />
                <p className="font-serif-kr text-xl text-noir-800 font-medium leading-snug">
                  {card.truth}
                </p>
              </div>

              {/* 본문 */}
              <p className="text-charcoal text-[15px] leading-relaxed mb-6">
                {card.body}
              </p>

              {/* 출처 */}
              <p className="text-charcoal/60 text-xs italic">
                출처: {card.source}
              </p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
