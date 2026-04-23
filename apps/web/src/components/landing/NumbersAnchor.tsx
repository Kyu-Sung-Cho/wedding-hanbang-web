"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import SectionLabel from "./SectionLabel";

interface AnchorCard {
  label: string;
  value: string;
  source: string;
}

const CARDS: AnchorCard[] = [
  { label: "전국 평균 결혼서비스", value: "₩21,010,000", source: "한국소비자원 2025" },
  { label: "스드메 추가금 평균", value: "+₩1,740,000", source: "기획재정부 2024" },
  { label: "가격 정보 어려움", value: "85.4%", source: "한국소비자원 2024" },
  { label: "추가비용 경험률", value: "83.2%", source: "한국소비자원 2024" },
];

export default function NumbersAnchor() {
  return (
    <section className="py-[clamp(80px,12vw,160px)] px-[clamp(20px,5vw,60px)] bg-white">
      <div className="max-w-[1240px] mx-auto">
        {/* 섹션 헤더 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="mb-16 md:mb-20 max-w-3xl"
        >
          <SectionLabel number="03" label="By the Numbers" />
          <h2 className="font-serif-kr text-[clamp(32px,5vw,56px)] font-light text-noir-800 leading-[1.15] tracking-tight mb-5">
            숫자로 먼저 봅니다.
          </h2>
          <p className="text-charcoal text-[15px] md:text-base leading-[1.9] font-light">
            모든 숫자엔 출처가 있습니다. 정부 공식 데이터 기반.
          </p>
        </motion.div>

        {/* 4 카드 — 거대 serif 숫자, 얇은 구분선 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-platinum/70 border-y border-platinum/70">
          {CARDS.map((card, idx) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.7, delay: idx * 0.1 }}
              className="py-12 md:py-14 px-6 md:px-10 first:pl-0 last:pr-0 flex flex-col"
            >
              {/* 라벨 */}
              <p className="text-[10px] tracking-[0.22em] uppercase text-taupe-400 font-medium mb-5">
                {card.label}
              </p>

              {/* 거대 serif 숫자 */}
              <p className="font-display text-rose-500 text-[clamp(40px,5vw,68px)] leading-none font-light tracking-tight mb-auto">
                {card.value}
              </p>

              {/* 출처 */}
              <p className="mt-10 text-[10px] tracking-[0.15em] uppercase text-taupe-400 font-medium pt-4 border-t border-platinum/60">
                Source &mdash; {card.source}
              </p>
            </motion.div>
          ))}
        </div>

        {/* 하단 CTA */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-14 text-center md:text-left"
        >
          <Link
            href="/market-prices"
            className="group inline-flex items-center gap-2 text-[14px] text-noir-800 font-medium border-b border-noir-800 pb-1.5 tracking-wide hover:text-rose-500 hover:border-rose-500 transition-colors"
          >
            지역별 &middot; 항목별 시세 전체 보기
            <ArrowUpRight className="w-4 h-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
