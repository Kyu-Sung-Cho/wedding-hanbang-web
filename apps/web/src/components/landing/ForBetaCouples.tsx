"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import SectionLabel from "./SectionLabel";

const BENEFITS = [
  "무료 Premium (실거래가 + Contract Diff)",
  "아모라 풀 기능 우선 사용",
  "종료 후 6개월 무료 연장",
  "정식 출시 시 선배 신부 인증",
];

const CONDITIONS = [
  "2026년 6~12월 결혼 예정",
  "신부 + 신랑 모두 참여 가능",
  "주 1회 짧은 피드백",
];

const BETA_TOTAL = 50;
const BETA_CURRENT = 0;

export default function ForBetaCouples() {
  const progress = Math.min(100, (BETA_CURRENT / BETA_TOTAL) * 100);

  return (
    <section
      id="cta"
      className="relative py-[clamp(96px,14vw,180px)] px-[clamp(20px,5vw,60px)] overflow-hidden bg-noir-800"
    >
      {/* 매우 은은한 배경 glow — 한쪽에만 */}
      <div className="absolute top-[20%] right-[-10%] w-[min(700px,85vw)] h-[min(700px,85vw)] bg-[radial-gradient(circle,rgba(121,82,82,0.18),transparent_65%)] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-20%] left-[-10%] w-[min(500px,80vw)] h-[min(500px,80vw)] bg-[radial-gradient(circle,rgba(201,169,110,0.10),transparent_60%)] rounded-full pointer-events-none" />

      <div className="relative z-10 max-w-[1240px] mx-auto">
        {/* 에디토리얼 섹션 헤더 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="mb-16 md:mb-20 max-w-3xl"
        >
          <SectionLabel number="05" label="Invitation" tone="light" />
          <h2 className="font-serif-kr text-[clamp(32px,5.5vw,64px)] font-light text-white leading-[1.12] tracking-tight">
            6주간 함께해 주실
            <br />
            <em className="not-italic font-display italic text-rose-light">50쌍</em>
            을 찾습니다.
          </h2>
        </motion.div>

        {/* 2-column: 좌측 혜택·조건, 우측 CTA */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-12 lg:gap-20 items-start">
          {/* 좌측 */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.7 }}
            className="space-y-12"
          >
            {/* Benefits */}
            <div>
              <p className="text-[10px] tracking-[0.22em] uppercase text-rose-light/70 mb-6 font-medium">
                베타 참여 시 &mdash; 혜택
              </p>
              <ul className="space-y-5">
                {BENEFITS.map((benefit, idx) => (
                  <li
                    key={benefit}
                    className="flex items-baseline gap-5 text-[16px] md:text-[17px] text-white/90 font-light leading-[1.7]"
                  >
                    <span className="font-display text-rose-light/80 text-sm shrink-0 w-6">
                      0{idx + 1}
                    </span>
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Conditions */}
            <div className="pt-8 border-t border-white/10">
              <p className="text-[10px] tracking-[0.22em] uppercase text-rose-light/70 mb-6 font-medium">
                참여 조건
              </p>
              <ul className="space-y-3 text-[14px] md:text-[15px] text-white/70 font-light leading-[1.8]">
                {CONDITIONS.map((cond) => (
                  <li key={cond} className="flex items-baseline gap-4">
                    <span className="text-rose-light/40 font-display">&middot;</span>
                    <span>{cond}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>

          {/* 우측: CTA 카드 */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="lg:sticky lg:top-24"
          >
            <div className="border border-white/15 rounded-[28px] p-8 md:p-10 backdrop-blur-sm bg-white/[0.03]">
              <p className="text-[11px] tracking-[0.22em] uppercase text-rose-light font-medium mb-6">
                베타 50쌍 한정
              </p>

              {/* Progress 수치 */}
              <div className="flex items-baseline gap-3 mb-3">
                <span className="font-display text-white text-5xl md:text-6xl font-light leading-none tracking-tight">
                  {BETA_CURRENT}
                </span>
                <span className="text-white/40 text-lg font-light">
                  / {BETA_TOTAL}
                </span>
              </div>
              <p className="text-[11px] tracking-[0.18em] uppercase text-white/50 mb-6 font-medium">
                Applied &mdash; Current
              </p>

              {/* Progress bar */}
              <div className="h-px bg-white/10 w-full relative overflow-hidden mb-10">
                <div
                  className="absolute top-0 left-0 h-full bg-rose-light transition-all duration-700"
                  style={{ width: `${Math.max(progress, 3)}%` }}
                  aria-hidden
                />
              </div>

              {/* CTA 링크 */}
              <Link
                href="/beta"
                className="group inline-flex items-center gap-2 text-[15px] text-white font-medium border-b border-white pb-2 tracking-wide hover:text-rose-light hover:border-rose-light transition-colors"
              >
                베타 신청하기
                <ArrowUpRight className="w-4 h-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>

              <p className="mt-8 text-[11px] tracking-[0.15em] uppercase text-white/40 leading-[1.8] font-light">
                Spring 2026 Cohort
                <br />
                Seoul &middot; Korea
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
