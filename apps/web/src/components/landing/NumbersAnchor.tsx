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
}

const CARDS: AnchorCard[] = [
  { label: "가격 근거", value: "검수된 공시가", source: "원문과 기준일 확인" },
  { label: "비교 기준", value: "같은 구성", source: "포함·별도 항목 구분" },
  { label: "우리 예산", value: "직접 입력", source: "저장한 예산·지출 기준" },
  { label: "최종 확인", value: "업체 서면", source: "계약 전 최신 조건 확인" },
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
          <h2 className="font-serif-kr text-[clamp(32px,5vw,56px)] font-light text-[var(--hb-text-strong)] leading-[1.2] tracking-normal mb-5">
            가격 앞에는
            <br />
            확인 가능한 <em className="not-italic text-[var(--hb-accent-hover)]">근거</em>가 있어야 합니다.
          </h2>
          <p className="text-charcoal text-[15px] md:text-base leading-[1.9] font-light">
            고정 평균을 단정하지 않고, 검수된 공시가와 두 분이 입력한 견적을 같은 조건으로 비교합니다.
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
              <p className="text-[12px] md:text-[13px] tracking-[0.22em] text-[var(--hb-text-muted)] font-medium mb-6">
                {card.label}
              </p>

              {/* 핵심 원칙 */}
              <p className="font-display text-[var(--hb-accent-hover)] text-[clamp(40px,5.5vw,72px)] leading-none font-light tracking-normal mb-auto">
                {card.value}
              </p>

              {/* 확인 기준 */}
              <p className="mt-12 text-[12px] md:text-[13px] tracking-[0.18em] text-[var(--hb-text-muted)] font-medium pt-5 border-t border-platinum/60">
                기준 &nbsp; {card.source}
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
          className="mt-16 text-center md:text-left"
        >
          <Link
            href={weddingPath("/market-prices")}
            className="group inline-flex items-center gap-2 text-[14px] text-[var(--hb-text-strong)] font-medium border-b border-[var(--hb-primary)] pb-2 hover:text-[var(--color-rose-700)] hover:border-rose-500 transition-colors"
          >
            지역별 · 항목별 공시가 보기
            <ArrowUpRight className="w-4 h-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
