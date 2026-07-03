"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { shouldShowBetaCounter } from "@/constants/beta";

interface BetaCTAProps {
  /** 실시간 신청자 수 (server fetch). 미전달 시 0. */
  current?: number;
  total?: number;
}

export default function BetaCTA({ current = 0, total = 50 }: BetaCTAProps) {
  const BETA_CURRENT = current;
  const BETA_TOTAL = total;
  const progress = Math.min(100, (BETA_CURRENT / BETA_TOTAL) * 100);
  const showCounter = shouldShowBetaCounter(BETA_CURRENT);

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
            <p className="text-[12px] md:text-[13px] tracking-[0.28em] text-rose-light mb-8 font-medium">
              초대
            </p>
            <h2 className="font-serif-kr text-[clamp(28px,5vw,56px)] font-light text-white leading-[1.25] tracking-[-0.015em] mb-8">
              6주간 함께해 주실
              <br />
              <em className="not-italic text-rose-light">50쌍</em>을 찾습니다.
            </h2>
            <p className="text-white/70 text-[15px] md:text-[16px] leading-[1.75] font-light max-w-lg">
              실거래가와 아모라 전 기능을 먼저 경험하고,
              <br />
              정식 출시 후에도 6개월 무료로 연장됩니다.
            </p>
          </div>

          {/* 우측: 진척 + CTA */}
          <div>
            {showCounter ? (
              <>
                <div className="flex items-baseline gap-3 mb-3">
                  <span className="font-sans tabular-nums text-white text-[clamp(40px,8vw,64px)] font-light leading-none tracking-[-0.02em]">
                    {BETA_CURRENT}
                  </span>
                  <span className="text-white/40 text-lg md:text-xl font-light tabular-nums">
                    / {BETA_TOTAL}쌍
                  </span>
                </div>
                <p className="text-[12px] md:text-[13px] tracking-[0.22em] text-white/50 mb-6 font-medium">
                  현재 신청
                </p>

                {/* Progress bar */}
                <div className="h-px bg-white/15 w-full relative overflow-hidden mb-10 max-w-md">
                  <div
                    className="absolute top-0 left-0 h-full bg-rose-light transition-all duration-700"
                    style={{ width: `${Math.max(progress, 3)}%` }}
                    aria-hidden
                  />
                </div>
              </>
            ) : (
              <p className="mb-10 text-[13px] font-medium tracking-[0.16em] text-white/55">
                베타 신청 접수 중
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center">
              <Link
                href="/beta"
                className="group inline-flex items-center gap-2 text-[14px] md:text-[15px] text-white font-medium border-b border-white pb-2 tracking-[0.02em] hover:text-rose-light hover:border-rose-light transition-colors"
              >
                베타 신청하기
                <ArrowUpRight className="w-4 h-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/about"
                className="inline-flex items-center text-[14px] md:text-[15px] text-white/60 font-light tracking-[0.02em] hover:text-white transition-colors"
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
