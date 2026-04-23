"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

interface AnchorCard {
  label: string;
  value: string;
  source: string;
}

const CARDS: AnchorCard[] = [
  {
    label: "전국 평균 결혼서비스",
    value: "₩21,010,000",
    source: "한국소비자원 2025",
  },
  {
    label: "스드메 추가금 평균",
    value: "+₩1,740,000",
    source: "기획재정부 2024",
  },
  {
    label: "가격 정보 어려움",
    value: "85.4%",
    source: "한국소비자원 2024",
  },
  {
    label: "추가비용 경험률",
    value: "83.2%",
    source: "한국소비자원 2024",
  },
];

export default function NumbersAnchor() {
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
          <h2 className="font-serif-kr text-[clamp(28px,4vw,44px)] font-light text-noir-800 tracking-tight mb-3">
            숫자로 먼저 봅니다
          </h2>
          <p className="text-charcoal text-sm md:text-base">
            모든 숫자엔 출처가 있습니다.
          </p>
        </motion.div>

        {/* 4카드 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {CARDS.map((card, idx) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: idx * 0.08 }}
              className="bg-ivory-50 rounded-2xl p-5 sm:p-6 text-center shadow-[0_8px_30px_rgba(26,26,31,0.04)]"
            >
              <p className="text-charcoal text-xs sm:text-sm mb-2">
                {card.label}
              </p>
              <p className="font-serif-kr text-rose-500 text-2xl sm:text-3xl md:text-4xl font-light my-2 tracking-tight">
                {card.value}
              </p>
              <p className="text-charcoal/60 text-[10px] leading-tight">
                {card.source}
              </p>
            </motion.div>
          ))}
        </div>

        {/* 하단 CTA */}
        <div className="text-center mt-10">
          <Link
            href="/market-prices"
            className="group inline-flex items-center gap-1.5 text-rose-500 hover:text-rose-600 text-sm font-medium underline-offset-4 hover:underline transition-colors"
          >
            지역별·항목별 시세 전체 보기
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </div>
    </section>
  );
}
