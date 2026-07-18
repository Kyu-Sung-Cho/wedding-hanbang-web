"use client";

import { motion } from "framer-motion";
import SectionLabel from "./SectionLabel";

interface ReframeCard {
  misconception: string;
  truth: string;
  body: React.ReactNode;
  check: string;
}

const CARDS: ReframeCard[] = [
  {
    misconception: "업체를 많이 보면 답이 나와서",
    truth: "먼저 우리 기준을 정해야 해서",
    body: (
      <>
        후보를 늘리기 전에 지역, 일정, 포함 항목과 포기할 수 없는 조건을 먼저 정리하세요.
      </>
    ),
    check: "필수 조건부터 정리",
  },
  {
    misconception: "좋은 업체를 못 찾아서",
    truth: "우리에게 맞는 조건을 아직 정리하지 못해서",
    body: (
      <>
        &ldquo;예쁘게 하고 싶어&rdquo; &middot; &ldquo;부모님 마음에 들게&rdquo;
        막연한 표현을 사진 분위기, 동선, 제공 범위처럼 확인 가능한 조건으로 바꿔보세요.
      </>
    ),
    check: "취향을 비교 조건으로 변환",
  },
  {
    misconception: "가격이 비싸서",
    truth: "최종 금액의 조건을 알기 어려워서",
    body: (
      <>
        기본가만 보지 말고 포함·별도 항목과 변경·취소 조건을 같은 기준으로 확인하세요.
      </>
    ),
    check: "검수된 공시가와 서면 견적 비교",
  },
];

export default function ProblemReframe() {
  return (
    <section className="py-[clamp(96px,14vw,180px)] px-[clamp(20px,5vw,60px)] bg-white">
      <div className="max-w-[1240px] mx-auto">
        {/* 섹션 헤더 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="mb-20 md:mb-28 max-w-3xl"
        >
          <SectionLabel label="다시 보기" />
          <h2 className="font-serif-kr text-[clamp(32px,5vw,56px)] font-light text-noir-800 leading-[1.2] tracking-[-0.01em]">
            결혼 준비가 힘든 이유는
            <br />
            <em className="not-italic text-rose-500">다른 곳</em>에 있습니다.
          </h2>
        </motion.div>

        {/* 3 카드 — 얇은 구분선 + 여백 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-0 divide-y md:divide-y-0 md:divide-x divide-platinum/70 border-t border-platinum/70">
          {CARDS.map((card, idx) => (
            <motion.article
              key={card.truth}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.7, delay: idx * 0.12 }}
              className="p-10 md:p-12 lg:p-14 md:first:pl-0 md:last:pr-0"
            >
              {/* 오해 */}
              <p className="text-[13px] text-taupe-400 line-through decoration-taupe-400/60 mb-4 tracking-wide">
                {card.misconception}
              </p>

              {/* 진실 */}
              <h3 className="font-serif-kr text-[22px] md:text-[26px] text-noir-800 font-medium leading-[1.35] tracking-[-0.005em] mb-7">
                {card.truth}
              </h3>

              {/* 본문 */}
              <p className="text-charcoal text-[15px] leading-[1.9] font-light mb-10">
                {card.body}
              </p>

              {/* 확인 기준 */}
              <p className="text-[12px] md:text-[13px] tracking-[0.18em] text-taupe-400 font-medium">
                확인 &nbsp; {card.check}
              </p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
