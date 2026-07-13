"use client";

import { motion } from "framer-motion";
import SectionLabel from "./SectionLabel";

interface ReframeCard {
  misconception: string;
  truth: string;
  body: React.ReactNode;
  source: string;
  sourceHref?: string;
}

const CARDS: ReframeCard[] = [
  {
    misconception: "정보가 많으면 충분해서",
    truth: "출처·시점·포함 범위를 함께 봐야",
    body: (
      <>
        서로 다른 시점과 조건의 가격을 한 숫자처럼 비교하면 오히려 선택이 어려워집니다.
      </>
    ),
    source: "웨딩한방 제품 원칙",
  },
  {
    misconception: "인기 순위만 보면 돼서",
    truth: "우리 조건과 확인 질문이 먼저",
    body: (
      <>
        예산, 지역, 일정과 포함 항목이 다르므로 후보마다 같은 질문으로 다시 확인해야 합니다.
      </>
    ),
    source: "웨딩한방 제품 원칙",
  },
  {
    misconception: "전국 평균 하나면 충분해서",
    truth: "지역·옵션별 범위를 따로 확인해야",
    body: (
      <>
        한국소비자원 공개 자료도 지역과 옵션에 따라 가격 차이가 크다고 안내합니다.
      </>
    ),
    source: "한국소비자원 결혼서비스 가격 동향, 2025년 12월",
    sourceHref: "https://www.kca.go.kr/home/sub.do?menukey=4004&mode=view&no=1004008123&page=1",
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

              {/* 출처 */}
              {card.sourceHref ? (
                <a
                  href={card.sourceHref}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] md:text-[13px] tracking-[0.18em] text-taupe-400 font-medium underline underline-offset-4 hover:text-rose-500"
                >
                  출처 &nbsp; {card.source}
                </a>
              ) : (
                <p className="text-[12px] md:text-[13px] tracking-[0.18em] text-taupe-400 font-medium">
                  출처 &nbsp; {card.source}
                </p>
              )}
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
