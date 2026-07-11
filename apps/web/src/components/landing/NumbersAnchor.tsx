"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import SectionLabel from "./SectionLabel";
import { weddingPath } from "@/lib/weddingPaths";

interface AnchorCard {
  label: string;
  value: string;
  source: string;
  href: string;
}

const KCA_DECEMBER_2025 = "https://www.kca.go.kr/home/sub.do?menukey=4004&mode=view&no=1004008123&page=1";

const CARDS: AnchorCard[] = [
  { label: "전국 평균 결혼서비스", value: "₩20,910,000", source: "한국소비자원, 2025년 12월", href: KCA_DECEMBER_2025 },
  { label: "서울 강남 평균", value: "₩35,990,000", source: "한국소비자원, 2025년 12월", href: KCA_DECEMBER_2025 },
  { label: "전국 중간 식대", value: "₩58,000", source: "한국소비자원, 2025년 12월", href: KCA_DECEMBER_2025 },
  { label: "조사 지역", value: "14개", source: "한국소비자원, 2025년 12월", href: KCA_DECEMBER_2025 },
];

export default function NumbersAnchor() {
  return (
    <section className="py-[clamp(96px,14vw,180px)] px-[clamp(20px,5vw,60px)] bg-white">
      <div className="max-w-[1240px] mx-auto">
        {/* 섹션 헤더 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="mb-20 md:mb-24 max-w-3xl"
        >
          <SectionLabel label="숫자로 먼저" />
          <h2 className="font-serif-kr text-[clamp(32px,5vw,56px)] font-light text-noir-800 leading-[1.2] tracking-[-0.01em] mb-5">
            숫자 뒤에는
            <br />
            언제나 <em className="not-italic text-rose-500">출처</em>가 있습니다.
          </h2>
          <p className="text-charcoal text-[15px] md:text-base leading-[1.9] font-light">
            공개 기관 자료의 조사 시점과 범위를 함께 표시합니다. 최신 가격은 시세 화면에서 다시 확인하세요.
          </p>
        </motion.div>

        {/* 4 카드 — 거대 serif + 얇은 구분선 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-platinum/70 border-y border-platinum/70">
          {CARDS.map((card, idx) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.7, delay: idx * 0.1 }}
              className="py-14 md:py-16 px-6 md:px-10 md:first:pl-0 md:last:pr-0 flex flex-col"
            >
              {/* 라벨 */}
              <p className="text-[12px] md:text-[13px] tracking-[0.22em] text-taupe-400 font-medium mb-6">
                {card.label}
              </p>

              {/* 거대 serif */}
              <p className="font-display text-rose-500 text-[clamp(40px,5.5vw,72px)] leading-none font-light tracking-[-0.02em] mb-auto">
                {card.value}
              </p>

              {/* 출처 */}
              <a
                href={card.href}
                target="_blank"
                rel="noreferrer"
                className="mt-12 text-[12px] md:text-[13px] tracking-[0.12em] text-taupe-400 font-medium pt-5 border-t border-platinum/60 underline underline-offset-4 hover:text-rose-500"
              >
                출처 &nbsp; {card.source}
              </a>
            </motion.div>
          ))}
        </div>

        {/* 하단 CTA */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-16 text-center md:text-left"
        >
          <Link
            href={weddingPath("/market-prices")}
            className="group inline-flex items-center gap-2 text-[14px] text-noir-800 font-medium border-b border-noir-800 pb-2 tracking-[0.02em] hover:text-rose-500 hover:border-rose-500 transition-colors"
          >
            지역별 · 항목별 시세 전체 보기
            <ArrowUpRight className="w-4 h-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
