"use client";

import { motion } from "framer-motion";
import SectionLabel from "./SectionLabel";

interface ReframeCard {
  number: string;
  misconception: string;
  truth: string;
  body: React.ReactNode;
  source: string;
}

const CARDS: ReframeCard[] = [
  {
    number: "01",
    misconception: "정보가 부족해서",
    truth: "정보 과부하 + 처리 능력 부족",
    body: (
      <>
        스드메 업체 500개 중 무엇을 골라야 할지.
        선택지가 24개를 넘으면 결정률이 3%로 급락합니다.
      </>
    ),
    source: "Schwartz, 2004",
  },
  {
    number: "02",
    misconception: "좋은 업체를 못 찾아서",
    truth: "내 선호를 모르는 게 진짜 문제",
    body: (
      <>
        &ldquo;예쁘게 하고 싶어&rdquo; &middot; &ldquo;부모님 마음에 들게&rdquo;
        당신도 자기 선호를 정확히 모릅니다.
      </>
    ),
    source: "Introspection Illusion, Nisbett &amp; Wilson 1977",
  },
  {
    number: "03",
    misconception: "가격이 비싸서",
    truth: "가격을 예측 못 해서",
    body: (
      <>
        평균 추가금 174만원. 83.2%가 추가비용을 경험합니다.
      </>
    ),
    source: "한국소비자원 2024",
  },
];

export default function ProblemReframe() {
  return (
    <section className="py-[clamp(80px,12vw,160px)] px-[clamp(20px,5vw,60px)] bg-white">
      <div className="max-w-[1240px] mx-auto">
        {/* 에디토리얼 섹션 헤더 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="mb-16 md:mb-20 max-w-3xl"
        >
          <SectionLabel number="01" label="Reframed" />
          <h2 className="font-serif-kr text-[clamp(32px,5vw,56px)] font-light text-noir-800 leading-[1.15] tracking-tight">
            결혼 준비가 진짜 힘든 이유는
            <br />
            <em className="not-italic text-rose-500">다른 곳</em>에 있습니다.
          </h2>
        </motion.div>

        {/* 3개 카드 — 에디토리얼 2-column grid with lots of air */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-0 divide-y md:divide-y-0 md:divide-x divide-platinum/70 border-t border-platinum/70">
          {CARDS.map((card, idx) => (
            <motion.article
              key={card.number}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.7, delay: idx * 0.12 }}
              className="p-8 md:p-10 lg:p-12 first:pt-10 md:first:pt-12 md:first:pl-0 md:last:pr-0"
            >
              {/* 넘버링 */}
              <div className="flex items-baseline gap-4 mb-6">
                <span className="font-display text-4xl md:text-5xl text-rose-500 font-light tracking-tight">
                  {card.number}
                </span>
                <span className="h-px flex-1 bg-taupe-400/40" aria-hidden />
              </div>

              {/* 오해 (strikethrough) */}
              <p className="text-sm text-taupe-400 line-through decoration-taupe-400/60 mb-3 tracking-wide">
                {card.misconception}
              </p>

              {/* 진실 */}
              <h3 className="font-serif-kr text-[22px] md:text-2xl text-noir-800 font-medium leading-snug mb-5">
                {card.truth}
              </h3>

              {/* 본문 */}
              <p className="text-charcoal text-[15px] leading-[1.8] font-light mb-8">
                {card.body}
              </p>

              {/* 출처 */}
              <p className="text-[10px] tracking-[0.15em] uppercase text-taupe-400 font-medium">
                Source &mdash; {card.source}
              </p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
