"use client";

import { motion } from "framer-motion";
import SectionLabel from "./SectionLabel";

interface Role {
  number: string;
  title: string;
  body: React.ReactNode;
}

const ROLES: Role[] = [
  {
    number: "01",
    title: "선호 발굴자",
    body: (
      <>
        &ldquo;예쁜 거&rdquo;가 아니라
        <span className="text-noir-800"> 왜 그게 좋은지</span>까지 끌어냅니다.
      </>
    ),
  },
  {
    number: "02",
    title: "커플 중재자",
    body: (
      <>
        신부와 신랑이
        <span className="text-noir-800"> 따로 대화한 후 함께</span> 합의로 갑니다.
      </>
    ),
  },
  {
    number: "03",
    title: "제약 해결사",
    body: (
      <>
        예산 · 시간 · 지역 · 가족을
        <span className="text-noir-800"> 모두 만족하는 길</span>만 보여드립니다.
      </>
    ),
  },
  {
    number: "04",
    title: "기억 지킴이",
    body: (
      <>
        6개월 전 결정과 지금 결정을
        <span className="text-noir-800"> 연결해 일관성</span>을 지킵니다.
      </>
    ),
  },
  {
    number: "05",
    title: "정보 격차 해소자",
    body: (
      <>
        업체가 아는 모든 것을
        <span className="text-noir-800"> 당신도 알 수 있게</span> 합니다.
      </>
    ),
  },
];

export default function FiveRoles() {
  return (
    <section id="features" className="py-[clamp(96px,14vw,180px)] px-[clamp(20px,5vw,60px)] bg-ivory-warm">
      <div className="max-w-[1240px] mx-auto">
        {/* 섹션 헤더 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="mb-20 md:mb-24 max-w-3xl"
        >
          <SectionLabel label="다섯 가지 역할" />
          <h2 className="font-serif-kr text-[clamp(32px,5vw,56px)] font-light text-noir-800 leading-[1.2] tracking-[-0.01em] mb-5">
            단순한 정보 검색이 아니라,
            <br />
            <em className="not-italic text-rose-500">의사결정의 동반자.</em>
          </h2>
          <p className="text-charcoal text-[15px] md:text-base leading-[1.9] font-light">
            아모라는 당신 곁에서 다섯 가지 역할을 수행합니다.
          </p>
        </motion.div>

        {/* 5 행 — 얇은 구분선 기반 */}
        <div className="divide-y divide-platinum/70 border-t border-b border-platinum/70">
          {ROLES.map((role, idx) => (
            <motion.article
              key={role.number}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.6, delay: idx * 0.08 }}
              className="group grid grid-cols-[56px_1fr] md:grid-cols-[96px_220px_1fr] gap-x-6 md:gap-x-12 gap-y-3 py-10 md:py-12 items-baseline hover:bg-white/50 transition-colors"
            >
              {/* 넘버 */}
              <span className="font-display text-2xl md:text-[28px] text-rose-500 font-light tracking-tight">
                {role.number}
              </span>

              {/* 제목 */}
              <h3 className="font-serif-kr text-[20px] md:text-[24px] text-noir-800 font-medium tracking-[-0.005em]">
                {role.title}
              </h3>

              {/* 설명 */}
              <p className="text-taupe-500 text-[15px] md:text-base leading-[1.85] font-light col-span-2 md:col-span-1 md:max-w-lg">
                {role.body}
              </p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
