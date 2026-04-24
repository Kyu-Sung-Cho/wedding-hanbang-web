"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";

const BETA_TOTAL = 50;
const BETA_CURRENT = 0;

export default function BetaCTA() {
  const progress = Math.min(100, (BETA_CURRENT / BETA_TOTAL) * 100);

  return (
    <section
      id="cta"
      className="relative py-[clamp(96px,14vw,180px)] px-[clamp(20px,5vw,60px)] overflow-hidden bg-noir-800"
    >
      {/* 은은한 warm glow */}
      <div
        className="absolute top-[30%] right-[-12%] w-[min(640px,80vw)] h-[min(640px,80vw)] bg-[radial-gradient(circle,rgba(212,175,160,0.16),transparent_65%)] rounded-full pointer-events-none"
        aria-hidden
      />

      <div className="relative z-10 max-w-[1240px] mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.7 }}
          className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-12 lg:gap-20 items-end"
        >
          {/* 좌측: 헤드라인 */}
          <div className="max-w-2xl">
            <p className="text-[11px] tracking-[0.3em] text-rose-light mb-8 font-medium">
              초대
            </p>
            <h2 className="font-serif-kr text-[clamp(34px,5.5vw,68px)] font-light text-white leading-[1.12] tracking-[-0.015em] mb-8">
              6주간 함께해 주실
              <br />
              <em className="not-italic text-rose-light">50쌍</em>을 찾습니다.
            </h2>
            <p className="text-white/70 text-[15px] md:text-[17px] leading-[1.9] font-light max-w-lg">
              실거래가와 아모라 전 기능을 먼저 경험하고,
              <br />
              정식 출시 후에도 6개월 무료로 연장됩니다.
            </p>
          </div>

          {/* 우측: 진척 + CTA */}
          <div>
            <div className="flex items-baseline gap-3 mb-3">
              <span className="font-sans tabular-nums text-white text-[60px] md:text-[80px] font-light leading-none tracking-[-0.02em]">
                {BETA_CURRENT}
              </span>
              <span className="text-white/40 text-xl font-light tabular-nums">
                / {BETA_TOTAL}
              </span>
            </div>
            <p className="text-[11px] tracking-[0.22em] text-white/50 mb-6 font-medium">
              현재 신청 · 명
            </p>

            {/* Progress bar */}
            <div className="h-px bg-white/15 w-full relative overflow-hidden mb-10 max-w-md">
              <div
                className="absolute top-0 left-0 h-full bg-rose-light transition-all duration-700"
                style={{ width: `${Math.max(progress, 3)}%` }}
                aria-hidden
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center">
              <Link
                href="/beta"
                className="group inline-flex items-center gap-2 text-[15px] text-white font-medium border-b border-white pb-2 tracking-[0.02em] hover:text-rose-light hover:border-rose-light transition-colors"
              >
                베타 신청하기
                <ArrowUpRight className="w-4 h-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/about"
                className="inline-flex items-center text-[14px] text-white/60 font-light tracking-[0.02em] hover:text-white transition-colors"
              >
                자세한 이야기 보기
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
